import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Memory,
  type AuditLogEntry,
  type AuditLogRepository,
  type ChatMessage,
  type ChatModel,
  type ChatTurnRecord,
  type ChatTurnRepository,
  type ClaimChatTurnInput,
  type ClaimChatTurnResult,
  type ConversationMessageRecord,
  type ConversationRecord,
  type ConversationRepository,
  type ConversationRole,
  type EmbeddingProvider,
  type FailChatTurnInput,
  type FinalizeChatTurnInput,
  type ListMemoriesQuery,
  type MemoryRepository,
  type PaginatedResult,
  type StartChatTurnInput,
  type StartChatTurnResult,
  type VectorPoint,
  type VectorPointRef,
  type VectorScanPage,
  type VectorSearchParams,
  type VectorSearchResult,
  type VectorStore,
} from '@smriti/domain';
import { ChatTurnFailedError, ConflictError, NotFoundError } from '@smriti/shared';
import { chat, retryChatTurn } from './chat.command.js';

class InMemoryMemoryRepository implements MemoryRepository {
  private readonly store = new Map<string, Memory>();

  async save(memory: Memory): Promise<void> {
    this.store.set(memory.id, Memory.reconstitute(memory.toProps()));
  }

  async findById(userId: string, id: string): Promise<Memory | null> {
    const memory = this.store.get(id);
    return memory && memory.userId === userId ? Memory.reconstitute(memory.toProps()) : null;
  }

  async findByUser(userId: string, _query: ListMemoriesQuery): Promise<PaginatedResult<Memory>> {
    return {
      items: [...this.store.values()].filter((memory) => memory.userId === userId),
      nextCursor: null,
    };
  }

  async findAll(cursor: string | undefined, limit: number): Promise<PaginatedResult<Memory>> {
    const items = [...this.store.values()];
    const start = cursor ? items.findIndex((memory) => memory.id === cursor) + 1 : 0;
    return { items: items.slice(start, start + limit), nextCursor: null };
  }

  async findByTurnId(turnId: string): Promise<Memory[]> {
    return [...this.store.values()]
      .filter((memory) => memory.turnId === turnId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((memory) => Memory.reconstitute(memory.toProps()));
  }

  async existsByIds(ids: string[]): Promise<Set<string>> {
    return new Set(ids.filter((id) => this.store.has(id)));
  }

  async update(memory: Memory): Promise<void> {
    this.store.set(memory.id, Memory.reconstitute(memory.toProps()));
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const memory = this.store.get(id);
    if (!memory || memory.userId !== userId) return false;
    return this.store.delete(id);
  }
}

class InMemoryConversationRepository implements ConversationRepository {
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly messages = new Map<string, ConversationMessageRecord[]>();

  async createConversation(userId: string, title: string | null): Promise<ConversationRecord> {
    const now = new Date();
    const record: ConversationRecord = {
      id: randomUUID(),
      userId,
      title,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(record.id, record);
    this.messages.set(record.id, []);
    return record;
  }

  async findConversation(userId: string, id: string): Promise<ConversationRecord | null> {
    const record = this.conversations.get(id);
    return record && record.userId === userId ? record : null;
  }

  async appendMessage(
    conversationId: string,
    role: ConversationRole,
    content: string,
    turnId?: string,
  ): Promise<ConversationMessageRecord> {
    const record: ConversationMessageRecord = {
      id: randomUUID(),
      conversationId,
      turnId: turnId ?? null,
      role,
      content,
      createdAt: new Date(),
    };
    this.messages.get(conversationId)!.push(record);
    return record;
  }

  async listMessages(conversationId: string, limit?: number): Promise<ConversationMessageRecord[]> {
    const messages = this.messages.get(conversationId) ?? [];
    return limit ? messages.slice(-limit) : [...messages];
  }

  async listMessagesForContext(
    conversationId: string,
    excludeTurnId: string | null,
    limit?: number,
  ): Promise<ConversationMessageRecord[]> {
    const messages = (this.messages.get(conversationId) ?? []).filter(
      (message) => excludeTurnId === null || message.turnId !== excludeTurnId,
    );
    return limit ? messages.slice(-limit) : [...messages];
  }

  get size(): number {
    return this.conversations.size;
  }
}

function isStale(turn: ChatTurnRecord, now: Date): boolean {
  return (
    turn.status === 'in_progress' &&
    (turn.lockedUntil === null || turn.lockedUntil.getTime() <= now.getTime())
  );
}

class InMemoryChatTurnRepository implements ChatTurnRepository {
  private readonly turns = new Map<string, ChatTurnRecord>();
  private readonly userMessages = new Map<string, string>();

