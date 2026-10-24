import { randomUUID } from 'node:crypto';
import type { ChatTurnRecord, ChatTurnRepository, ConversationRepository } from '@smriti/domain';
import { ChatTurnFailedError, ConflictError, DomainError, NotFoundError } from '@smriti/shared';
import { createChatGraph, type ChatGraphDeps } from './chat.graph.js';
import { toChatMessage, type ChatCommandResult, type ChatGraphState } from './chat.types.js';

export interface ChatCommandDeps extends ChatGraphDeps {
  conversationRepository: ConversationRepository;
  chatTurnRepository: ChatTurnRepository;
  turnLockTimeoutMs?: number;
  turnMaxAttempts?: number;
}

export interface ChatCommandInput {
  userId: string;
  correlationId: string;
  conversationId?: string;
  message: string;
  idempotencyKey?: string;
}

export interface RetryChatTurnInput {
  userId: string;
  turnId: string;
  correlationId: string;
}

export interface RetryChatTurnResult {
  result: ChatCommandResult;
  replayed: boolean;
}

interface TurnLock {
  token: string;
  until: Date;
}

function titleFrom(message: string): string {
  const cleaned = message.replace(/\s+/g, ' ').trim();
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
}

function nextLock(deps: ChatCommandDeps): TurnLock {
  return {
    token: randomUUID(),
    until: new Date(Date.now() + (deps.turnLockTimeoutMs ?? 300_000)),
  };
}

