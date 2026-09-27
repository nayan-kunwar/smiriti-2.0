import type { MemoryEmbeddingRecord, MemoryEmbeddingStore } from '@smriti/domain';
import type { PrismaClient } from '@prisma/client';

export class PrismaMemoryEmbeddingStore implements MemoryEmbeddingStore {
  constructor(private readonly prisma: PrismaClient) {}

  async replaceForMemory(records: MemoryEmbeddingRecord[]): Promise<void> {
    if (records.length === 0) return;
    const memoryId = records[0].memoryId;
    await this.prisma.$transaction([
      this.prisma.memoryEmbedding.deleteMany({ where: { memoryId } }),
      this.prisma.memoryEmbedding.createMany({
        data: records.map((r) => ({
          memoryId: r.memoryId,
          chunkIndex: r.chunkIndex,
          tokenCount: r.tokenCount,
          provider: r.provider,
          model: r.model,
          dimension: r.dimension,
          qdrantPointId: r.qdrantPointId,
          status: r.status,
        })),
      }),
    ]);
  }

  async markStatus(memoryId: string, status: 'pending' | 'indexed' | 'failed'): Promise<void> {
    await this.prisma.memoryEmbedding.updateMany({
      where: { memoryId },
      data: {
        status,
        ...(status === 'indexed' ? { indexedAt: new Date() } : {}),
      },
    });
  }

  async deleteForMemory(memoryId: string): Promise<void> {
    await this.prisma.memoryEmbedding.deleteMany({ where: { memoryId } });
  }
}
