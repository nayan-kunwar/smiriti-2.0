import type {
  BeginIdempotencyInput,
  BeginIdempotencyResult,
  IdempotencyRecord,
  IdempotencyStore,
} from '@smriti/domain';

function cloneRecord(record: IdempotencyRecord): IdempotencyRecord {
  return {
    ...record,
    responseSnapshot:
      record.responseSnapshot === null ? null : structuredClone(record.responseSnapshot),
    lockedUntil: record.lockedUntil ? new Date(record.lockedUntil) : null,
    expiresAt: new Date(record.expiresAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly records = new Map<string, IdempotencyRecord>();

  async begin(input: BeginIdempotencyInput): Promise<BeginIdempotencyResult> {
    const now = new Date();
    const existing = this.records.get(input.key);

    if (!existing) {
      this.records.set(input.key, this.newRecord(input, now));
      return { kind: 'acquired', lockToken: input.lockToken };
    }

    const stale =
      existing.expiresAt <= now ||
      (existing.status === 'in_progress' &&
        (existing.lockedUntil === null || existing.lockedUntil <= now));

    if (stale) {
      this.records.set(input.key, this.newRecord(input, now));
      return { kind: 'acquired', lockToken: input.lockToken };
    }

    const record = cloneRecord(existing);
    if (existing.requestHash !== input.requestHash) {
      return { kind: 'conflict', reason: 'request_mismatch', record };
    }
    if (existing.status === 'completed') {
      return { kind: 'replay', record };
    }
    return { kind: 'conflict', reason: 'in_progress', record };
  }

  async complete(input: {
    key: string;
    requestHash: string;
    lockToken: string;
    responseStatus: number;
    responseSnapshot: unknown;
  }): Promise<void> {
    const existing = this.records.get(input.key);
    if (!existing || existing.requestHash !== input.requestHash) return;
    if (existing.lockToken !== input.lockToken || existing.status !== 'in_progress') return;
    this.records.set(input.key, {
      ...existing,
      status: 'completed',
      responseStatus: input.responseStatus,
      responseSnapshot:
        input.responseSnapshot === undefined ? null : structuredClone(input.responseSnapshot),
      lockToken: null,
      lockedUntil: null,
      updatedAt: new Date(),
    });
  }

  async abort(key: string, requestHash: string, lockToken: string): Promise<void> {
    const existing = this.records.get(key);
    if (
      existing?.requestHash === requestHash &&
      existing.lockToken === lockToken &&
      existing.status === 'in_progress'
    ) {
      this.records.delete(key);
    }
  }

  async deleteExpired(now: Date): Promise<number> {
    let deleted = 0;
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  private newRecord(input: BeginIdempotencyInput, now: Date): IdempotencyRecord {
    return {
      key: input.key,
      userId: input.userId,
      requestHash: input.requestHash,
      status: 'in_progress',
      responseStatus: null,
      responseSnapshot: null,
      lockToken: input.lockToken,
      lockedUntil: new Date(input.lockedUntil),
      expiresAt: new Date(input.expiresAt),
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }
}