function errorCode(err: unknown): string {
  return err instanceof DomainError ? err.code : 'CHAT_TURN_ERROR';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function snapshotOf(turn: ChatTurnRecord): ChatCommandResult {
  if (!turn.resultSnapshot) {
    throw new Error(`Completed chat turn ${turn.id} is missing its result snapshot`);
  }
  return turn.resultSnapshot;
}

async function executeTurn(
  deps: ChatCommandDeps,
  turn: ChatTurnRecord,
  userMessage: string,
  correlationId: string,
  lockToken: string,
): Promise<ChatCommandResult> {
  try {
    const history = await deps.conversationRepository.listMessagesForContext(
      turn.conversationId,
      turn.id,
      deps.historyLimit ?? 20,
    );

    const graph = createChatGraph(deps);
    const initial: ChatGraphState = {
      turnId: turn.id,
      userId: turn.userId,
      conversationId: turn.conversationId,
      correlationId,
      messages: [...history.map(toChatMessage), { role: 'user', content: userMessage }],
      latestUserMessage: userMessage,
      intent: null,
      extractedMemories: [],
      retrievedMemories: [],
      duplicateWarnings: [],
      memoriesCreated: [],
      createdMemoryContents: [],
      memoriesRetrieved: [],
      context: null,
      response: null,
    };

    const result = await graph.invoke(initial);
    const response = result.response?.trim() || 'I could not generate a response.';
    const snapshot: ChatCommandResult = {
      turnId: turn.id,
      conversationId: turn.conversationId,
      message: response,
      memoriesCreated: result.memoriesCreated,
      memoriesRetrieved: result.memoriesRetrieved,
      duplicateWarnings: result.duplicateWarnings,
    };

    await deps.chatTurnRepository.finalize({
      userId: turn.userId,
      turnId: turn.id,
      lockToken,
      assistantMessage: response,
      result: snapshot,
    });
    return snapshot;
  } catch (err) {
    await deps.chatTurnRepository
      .fail({
        userId: turn.userId,
        turnId: turn.id,
        lockToken,
        errorCode: errorCode(err),
        errorMessage: errorMessage(err),
      })
      .catch(() => undefined);
    throw new ChatTurnFailedError(turn.id, turn.conversationId);
  }
}

export async function chat(
  deps: ChatCommandDeps,
  input: ChatCommandInput,
): Promise<ChatCommandResult> {
  let conversation = input.conversationId
    ? await deps.conversationRepository.findConversation(input.userId, input.conversationId)
    : null;

  if (input.conversationId && !conversation) {
    throw new NotFoundError('Conversation', input.conversationId);
  }

  // A replay or a resume must stay on the conversation owned by the existing
  // turn. Resolve the key before creating a conversation so the retry does not
  // leave an empty conversation behind.
  if (!conversation && input.idempotencyKey) {
    const existing = await deps.chatTurnRepository.findByIdempotencyKey(
      input.userId,
      input.idempotencyKey,
    );
    if (existing) {
      conversation = await deps.conversationRepository.findConversation(
        input.userId,
        existing.conversationId,
      );
    }
  }

  if (!conversation) {
    conversation = await deps.conversationRepository.createConversation(
      input.userId,
      titleFrom(input.message),
    );
  }

  const lock = nextLock(deps);
  const started = await deps.chatTurnRepository.start({
    userId: input.userId,
    conversationId: conversation.id,
    correlationId: input.correlationId,
    userMessage: input.message,
    idempotencyKey: input.idempotencyKey,
    lockToken: lock.token,
    lockedUntil: lock.until,
    maxAttempts: deps.turnMaxAttempts ?? 5,
  });

  switch (started.kind) {
    case 'replay':
      return snapshotOf(started.turn);
    case 'in_progress':
      throw new ConflictError('A chat turn with this Idempotency-Key is still in progress', {
        code: 'CHAT_TURN_IN_PROGRESS',
        turnId: started.turn.id,
      });
    case 'key_mismatch':
      throw new ConflictError('Idempotency-Key was already used for a different chat message', {
        code: 'CHAT_TURN_KEY_REUSE',
        turnId: started.turn.id,
      });
    case 'exhausted':
      throw new ConflictError('This chat turn has reached its retry limit', {
        code: 'CHAT_TURN_RETRY_EXHAUSTED',
        turnId: started.turn.id,
      });
    case 'started':
    case 'resumed':
      return executeTurn(deps, started.turn, input.message, input.correlationId, lock.token);
  }
}

export async function retryChatTurn(
  deps: ChatCommandDeps,
  input: RetryChatTurnInput,
): Promise<RetryChatTurnResult> {
  const lock = nextLock(deps);
  const claimed = await deps.chatTurnRepository.claimForRetry({
    userId: input.userId,
    turnId: input.turnId,
    lockToken: lock.token,
    lockedUntil: lock.until,
    maxAttempts: deps.turnMaxAttempts ?? 5,
  });

  switch (claimed.kind) {
    case 'not_found':
      throw new NotFoundError('Chat turn', input.turnId);
    case 'replay':
      return { result: snapshotOf(claimed.turn), replayed: true };
    case 'in_progress':
      throw new ConflictError('This chat turn is already in progress', {
        code: 'CHAT_TURN_IN_PROGRESS',
        turnId: claimed.turn.id,
      });
    case 'exhausted':
      throw new ConflictError('This chat turn has reached its retry limit', {
        code: 'CHAT_TURN_RETRY_EXHAUSTED',
        turnId: claimed.turn.id,
      });
    case 'claimed': {
      // Record the attempt before re-running the graph so a failed retry is
      // still visible to operators. If the audit write itself fails, fail the
      // turn instead of leaving it locked in progress.
      try {
        await deps.auditLogRepository.append({
          userId: input.userId,
          action: 'chat.turn.retry',
          entityType: 'chat_turn',
          entityId: claimed.turn.id,
          payloadSnapshot: {
            conversationId: claimed.turn.conversationId,
            attempt: claimed.turn.attempts,
          },
          correlationId: input.correlationId,
        });
      } catch (err) {
        await deps.chatTurnRepository
          .fail({
            userId: input.userId,
            turnId: claimed.turn.id,
            lockToken: lock.token,
            errorCode: errorCode(err),
            errorMessage: errorMessage(err),
          })
          .catch(() => undefined);
        throw new ChatTurnFailedError(claimed.turn.id, claimed.turn.conversationId);
      }

      return {
        result: await executeTurn(
          deps,
          claimed.turn,
          claimed.userMessage,
          input.correlationId,
          lock.token,
        ),
        replayed: false,
      };
    }
  }
}