  constructor(private readonly conversations: InMemoryConversationRepository) {}

  async start(input: StartChatTurnInput): Promise<StartChatTurnResult> {
    const now = new Date();
    if (input.idempotencyKey) {
      const existing = [...this.turns.values()].find(
        (turn) => turn.userId === input.userId && turn.idempotencyKey === input.idempotencyKey,
      );
      if (existing) {
        if ((this.userMessages.get(existing.id) ?? '') !== input.userMessage) {
          return { kind: 'key_mismatch', turn: { ...existing } };
        }
        if (existing.status === 'completed') return { kind: 'replay', turn: { ...existing } };
        if (existing.status === 'in_progress' && !isStale(existing, now)) {
          return { kind: 'in_progress', turn: { ...existing } };
        }
        if (existing.attempts >= input.maxAttempts) {
          return { kind: 'exhausted', turn: { ...existing } };
        }
        const resumed: ChatTurnRecord = {
          ...existing,
          status: 'in_progress',
          correlationId: input.correlationId,
          lockToken: input.lockToken,
          lockedUntil: input.lockedUntil,
          attempts: existing.attempts + 1,
          errorCode: null,
          errorMessage: null,
          failedAt: null,
          updatedAt: now,
        };
        this.turns.set(resumed.id, resumed);
        return { kind: 'resumed', turn: { ...resumed } };
      }
    }

    const turn: ChatTurnRecord = {
      id: randomUUID(),
      userId: input.userId,
      conversationId: input.conversationId,
      status: 'in_progress',
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey ?? null,
      lockToken: input.lockToken,
      lockedUntil: input.lockedUntil,
      attempts: 1,
      errorCode: null,
      errorMessage: null,
      resultSnapshot: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      failedAt: null,
    };
    this.turns.set(turn.id, turn);
    this.userMessages.set(turn.id, input.userMessage);
    await this.conversations.appendMessage(
      input.conversationId,
      'user',
      input.userMessage,
      turn.id,
    );
    return { kind: 'started', turn: { ...turn } };
  }

  async claimForRetry(input: ClaimChatTurnInput): Promise<ClaimChatTurnResult> {
    const now = new Date();
    const existing = this.turns.get(input.turnId);
    if (!existing || existing.userId !== input.userId) return { kind: 'not_found' };
    if (existing.status === 'completed') return { kind: 'replay', turn: { ...existing } };
    if (existing.status === 'in_progress' && !isStale(existing, now)) {
      return { kind: 'in_progress', turn: { ...existing } };
    }
    if (existing.attempts >= input.maxAttempts) {
      return { kind: 'exhausted', turn: { ...existing } };
    }
    const claimed: ChatTurnRecord = {
      ...existing,
      status: 'in_progress',
      lockToken: input.lockToken,
      lockedUntil: input.lockedUntil,
      attempts: existing.attempts + 1,
      errorCode: null,
      errorMessage: null,
      failedAt: null,
      updatedAt: now,
    };
    this.turns.set(claimed.id, claimed);
    return {
      kind: 'claimed',
      turn: { ...claimed },
      userMessage: this.userMessages.get(existing.id) ?? '',
    };
  }

  async finalize(input: FinalizeChatTurnInput): Promise<void> {
    const existing = this.turns.get(input.turnId);
    if (!existing) throw new Error(`Chat turn not found: ${input.turnId}`);
    if (existing.status === 'completed') return;
    if (existing.status !== 'in_progress' || existing.lockToken !== input.lockToken) {
      throw new Error(`Chat turn lock lost while finalizing: ${input.turnId}`);
    }
    const now = new Date();
    this.turns.set(input.turnId, {
      ...existing,
      status: 'completed',
      resultSnapshot: input.result,
      completedAt: now,
      updatedAt: now,
      lockToken: null,
      lockedUntil: null,
      errorCode: null,
      errorMessage: null,
    });
    await this.conversations.appendMessage(
      existing.conversationId,
      'assistant',
      input.assistantMessage,
      input.turnId,
    );
  }

