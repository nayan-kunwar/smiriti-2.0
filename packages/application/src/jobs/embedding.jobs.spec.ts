import { describe, expect, it } from 'vitest';
import {
  Memory,
  type EmbeddingProvider,
  type JobQueue,
  type ListMemoriesQuery,
  type MemoryEmbeddingStore,
  type MemoryIndexStateRecord,
  type MemoryIndexStateStore,
  type MemoryRepository,
  type PaginatedResult,
  type VectorSearchParams,
  type VectorSearchResult,
  type VectorPoint,
  type VectorPointRef,
  type VectorScanPage,
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
  async findAll(cursor: string | undefined, limit: number): Promise<PaginatedResult<Memory>> {
    const items = [...this.map.values()].sort((a, b) => a.id.localeCompare(b.id));
    let start = 0;
    if (cursor) {
      const index = items.findIndex((m) => m.id === cursor);
      start = index >= 0 ? index + 1 : 0;
    }
    const page = items.slice(start, start + limit);
    return {
      items: page,
      nextCursor: start + limit < items.length ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
  async existsByIds(ids: string[]): Promise<Set<string>> {
    return new Set(ids.filter((id) => this.map.has(id)));
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
  readonly maxInputTokens = 900;
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
  async upsert(points: VectorPoint[]): Promise<void> {
    for (const p of points) {
      this.pts.set(p.id, {
        vector: p.vector,
        userId: p.payload.userId,
        memoryId: p.payload.memoryId,
        chunkIndex: p.payload.chunkIndex,
      });
    }
  }
  async deleteByMemoryId(memoryId: string): Promise<void> {
    for (const [id, p] of this.pts) {
      if (p.memoryId === memoryId || id === memoryId || id.startsWith(`${memoryId}_`))
        this.pts.delete(id);
    }
  }
  async deletePoints(ids: string[]): Promise<void> {
    for (const id of ids) this.pts.delete(id);
  }
  async listPointsByMemoryId(memoryId: string): Promise<VectorPointRef[]> {
    return [...this.pts.entries()]
      .filter(([, p]) => p.memoryId === memoryId)
      .map(([id, p]) => ({ id, memoryId: p.memoryId, chunkIndex: p.chunkIndex }));
  }
  async scanPoints(cursor?: string | null, limit = 256): Promise<VectorScanPage> {
    const items = [...this.pts.entries()].sort(([a], [b]) => a.localeCompare(b));
    let start = 0;
    if (cursor) {
      const index = items.findIndex(([id]) => id === cursor);
      start = index >= 0 ? index + 1 : 0;
    }
    const page = items.slice(start, start + limit);
    return {
      points: page.map(([id, p]) => ({
        id,
        memoryId: p.memoryId,
        chunkIndex: p.chunkIndex,
      })),
      nextCursor: start + limit < items.length ? (page[page.length - 1]?.[0] ?? null) : null,
    };
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

class FakeIndexStateStore implements MemoryIndexStateStore {
  readonly states = new Map<string, MemoryIndexStateRecord>();

  async markPending(memoryId: string, contentHash: string): Promise<void> {
    this.states.set(memoryId, {
      memoryId,
      contentHash,
      status: 'pending',
      error: null,
      updatedAt: new Date(),
    });
  }

  async markIndexed(memoryId: string, contentHash: string): Promise<void> {
    const state = this.states.get(memoryId);
    if (!state) {
      this.states.set(memoryId, {
        memoryId,
        contentHash,
        status: 'indexed',
        error: null,
        updatedAt: new Date(),
      });
      return;
    }
    if (state.contentHash !== contentHash) return;
    this.states.set(memoryId, { ...state, status: 'indexed', error: null });
  }

  async markFailed(memoryId: string, contentHash: string, error: string): Promise<void> {
    const state = this.states.get(memoryId);
    if (!state) {
      this.states.set(memoryId, {
        memoryId,
        contentHash,
        status: 'failed',
        error,
        updatedAt: new Date(),
      });
      return;
    }
    if (state.contentHash !== contentHash) return;
    this.states.set(memoryId, { ...state, status: 'failed', error });
  }

  async findByMemoryIds(memoryIds: string[]): Promise<Map<string, MemoryIndexStateRecord>> {
    const result = new Map<string, MemoryIndexStateRecord>();
    for (const id of memoryIds) {
      const state = this.states.get(id);
      if (state) result.set(id, { ...state });
    }
    return result;
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
    const indexStateStore = new FakeIndexStateStore();

    const dto = await createMemory(
      {
        memoryRepository: memoryRepo,
        auditLogRepository: auditRepo,
        jobQueue,
        indexStateStore,
      },
      { userId: 'user-1', correlationId: 'corr-1' },
      { type: 'long_term', content: 'I live in NYC and love pizza' },
    );
    expect(dto.indexingStatus).toBe('pending');
    expect(indexStateStore.states.get(dto.id)?.status).toBe('pending');
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
        indexStateStore,
        embeddingProviderName: 'fake',
      },
      payload,
    );

    expect(indexStateStore.states.get(dto.id)?.status).toBe('indexed');

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
    const indexStateStore = new FakeIndexStateStore();

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
        indexStateStore,
        embeddingProviderName: 'fake',
      },
      { memoryId: memory.id, userId: 'u', contentHash: 'stale-hash', correlationId: 'c' },
    );
    expect(indexStateStore.states.has(memory.id)).toBe(false);
    const result = await searchMemories(
      { memoryRepository: memoryRepo, embeddingProvider: embedding, vectorStore: vectors },
      { userId: 'u', query: 'updated', limit: 10 },
    );
    expect(result.items).toHaveLength(0);
  });

  it('prunes stale chunk points when content shrinks', async () => {
    const memoryRepo = new FakeMemoryRepo();
    const embedding = new FakeEmbed();
    const vectors = new FakeVectors();
    const embeddingStore = new FakeEmbeddingStore();
    const indexStateStore = new FakeIndexStateStore();

    const memory = Memory.create({
      userId: 'u',
      type: 'semantic',
      content: 'alpha beta gamma delta '.repeat(300),
    });
    await memoryRepo.save(memory);

    await handleEmbedAndIndex(
      {
        memoryRepository: memoryRepo,
        embeddingProvider: embedding,
        vectorStore: vectors,
        embeddingStore,
        indexStateStore,
        embeddingProviderName: 'fake',
      },
      {
        memoryId: memory.id,
        userId: 'u',
        contentHash: memory.contentHash,
        correlationId: 'c',
      },
    );
    expect((await vectors.listPointsByMemoryId(memory.id)).length).toBeGreaterThan(1);

    memory.update({ content: 'short content after edit' });
    await memoryRepo.update(memory);
    await handleEmbedAndIndex(
      {
        memoryRepository: memoryRepo,
        embeddingProvider: embedding,
        vectorStore: vectors,
        embeddingStore,
        indexStateStore,
        embeddingProviderName: 'fake',
      },
      {
        memoryId: memory.id,
        userId: 'u',
        contentHash: memory.contentHash,
        correlationId: 'c',
      },
    );

    const remaining = await vectors.listPointsByMemoryId(memory.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].chunkIndex).toBe(0);
  });
});
