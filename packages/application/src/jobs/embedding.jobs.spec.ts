import { describe, expect, it } from 'vitest';
import {
  Memory,
  type EmbeddingProvider,
  type JobQueue,
  type ListMemoriesQuery,
  type MemoryEmbeddingStore,
  type MemoryRepository,
  type PaginatedResult,
  type VectorSearchParams,
  type VectorSearchResult,
  type VectorStore,
  type AuditLogRepository,
} from '@smriti/domain';
import { handleDeleteVectors, handleEmbedAndIndex } from './embedding.jobs.js';
import { searchMemories } from '../queries/search-memories.query.js';
import { createMemory } from '../commands/create-memory.command.js';

class FakeMemoryRepo implements MemoryRepository {
  private readonly map = new Map<string, Memory>();
  async save(m: Memory): Promise<void> {
    this.map.set(m.id, m);
  }
  async findById(userId: string, id: string): Promise<Memory | null> {
    const m = this.map.get(id);
    return m && m.userId === userId ? m : null;
  }
  async findByUser(userId: string, _q: ListMemoriesQuery): Promise<PaginatedResult<Memory>> {
    const items = [...this.map.values()].filter((m) => m.userId === userId);
    return { items, nextCursor: null };
  }
  async update(m: Memory): Promise<void> {
    this.map.set(m.id, m);
  }
  async delete(userId: string, id: string): Promise<boolean> {
    const m = this.map.get(id);
    if (!m || m.userId !== userId) return false;
    this.map.delete(id);
    return true;
  }
}

class FakeAudit implements AuditLogRepository {
  async append(): Promise<void> {}
}

class FakeQueue implements JobQueue {
  readonly jobs: Array<{ name: string; data: unknown; opts?: { jobId?: string } }> = [];
  async enqueue(name: string, data: unknown, opts?: { jobId?: string }): Promise<void> {
    if (opts?.jobId && this.jobs.some((j) => j.name === name && j.opts?.jobId === opts.jobId))
      return;
    this.jobs.push({ name, data, opts });
  }
}

class FakeEmbed implements EmbeddingProvider {
  readonly model = 'fake';
  readonly dimension = 4;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      let h = 0;
      for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 1000;
      const b = h / 1000;
      return [b, b * 0.5, b * 0.25, 1 - b];
    });
  }
}

class FakeVectors implements VectorStore {
  private readonly pts = new Map<
    string,
    { vector: number[]; userId: string; memoryId: string; chunkIndex: number }
  >();
  async ensureCollection(): Promise<void> {}
  async upsert(
    points: Array<{
      id: string;
      vector: number[];
      payload: { userId: string; memoryId: string; chunkIndex: number };
    }>,
  ): Promise<void> {
    for (const p of points) this.pts.set(p.id, { vector: p.vector, ...p.payload });
  }
  async deleteByMemoryId(memoryId: string): Promise<void> {
    for (const [id, p] of this.pts) {
      if (p.memoryId === memoryId || id === memoryId || id.startsWith(`${memoryId}_`))
        this.pts.delete(id);
    }
  }
  async search(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    const out: VectorSearchResult[] = [];
    for (const [id, p] of this.pts) {
      if (p.userId !== params.filter.userId) continue;
      out.push({ id, memoryId: p.memoryId, chunkIndex: p.chunkIndex, score: 0.9 });
    }
    return out.slice(0, params.limit);
  }
}

class FakeEmbeddingStore implements MemoryEmbeddingStore {
  readonly records = new Map<string, unknown[]>();
  async replaceForMemory(r: never[]): Promise<void> {
    if (r.length) this.records.set((r[0] as { memoryId: string }).memoryId, [...r]);
  }
  async markStatus(): Promise<void> {}
  async deleteForMemory(memoryId: string): Promise<void> {
    this.records.delete(memoryId);
  }
}

describe('vector pipeline', () => {
  it('enqueues embed job on create, indexes, searches, and deletes', async () => {
    const memoryRepo = new FakeMemoryRepo();
    const auditRepo = new FakeAudit();
    const jobQueue = new FakeQueue();
    const embedding = new FakeEmbed();
    const vectors = new FakeVectors();
    const embeddingStore = new FakeEmbeddingStore();

    const dto = await createMemory(
      { memoryRepository: memoryRepo, auditLogRepository: auditRepo, jobQueue },
      { userId: 'user-1', correlationId: 'corr-1' },
      { type: 'long_term', content: 'I live in NYC and love pizza' },
    );
    expect(dto.indexingStatus).toBe('pending');
    expect(jobQueue.jobs).toHaveLength(1);
    expect(jobQueue.jobs[0].name).toBe('embed-and-index');

    const payload = jobQueue.jobs[0].data as {
      memoryId: string;
      userId: string;
      contentHash: string;
      correlationId: string;
    };
    await handleEmbedAndIndex(
      {
        memoryRepository: memoryRepo,
        embeddingProvider: embedding,
        vectorStore: vectors,
        embeddingStore,
        embeddingProviderName: 'fake',
      },
      payload,
    );

    const result = await searchMemories(
      { memoryRepository: memoryRepo, embeddingProvider: embedding, vectorStore: vectors },
      { userId: 'user-1', query: 'Where do I live?', limit: 10 },
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(dto.id);

    const other = await searchMemories(
      { memoryRepository: memoryRepo, embeddingProvider: embedding, vectorStore: vectors },
      { userId: 'user-2', query: 'Where do I live?', limit: 10 },
    );
    expect(other.items).toHaveLength(0);

    await handleDeleteVectors({ vectorStore: vectors, embeddingStore }, { memoryId: dto.id });
    const afterDelete = await searchMemories(
      { memoryRepository: memoryRepo, embeddingProvider: embedding, vectorStore: vectors },
      { userId: 'user-1', query: 'Where do I live?', limit: 10 },
    );
    expect(afterDelete.items).toHaveLength(0);
  });

  it('skips stale jobs when content changed after enqueue', async () => {
    const memoryRepo = new FakeMemoryRepo();
    const embedding = new FakeEmbed();
    const vectors = new FakeVectors();
    const embeddingStore = new FakeEmbeddingStore();

    const memory = Memory.create({
      userId: 'u',
      type: 'semantic',
      content: 'original content here',
    });
    await memoryRepo.save(memory);
    memory.update({ content: 'updated content here' });
    await memoryRepo.update(memory);

    await handleEmbedAndIndex(
      {
        memoryRepository: memoryRepo,
        embeddingProvider: embedding,
        vectorStore: vectors,
        embeddingStore,
        embeddingProviderName: 'fake',
      },
      { memoryId: memory.id, userId: 'u', contentHash: 'stale-hash', correlationId: 'c' },
    );
    const result = await searchMemories(
      { memoryRepository: memoryRepo, embeddingProvider: embedding, vectorStore: vectors },
      { userId: 'u', query: 'updated', limit: 10 },
    );
    expect(result.items).toHaveLength(0);
  });
});
