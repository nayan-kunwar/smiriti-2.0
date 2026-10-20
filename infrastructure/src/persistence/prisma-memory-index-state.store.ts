import type {
  EmbeddingStatus,
  MemoryIndexStateRecord,
  MemoryIndexStateStore,
} from '@smriti/domain';
import type { PrismaClient } from '@prisma/client';

export class PrismaMemoryIndexStateStore implements MemoryIndexStateStore {
  constructor(private readonly prisma: PrismaClient) {}

  async markPending(memoryId: string, contentHash: string): Promise<void> {
    await this.prisma.memoryIndexState.upsert({
      where: { memoryId },
      create: { memoryId, contentHash, status: 'pending' },
      update: { contentHash, status: 'pending', error: null },
    });
  }

  async markIndexed(memoryId: string, contentHash: string): Promise<void> {
    // Hash guard: a stale job must never mark newer content as indexed.
    const updated = await this.prisma.memoryIndexState.updateMany({
      where: { memoryId, contentHash },
      data: { status: 'indexed', error: null },
    });
    if (updated.count === 0) {
      // Jobs can be enqueued outside create/update (e.g. a manual reindex);
      // create the state only when no row exists for this memory.
      await this.prisma.memoryIndexState.createMany({
        data: [{ memoryId, contentHash, status: 'indexed', updatedAt: new Date() }],
        skipDuplicates: true,
      });
    }
  }

  async markFailed(memoryId: string, contentHash: string, error: string): Promise<void> {
    const updated = await this.prisma.memoryIndexState.updateMany({
      where: { memoryId, contentHash },
      data: { status: 'failed', error },
    });
    if (updated.count === 0) {
      await this.prisma.memoryIndexState.createMany({
        data: [{ memoryId, contentHash, status: 'failed', error, updatedAt: new Date() }],
        skipDuplicates: true,
      });
    }
  }

  async findByMemoryIds(memoryIds: string[]): Promise<Map<string, MemoryIndexStateRecord>> {
    if (memoryIds.length === 0) return new Map();
    const rows = await this.prisma.memoryIndexState.findMany({
      where: { memoryId: { in: memoryIds } },
    });
    return new Map(
      rows.map((row) => [
        row.memoryId,
        {
          memoryId: row.memoryId,
          contentHash: row.contentHash,
          status: row.status as EmbeddingStatus,
          error: row.error,
          updatedAt: row.updatedAt,
        },
      ]),
    );
  }
}
