export type IdempotencyStatus = 'in_progress' | 'completed';

export interface IdempotencyRecord {
  key: string;
  userId: string;
  requestHash: string;
  status: IdempotencyStatus;
  responseStatus: number | null;
  responseSnapshot: unknown | null;
  lockToken: string | null;
  lockedUntil: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface BeginIdempotencyInput {
  key: string;
  userId: string;
  requestHash: string;
  lockToken: string;
  expiresAt: Date;
  lockedUntil: Date;
}

export type IdempotencyConflictReason = 'request_mismatch' | 'in_progress';

export type BeginIdempotencyResult =
  | { kind: 'acquired'; lockToken: string }
  | { kind: 'replay'; record: IdempotencyRecord }
  | { kind: 'conflict'; reason: IdempotencyConflictReason; record: IdempotencyRecord };

export interface IdempotencyStore {
  /**
   * Atomically reserves the key or returns the existing completed/in-progress
   * record. Expired records and stale in-progress locks may be taken over.
   */
  begin(input: BeginIdempotencyInput): Promise<BeginIdempotencyResult>;
  complete(input: {
    key: string;
    requestHash: string;
    lockToken: string;
    responseStatus: number;
    responseSnapshot: unknown;
  }): Promise<void>;
  /** Releases a reservation after a failed request. */
  abort(key: string, requestHash: string, lockToken: string): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}
