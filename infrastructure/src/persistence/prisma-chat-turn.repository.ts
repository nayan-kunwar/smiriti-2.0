import type {
  ChatTurnRecord,
  ChatTurnRepository,
  ChatTurnResultSnapshot,
  ChatTurnStatus,
  ClaimChatTurnInput,
  ClaimChatTurnResult,
  FailChatTurnInput,
  FinalizeChatTurnInput,
  StartChatTurnInput,
  StartChatTurnResult,
} from '@smriti/domain';
import { Prisma, type ChatTurn as PrismaChatTurn, type PrismaClient } from '@prisma/client';

const MAX_ERROR_LENGTH = 500;

function toResultSnapshot(value: Prisma.JsonValue | null): ChatTurnResultSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as unknown as ChatTurnResultSnapshot;
}

function toRecord(row: PrismaChatTurn): ChatTurnRecord {
  return {
    id: row.id,
    userId: row.userId,
    conversationId: row.conversationId,
    status: row.status as ChatTurnStatus,
    correlationId: row.correlationId,
    idempotencyKey: row.idempotencyKey,
    lockToken: row.lockToken,
    lockedUntil: row.lockedUntil,
    attempts: row.attempts,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    resultSnapshot: toResultSnapshot(row.resultSnapshot),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    failedAt: row.failedAt,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function isStale(row: PrismaChatTurn, now: Date): boolean {
  return (
    row.status === 'in_progress' &&
    (row.lockedUntil === null || row.lockedUntil.getTime() <= now.getTime())
  );
}

export class PrismaChatTurnRepository implements ChatTurnRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async start(input: StartChatTurnInput): Promise<StartChatTurnResult> {
    // The generic idempotency interceptor serializes most same-key requests,
    // but its reservation can expire while a turn is still running. Retry the
    // transaction on the unique-key race so the loser observes the winner.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.startOnce(input);
      } catch (err) {
        if (!input.idempotencyKey || !isUniqueViolation(err)) throw err;
      }
    }
    throw new Error('Unable to start chat turn after repeated idempotency races');
  }

  private startOnce(input: StartChatTurnInput): Promise<StartChatTurnResult> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      if (input.idempotencyKey) {
        const existing = await tx.chatTurn.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: input.userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
          include: {
            messages: {
              where: { role: 'user' },
              orderBy: { createdAt: 'asc' },
              take: 1,
            },
          },
        });

        if (existing) {
          const storedMessage = existing.messages[0]?.content;
          if (storedMessage !== undefined && storedMessage !== input.userMessage) {
            return { kind: 'key_mismatch', turn: toRecord(existing) };
          }
          if (existing.status === 'completed') {
            return { kind: 'replay', turn: toRecord(existing) };
          }
          if (existing.status === 'in_progress' && !isStale(existing, now)) {
            return { kind: 'in_progress', turn: toRecord(existing) };
          }
          if (existing.attempts >= input.maxAttempts) {
            return { kind: 'exhausted', turn: toRecord(existing) };
          }

          const resumed = await tx.chatTurn.update({
            where: { id: existing.id },
            data: {
              status: 'in_progress',
              correlationId: input.correlationId,
              lockToken: input.lockToken,
              lockedUntil: input.lockedUntil,
              attempts: { increment: 1 },
              errorCode: null,
              errorMessage: null,
              failedAt: null,
            },
          });
          return { kind: 'resumed', turn: toRecord(resumed) };
        }
      }

      const turn = await tx.chatTurn.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey ?? null,
          lockToken: input.lockToken,
          lockedUntil: input.lockedUntil,
          attempts: 1,
        },
      });

      await tx.conversationMessage.create({
        data: {
          conversationId: input.conversationId,
          role: 'user',
          content: input.userMessage,
          turnId: turn.id,
        },
      });
      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: now },
      });

      return { kind: 'started', turn: toRecord(turn) };
    });
  }

  async claimForRetry(input: ClaimChatTurnInput): Promise<ClaimChatTurnResult> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const existing = await tx.chatTurn.findFirst({
        where: { id: input.turnId, userId: input.userId },
        include: {
          messages: {
            where: { role: 'user' },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
      });

      if (!existing) return { kind: 'not_found' };
      if (existing.status === 'completed') {
        return { kind: 'replay', turn: toRecord(existing) };
      }
      if (existing.status === 'in_progress' && !isStale(existing, now)) {
        return { kind: 'in_progress', turn: toRecord(existing) };
      }
      if (existing.attempts >= input.maxAttempts) {
        return { kind: 'exhausted', turn: toRecord(existing) };
      }

      const claimed = await tx.chatTurn.updateMany({
        where: {
          id: input.turnId,
          userId: input.userId,
          OR: [
            { status: 'failed' },
            { status: 'in_progress', lockedUntil: null },
            { status: 'in_progress', lockedUntil: { lte: now } },
          ],
        },
        data: {
          status: 'in_progress',
          lockToken: input.lockToken,
          lockedUntil: input.lockedUntil,
          attempts: { increment: 1 },
          errorCode: null,
          errorMessage: null,
          failedAt: null,
        },
      });

      if (claimed.count !== 1) {
        const current = await tx.chatTurn.findUnique({ where: { id: input.turnId } });
        if (!current) return { kind: 'not_found' };
        if (current.status === 'completed') {
          return { kind: 'replay', turn: toRecord(current) };
        }
        return { kind: 'in_progress', turn: toRecord(current) };
      }

      const turn = await tx.chatTurn.findUniqueOrThrow({ where: { id: input.turnId } });
      return {
        kind: 'claimed',
        turn: toRecord(turn),
        userMessage: existing.messages[0]?.content ?? '',
      };
    });
  }

  async finalize(input: FinalizeChatTurnInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.chatTurn.updateMany({
        where: {
          id: input.turnId,
          userId: input.userId,
          status: 'in_progress',
          lockToken: input.lockToken,
        },
        data: {
          status: 'completed',
          resultSnapshot: input.result as unknown as Prisma.InputJsonValue,
          completedAt: now,
          lockToken: null,
          lockedUntil: null,
          errorCode: null,
          errorMessage: null,
        },
      });

      if (updated.count !== 1) {
        const current = await tx.chatTurn.findUnique({
          where: { id: input.turnId },
          select: { status: true },
        });
        // Another attempt already finalized the turn; never append a second
        // assistant message.
        if (current?.status === 'completed') return;
        throw new Error(`Chat turn lock lost while finalizing: ${input.turnId}`);
      }

      const turn = await tx.chatTurn.findUniqueOrThrow({
        where: { id: input.turnId },
        select: { conversationId: true },
      });
      await tx.conversationMessage.create({
        data: {
          conversationId: turn.conversationId,
          role: 'assistant',
          content: input.assistantMessage,
          turnId: input.turnId,
        },
      });
      await tx.conversation.update({
        where: { id: turn.conversationId },
        data: { updatedAt: now },
      });
    });
  }

  async fail(input: FailChatTurnInput): Promise<void> {
    await this.prisma.chatTurn.updateMany({
      where: {
        id: input.turnId,
        userId: input.userId,
        status: 'in_progress',
        lockToken: input.lockToken,
      },
      data: {
        status: 'failed',
        errorCode: input.errorCode,
        errorMessage: input.errorMessage.slice(0, MAX_ERROR_LENGTH),
        failedAt: new Date(),
        lockToken: null,
        lockedUntil: null,
      },
    });
  }

  async findById(userId: string, turnId: string): Promise<ChatTurnRecord | null> {
    const row = await this.prisma.chatTurn.findFirst({
      where: { id: turnId, userId },
    });
    return row ? toRecord(row) : null;
  }

  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<ChatTurnRecord | null> {
    const row = await this.prisma.chatTurn.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    return row ? toRecord(row) : null;
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.prisma.chatTurn.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
