export type ChatTurnStatus = 'in_progress' | 'completed' | 'failed';

export interface ChatTurnDuplicateWarning {
  existingMemoryId: string;
  similarity: number;
}

/**
 * The durable result of a completed turn. Stored on the turn so a replay after
 * a lost response (or a retry of a completed turn) does not re-run the graph.
 */
export interface ChatTurnResultSnapshot {
  turnId: string;
  conversationId: string;
  message: string;
  memoriesCreated: string[];
  memoriesRetrieved: string[];
  duplicateWarnings: ChatTurnDuplicateWarning[];
}

export interface ChatTurnRecord {
  id: string;
  userId: string;
  conversationId: string;
  status: ChatTurnStatus;
  correlationId: string;
  idempotencyKey: string | null;
  lockToken: string | null;
  lockedUntil: Date | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  resultSnapshot: ChatTurnResultSnapshot | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
}

export interface StartChatTurnInput {
  userId: string;
  conversationId: string;
  correlationId: string;
  userMessage: string;
  idempotencyKey?: string;
  lockToken: string;
  lockedUntil: Date;
  maxAttempts: number;
}

export type StartChatTurnResult =
  | { kind: 'started'; turn: ChatTurnRecord }
  /** An existing failed/stale turn with the same idempotency key was reclaimed. */
  | { kind: 'resumed'; turn: ChatTurnRecord }
  | { kind: 'replay'; turn: ChatTurnRecord }
  | { kind: 'in_progress'; turn: ChatTurnRecord }
  | { kind: 'key_mismatch'; turn: ChatTurnRecord }
  | { kind: 'exhausted'; turn: ChatTurnRecord };

export interface ClaimChatTurnInput {
  userId: string;
  turnId: string;
  lockToken: string;
  lockedUntil: Date;
  maxAttempts: number;
}

export type ClaimChatTurnResult =
  | { kind: 'claimed'; turn: ChatTurnRecord; userMessage: string }
  | { kind: 'replay'; turn: ChatTurnRecord }
  | { kind: 'in_progress'; turn: ChatTurnRecord }
  | { kind: 'exhausted'; turn: ChatTurnRecord }
  | { kind: 'not_found' };

export interface FinalizeChatTurnInput {
  userId: string;
  turnId: string;
  lockToken: string;
  assistantMessage: string;
  result: ChatTurnResultSnapshot;
}

export interface FailChatTurnInput {
  userId: string;
  turnId: string;
  lockToken: string;
  errorCode: string;
  errorMessage: string;
}

/**
 * Turn lifecycle operations are atomic: starting writes the user message with
 * the turn, and finalizing writes the assistant message with the completed
 * status. Implementations must guard transitions with the lock token so a
 * stale worker can never append a second assistant message.
 */
export interface ChatTurnRepository {
  start(input: StartChatTurnInput): Promise<StartChatTurnResult>;
  claimForRetry(input: ClaimChatTurnInput): Promise<ClaimChatTurnResult>;
  finalize(input: FinalizeChatTurnInput): Promise<void>;
  fail(input: FailChatTurnInput): Promise<void>;
  findById(userId: string, turnId: string): Promise<ChatTurnRecord | null>;
  /** Resolves a turn created by an earlier request with the same idempotency key. */
  findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<ChatTurnRecord | null>;
  /** Deletes turns created before `cutoff`; messages and memories keep their rows with `turn_id` nulled. */
  deleteOlderThan(cutoff: Date): Promise<number>;
}