  async fail(input: FailChatTurnInput): Promise<void> {
    const existing = this.turns.get(input.turnId);
    if (!existing || existing.status !== 'in_progress' || existing.lockToken !== input.lockToken) {
      return;
    }
    const now = new Date();
    this.turns.set(input.turnId, {
      ...existing,
      status: 'failed',
      errorCode: input.errorCode,
      errorMessage: input.errorMessage.slice(0, 500),
      failedAt: now,
      updatedAt: now,
      lockToken: null,
      lockedUntil: null,
    });
  }

  async findById(userId: string, turnId: string): Promise<ChatTurnRecord | null> {
    const turn = this.turns.get(turnId);
    return turn && turn.userId === userId ? { ...turn } : null;
  }

  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<ChatTurnRecord | null> {
    const turn = [...this.turns.values()].find(
      (candidate) => candidate.userId === userId && candidate.idempotencyKey === idempotencyKey,
    );
    return turn ? { ...turn } : null;
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    let deleted = 0;
    for (const [id, turn] of this.turns) {
      if (turn.createdAt < cutoff) {
        this.turns.delete(id);
        this.userMessages.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

class FakeAuditLogRepository implements AuditLogRepository {
  readonly entries: AuditLogEntry[] = [];
  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
  async findAll() {
    return { items: [], nextCursor: null };
  }
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'fake-embed';
  readonly dimension = 3;
  readonly maxInputTokens = 1000;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0.1, 0.2, 0.3]);
  }
}

class FakeVectorStore implements VectorStore {
  results: VectorSearchResult[] = [];

  async upsert(_points: VectorPoint[]): Promise<void> {}
  async deleteByMemoryId(_memoryId: string): Promise<void> {}
  async deletePoints(_ids: string[]): Promise<void> {}
  async listPointsByMemoryId(_memoryId: string): Promise<VectorPointRef[]> {
    return [];
  }
  async scanPoints(): Promise<VectorScanPage> {
    return { points: [], nextCursor: null };
  }
  async search(_params: VectorSearchParams): Promise<VectorSearchResult[]> {
    return this.results;
  }
  async ensureCollection(): Promise<void> {}
}

class ScriptedChatModel implements ChatModel {
  readonly model = 'fake-chat';
  readonly calls: ChatMessage[][] = [];
  private readonly responses: Array<string | Error>;

  constructor(responses: Array<string | Error>) {
    this.responses = [...responses];
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages);
    const response = this.responses.shift();
    if (response === undefined) throw new Error('no scripted chat response');
    if (response instanceof Error) throw response;
    return response;
  }
}

function deps(
  chatModel: ChatModel,
  memoryRepository: MemoryRepository,
  vectorStore: VectorStore,
  conversationRepository: ConversationRepository,
  chatTurnRepository: ChatTurnRepository,
  auditLogRepository: FakeAuditLogRepository = new FakeAuditLogRepository(),
  maxAttempts = 5,
) {
  return {
    conversationRepository,
    chatTurnRepository,
    chatModel,
    memoryRepository,
    auditLogRepository,
    embeddingProvider: new FakeEmbeddingProvider(),
    vectorStore,
    dedupThreshold: 0.92,
    turnMaxAttempts: maxAttempts,
  };
}

interface Harness {
  memoryRepository: InMemoryMemoryRepository;
  conversationRepository: InMemoryConversationRepository;
  chatTurnRepository: InMemoryChatTurnRepository;
  auditLogRepository: FakeAuditLogRepository;
  vectorStore: FakeVectorStore;
}

function harness(): Harness {
  const memoryRepository = new InMemoryMemoryRepository();
  const conversationRepository = new InMemoryConversationRepository();
  const chatTurnRepository = new InMemoryChatTurnRepository(conversationRepository);
  return {
    memoryRepository,
    conversationRepository,
    chatTurnRepository,
    auditLogRepository: new FakeAuditLogRepository(),
    vectorStore: new FakeVectorStore(),
  };
}

describe('chat command', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const correlationId = 'corr-chat';

  it('stores extracted memories and persists both messages with the turn id', async () => {
    const h = harness();
    const model = new ScriptedChatModel([
      '{"intent":"remember","memories":[{"content":"I live in NYC","type":"long_term","confidence":0.9}]}',
      'Got it — I will remember that you live in NYC.',
    ]);

    const result = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Remember that I live in NYC' },
    );

    expect(result.turnId).toBeTruthy();
    expect(result.memoriesCreated).toHaveLength(1);
    expect(result.duplicateWarnings).toEqual([]);
    expect(result.message).toContain('NYC');
    expect(await h.memoryRepository.findByUser(userId, {} as ListMemoriesQuery)).toMatchObject({
      items: [{ content: 'I live in NYC', turnId: result.turnId }],
    });
    const messages = await h.conversationRepository.listMessages(result.conversationId);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages.map((message) => message.turnId)).toEqual([result.turnId, result.turnId]);
    expect(model.calls[1][0].content).toContain('I live in NYC');

    const turn = await h.chatTurnRepository.findById(userId, result.turnId);
    expect(turn?.status).toBe('completed');
    expect(turn?.resultSnapshot?.message).toBe(result.message);
  });

