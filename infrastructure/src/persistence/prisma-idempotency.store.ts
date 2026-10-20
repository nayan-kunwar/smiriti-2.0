import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  BeginIdempotencyInput,
  BeginIdempotencyResult,
  IdempotencyRecord,
  IdempotencyStore,
} from '@smriti/domain';

type IdempotencyRow = {
  key: string;
  userId: string;
  requestHash: string;
  status: 'in_progress' | 'completed';
  responseStatus: number | null;
  responseSnapshot: Prisma.JsonValue | null;
  lockToken: string | null;
  lockedUntil: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    key: row.key,
    userId: row.userId,
    requestHash: row.requestHash,
    status: row.status,
    responseStatus: row.responseStatus,
    responseSnapshot: row.responseSnapshot,
    lockToken: row.lockToken,
    lockedUntil: row.lockedUntil,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private readonly prisma: PrismaClient) {}

  async begin(input: BeginIdempotencyInput): Promise<BeginIdempotencyResult> {
    const now = new Date();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.prisma.idempotencyKey.create({
          data: {
            key: input.key,
            userId: input.userId,
            requestHash: input.requestHash,
            status: 'in_progress',
            lockToken: input.lockToken,
            lockedUntil: input.lockedUntil,
            expiresAt: input.expiresAt,
          },
        });
        return { kind: 'acquired', lockToken: input.lockToken };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }

      const existing = await this.prisma.idempotencyKey.findUnique({ where: { key: input.key } });
      if (!existing) continue;

      const stale =
        existing.expiresAt <= now ||
        (existing.status === 'in_progress' &&
          (existing.lockedUntil === null || existing.lockedUntil <= now));

      if (stale) {
        const updated = await this.prisma.idempotencyKey.updateMany({
          where: {
            key: input.key,
            OR: [
              { expiresAt: { lte: now } },
              { status: 'in_progress', lockedUntil: null },
              { status: 'in_progress', lockedUntil: { lte: now } },
            ],
          },
          data: {
            userId: input.userId,
            requestHash: input.requestHash,
            status: 'in_progress',
            responseStatus: null,
            responseSnapshot: Prisma.DbNull,
            lockToken: input.lockToken,
            lockedUntil: input.lockedUntil,
            expiresAt: input.expiresAt,
          },
        });
        if (updated.count === 1) return { kind: 'acquired', lockToken: input.lockToken };
        continue;
      }

      const record = toRecord(existing);
      if (existing.requestHash !== input.requestHash) {
        return { kind: 'conflict', reason: 'request_mismatch', record };
      }
      if (existing.status === 'completed') {
        return { kind: 'replay', record };
      }
      return { kind: 'conflict', reason: 'in_progress', record };
    }

    const existing = await this.prisma.idempotencyKey.findUnique({ where: { key: input.key } });
    if (!existing) {
      throw new Error(`Unable to acquire idempotency key ${input.key}`);
    }
    return { kind: 'conflict', reason: 'in_progress', record: toRecord(existing) };
  }

  async complete(input: {
    key: string;
    requestHash: string;
    lockToken: string;
    responseStatus: number;
    responseSnapshot: unknown;
  }): Promise<void> {
    await this.prisma.idempotencyKey.updateMany({
      where: {
        key: input.key,
        requestHash: input.requestHash,
        lockToken: input.lockToken,
        status: 'in_progress',
      },
      data: {
        status: 'completed',
        responseStatus: input.responseStatus,
        responseSnapshot: input.responseSnapshot as Prisma.InputJsonValue,
        lockToken: null,
        lockedUntil: null,
      },
    });
  }

  async abort(key: string, requestHash: string, lockToken: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({
      where: {
        key,
        requestHash,
        lockToken,
        status: 'in_progress',
      },
    });
  }

  async deleteExpired(now: Date): Promise<number> {
    const result = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return result.count;
  }
}
