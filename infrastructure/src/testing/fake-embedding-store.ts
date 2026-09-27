import type { MemoryEmbeddingRecord, MemoryEmbeddingStore } from '@smriti/domain';

export class InMemoryEmbeddingStore implements MemoryEmbeddingStore {
  readonly records = new Map<string, MemoryEmbeddingRecord[]>();

  async replaceForMemory(records: MemoryEmbeddingRecord[]): Promise<void> {
    if (records.length === 0) return;
    this.records.set(records[0].memoryId, [...records]);
  }

  async markStatus(memoryId: string, status: 'pending' | 'indexed' | 'failed'): Promise<void> {
    const existing = this.records.get(memoryId) ?? [];
    this.records.set(
      memoryId,
      existing.map((r) => ({ ...r, status })),
    );
  }

  async deleteForMemory(memoryId: string): Promise<void> {
    this.records.delete(memoryId);
  }
}