  it('skips persisting a duplicate and reports the existing memory', async () => {
    const h = harness();
    const existing = Memory.create({
      userId,
      type: 'long_term',
      content: 'I live in NYC',
    });
    await h.memoryRepository.save(existing);
    h.vectorStore.results = [{ id: 'point-0', memoryId: existing.id, chunkIndex: 0, score: 0.98 }];
    const model = new ScriptedChatModel([
      '{"intent":"remember","memories":[{"content":"I live in NYC","type":"long_term","confidence":0.9}]}',
      'I already knew that you live in NYC.',
    ]);

    const result = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Remember that I live in NYC' },
    );

    expect(result.memoriesCreated).toEqual([]);
    expect(result.duplicateWarnings).toEqual([{ existingMemoryId: existing.id, similarity: 0.98 }]);
    const listed = await h.memoryRepository.findByUser(userId, {} as ListMemoriesQuery);
    expect(listed.items).toHaveLength(1);
  });

  it('retrieves memories for recall and returns their ids', async () => {
    const h = harness();
    const existing = Memory.create({
      userId,
      type: 'long_term',
      content: 'I live in Paris',
    });
    await h.memoryRepository.save(existing);
    h.vectorStore.results = [{ id: 'point-0', memoryId: existing.id, chunkIndex: 0, score: 0.93 }];
    const model = new ScriptedChatModel([
      '{"intent":"recall","memories":[]}',
      'You live in Paris.',
    ]);

    const result = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Where do I live?' },
    );

    expect(result.memoriesRetrieved).toEqual([existing.id]);
    expect(result.message).toContain('Paris');
    expect(model.calls[1][0].content).toContain('<retrieved_memories>');
    expect(model.calls[1][0].content).toContain('I live in Paris');
  });

  it('treats a personal question classified as general as recall', async () => {
    const h = harness();
    const existing = Memory.create({
      userId,
      type: 'long_term',
      content: 'I work as a marine biologist',
    });
    await h.memoryRepository.save(existing);
    h.vectorStore.results = [{ id: 'point-0', memoryId: existing.id, chunkIndex: 0, score: 0.91 }];
    const model = new ScriptedChatModel([
      '{"intent":"general","memories":[]}',
      'You work as a marine biologist.',
    ]);

    const result = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'What is my job?' },
    );

    expect(result.memoriesRetrieved).toEqual([existing.id]);
    expect(model.calls[1][0].content).toContain('I work as a marine biologist');
  });

  it('marks the turn failed when classification fails and keeps only the user message', async () => {
    const h = harness();
    const model = new ScriptedChatModel([new Error('model down')]);

    const error = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Hello there' },
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ChatTurnFailedError);
    const turnId = (error as ChatTurnFailedError).turnId;
    const turn = await h.chatTurnRepository.findById(userId, turnId);
    expect(turn?.status).toBe('failed');
    expect(turn?.errorCode).toBe('CHAT_TURN_ERROR');

    const messages = await h.conversationRepository.listMessages(turn!.conversationId);
    expect(messages.map((message) => message.role)).toEqual(['user']);
  });

  it('retries a failed turn without duplicating the user message', async () => {
    const h = harness();
    const model = new ScriptedChatModel([
      new Error('classify down'),
      '{"intent":"general","memories":[]}',
      'Recovered.',
    ]);

    const error = (await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Hello there' },
    ).catch((err: unknown) => err)) as ChatTurnFailedError;

    const retried = await retryChatTurn(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, turnId: error.turnId, correlationId },
    );

    expect(retried.replayed).toBe(false);
    expect(retried.result.turnId).toBe(error.turnId);
    expect(retried.result.message).toBe('Recovered.');

    const messages = await h.conversationRepository.listMessages(retried.result.conversationId);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages.every((message) => message.turnId === error.turnId)).toBe(true);

    // The retried respond call must not see the turn's user message twice.
    const finalCall = JSON.stringify(model.calls.at(-1));
    expect(finalCall.split('Hello there')).toHaveLength(2);

    const turn = await h.chatTurnRepository.findById(userId, error.turnId);
    expect(turn?.status).toBe('completed');
    expect(turn?.attempts).toBe(2);

    const retryAudits = h.auditLogRepository.entries.filter(
      (entry) => entry.action === 'chat.turn.retry',
    );
    expect(retryAudits).toHaveLength(1);
    expect(retryAudits[0]).toMatchObject({
      userId,
      entityType: 'chat_turn',
      entityId: error.turnId,
      correlationId,
      payloadSnapshot: { attempt: 2 },
    });
  });

  it('reuses memories written before a failure instead of duplicating them', async () => {
    const h = harness();
    const classification =
      '{"intent":"remember","memories":[{"content":"I live in NYC","type":"long_term","confidence":0.9}]}';
    const model = new ScriptedChatModel([
      classification,
      new Error('respond down'),
      classification,
      'Saved.',
    ]);

    const error = (await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Remember that I live in NYC' },
    ).catch((err: unknown) => err)) as ChatTurnFailedError;

    expect(await h.memoryRepository.findByUser(userId, {} as ListMemoriesQuery)).toMatchObject({
      items: [{ content: 'I live in NYC' }],
    });
    const memoryAudits = () =>
      h.auditLogRepository.entries.filter((entry) => entry.action === 'memory.create');
    expect(memoryAudits()).toHaveLength(1);

    const retried = await retryChatTurn(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, turnId: error.turnId, correlationId },
    );

    expect(retried.result.memoriesCreated).toHaveLength(1);
    expect(await h.memoryRepository.findByUser(userId, {} as ListMemoriesQuery)).toMatchObject({
      items: [{ content: 'I live in NYC' }],
    });
    expect(memoryAudits()).toHaveLength(1);
    expect(
      h.auditLogRepository.entries.filter((entry) => entry.action === 'chat.turn.retry'),
    ).toHaveLength(1);
  });

  it('replays a completed turn for the same idempotency key without calling the model again', async () => {
    const h = harness();
    const model = new ScriptedChatModel(['{"intent":"general","memories":[]}', 'Hello!']);

    const first = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Hello there', idempotencyKey: 'key-1' },
    );
    const conversationsBeforeReplay = h.conversationRepository.size;
    const second = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Hello there', idempotencyKey: 'key-1' },
    );

    expect(second.turnId).toBe(first.turnId);
    expect(second.conversationId).toBe(first.conversationId);
    expect(h.conversationRepository.size).toBe(conversationsBeforeReplay);
    expect(model.calls).toHaveLength(2);
    const messages = await h.conversationRepository.listMessages(first.conversationId);
    expect(messages).toHaveLength(2);
  });

  it('auto-resumes a failed turn with the same idempotency key on its original conversation', async () => {
    const h = harness();
    const model = new ScriptedChatModel([
      new Error('model down'),
      '{"intent":"general","memories":[]}',
      'Recovered.',
    ]);

    const error = (await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Hello there', idempotencyKey: 'key-resume' },
    ).catch((err: unknown) => err)) as ChatTurnFailedError;
    const conversationsAfterFailure = h.conversationRepository.size;

    const resumed = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Hello there', idempotencyKey: 'key-resume' },
    );

    expect(resumed.turnId).toBe(error.turnId);
    expect(resumed.conversationId).toBe(error.conversationId);
    expect(resumed.message).toBe('Recovered.');
    expect(h.conversationRepository.size).toBe(conversationsAfterFailure);

    const messages = await h.conversationRepository.listMessages(resumed.conversationId);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);

    const turn = await h.chatTurnRepository.findById(userId, error.turnId);
    expect(turn?.status).toBe('completed');
    expect(turn?.attempts).toBe(2);
  });

  it('rejects a fresh in-progress turn for the same idempotency key', async () => {
    const h = harness();
    const conversation = await h.conversationRepository.createConversation(userId, 'test');
    const started = await h.chatTurnRepository.start({
      userId,
      conversationId: conversation.id,
      correlationId,
      userMessage: 'Hello there',
      idempotencyKey: 'key-busy',
      lockToken: randomUUID(),
      lockedUntil: new Date(Date.now() + 60_000),
      maxAttempts: 5,
    });
    expect(started.kind).toBe('started');

    const model = new ScriptedChatModel([]);
    const error = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      {
        userId,
        correlationId,
        conversationId: conversation.id,
        message: 'Hello there',
        idempotencyKey: 'key-busy',
      },
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).details).toMatchObject({
      code: 'CHAT_TURN_IN_PROGRESS',
      turnId: started.kind === 'started' ? started.turn.id : '',
    });
  });

  it('rejects an idempotency key reused for a different message', async () => {
    const h = harness();
    const model = new ScriptedChatModel(['{"intent":"general","memories":[]}', 'Hello!']);

    const first = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Hello there', idempotencyKey: 'key-2' },
    );

    const error = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      {
        userId,
        correlationId,
        conversationId: first.conversationId,
        message: 'A different message',
        idempotencyKey: 'key-2',
      },
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).details).toMatchObject({
      code: 'CHAT_TURN_KEY_REUSE',
      turnId: first.turnId,
    });
  });

  it('replays a completed turn when retried', async () => {
    const h = harness();
    const model = new ScriptedChatModel(['{"intent":"general","memories":[]}', 'Hello!']);
    const first = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Hello there' },
    );

    const retried = await retryChatTurn(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, turnId: first.turnId, correlationId },
    );

    expect(retried.replayed).toBe(true);
    expect(retried.result.turnId).toBe(first.turnId);
    expect(model.calls).toHaveLength(2);
  });

  it("does not retry another user's turn", async () => {
    const h = harness();
    const model = new ScriptedChatModel(['{"intent":"general","memories":[]}', 'Hello!']);
    const first = await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
      ),
      { userId, correlationId, message: 'Hello there' },
    );

    await expect(
      retryChatTurn(
        deps(
          model,
          h.memoryRepository,
          h.vectorStore,
          h.conversationRepository,
          h.chatTurnRepository,
          h.auditLogRepository,
        ),
        {
          userId: '22222222-2222-4222-8222-222222222222',
          turnId: first.turnId,
          correlationId,
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('stops retrying after the attempt limit', async () => {
    const h = harness();
    const model = new ScriptedChatModel([new Error('model down')]);
    const error = (await chat(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
        1,
      ),
      { userId, correlationId, message: 'Hello there' },
    ).catch((err: unknown) => err)) as ChatTurnFailedError;

    const retryError = await retryChatTurn(
      deps(
        model,
        h.memoryRepository,
        h.vectorStore,
        h.conversationRepository,
        h.chatTurnRepository,
        h.auditLogRepository,
        1,
      ),
      { userId, turnId: error.turnId, correlationId },
    ).catch((err: unknown) => err);

    expect(retryError).toBeInstanceOf(ConflictError);
    expect((retryError as ConflictError).details).toMatchObject({
      code: 'CHAT_TURN_RETRY_EXHAUSTED',
      turnId: error.turnId,
    });
  });
});
