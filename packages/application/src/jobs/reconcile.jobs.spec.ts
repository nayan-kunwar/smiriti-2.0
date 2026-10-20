import { describe, expect, it } from 'vitest';
import {
  Memory,
  qdrantPointId,
  type JobQueue,
  type ListMemoriesQuery,
  type MemoryIndexStateRecord,
  type MemoryIndexStateStore,
  type MemoryRepository,
  type PaginatedResult,
  type VectorPoint,
  type VectorPointRef,
  type VectorScanPage,
  type VectorSearchParams,
  type VectorSearchResult,
  type VectorStore,
} from '@smriti/domain';
import { reconcileVectors } from './reconcile.jobs.js';

class FakeMemoryRepo implements MemoryRepository {
  readonly map = new Map<string, Memory>();
  findAllIds: Set<string> | null = null;

  async save(memory: Memory): Promise<void> {
    this.map.set(memory.id, memory);
  }

  async findById(userId: string, id: string): Promise<Memory | null> {
    const memory = this.map.get(id);
    return memory && memory.userId === userId ? memory : null;
  }

  async findByUser(userId: string, _query: ListMemoriesQuery): Promise<PaginatedResult<Memory>> {
    const items = [...this.map.values()].filter((m) => m.userId === userId);
    return { items, nextCursor: null };
  }

  async findAll(cursor: string | undefined, limit: number): Promise<PaginatedResult<Memory>> {
    let items = [...this.map.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (this.findAllIds) items = items.filter((m) => this.findAllIds!.has(m.id));
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

  async update(memory: Memory): Promise<void> {
    this.map.set(memory.id, memory);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const memory = this.map.get(id);
    if (!memory || memory.userId !== userId) return false;
    return this.map.delete(id);
  }
}

class FakeStateStore implements MemoryIndexStateStore {
  readonly states = new Map<string, MemoryIndexStateRecord>();

  set(memory: Memory, status: MemoryIndexStateRecord['status'], contentHash = memory.contentHash) {
    this.states.set(memory.id, {
      memoryId: memory.id,
      contentHash,
      status,
      error: null,
      updatedAt: new Date(),
    });
  }

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
    if (state && state.contentHash !== contentHash) return;
    this.states.set(memoryId, {
      memoryId,
      contentHash,
      status: 'indexed',
      error: null,
      updatedAt: new Date(),
    });
  }

  async markFailed(memoryId: string, contentHash: string, error: string): Promise<void> {
    const state = this.states.get(memoryId);
    if (state && state.contentHash !== contentHash) return;
    this.states.set(memoryId, {
      memoryId,
      contentHash,
      status: 'failed',
      error,
      updatedAt: new Date(),
    });
  }

  async findByMemoryIds(memoryIds: string[]): Promise<Map<string, MemoryIndexStateRecord>> {
    const result = new Map<string, MemoryIndexStateRecord>();
    for (const id of memoryIds) {
      const state = this.states.get(id);
      if (state) result.set(id, state);
    }
    return result;
  }
}

class FakeQueue implements JobQueue {
  readonly jobs: Array<{
    name: string;
    data: unknown;
    opts?: { jobId?: string; force?: boolean };
  }> = [];

  async enqueue(
    name: string,
    data: unknown,
    opts?: { jobId?: string; force?: boolean },
  ): Promise<void> {
    this.jobs.push({ name, data, opts });
  }
}

class FakeVectors implements VectorStore {
  protected readonly points = new Map<string, VectorPoint>();

  async ensureCollection(): Promise<void> {}

  async upsert(points: VectorPoint[]): Promise<void> {
    for (const point of points) this.points.set(point.id, point);
  }

  async deleteByMemoryId(memoryId: string): Promise<void> {
    for (const [id, point] of this.points) {
      if (point.payload.memoryId === memoryId) this.points.delete(id);
    }
  }

  async deletePoints(ids: string[]): Promise<void> {
    for (const id of ids) this.points.delete(id);
  }

  async listPointsByMemoryId(memoryId: string): Promise<VectorPointRef[]> {
    return [...this.points.entries()]
      .filter(([, point]) => point.payload.memoryId === memoryId)
      .map(([id, point]) => ({
        id,
        memoryId: point.payload.memoryId,
        chunkIndex: point.payload.chunkIndex,
      }));
  }

  async scanPoints(cursor?: string | null, limit = 256): Promise<VectorScanPage> {
    const items = [...this.points.entries()].sort(([a], [b]) => a.localeCompare(b));
    let start = 0;
    if (cursor) {
      const index = items.findIndex(([id]) => id === cursor);
      start = index >= 0 ? index + 1 : 0;
    }
    const page = items.slice(start, start + limit);
    return {
      points: page.map(([id, point]) => ({
        id,
        memoryId: point.payload.memoryId,
        chunkIndex: point.payload.chunkIndex,
      })),
      nextCursor: start + limit < items.length ? (page[page.length - 1]?.[0] ?? null) : null,
    };
  }

  async search(_params: VectorSearchParams): Promise<VectorSearchResult[]> {
    return [];
  }

  hasPoint(id: string): boolean {
    return this.points.has(id);
  }

  addPoint(memory: Memory, chunkIndex = 0): void {
    const id = qdrantPointId(memory.id, chunkIndex);
    this.points.set(id, {
      id,
      vector: [1, 0, 0, 0],
      payload: { userId: memory.userId, memoryId: memory.id, chunkIndex },
    });
  }
}

function makeMemory(userId: string, content: string): Memory {
  return Memory.create({ userId, type: 'semantic', content });
}

describe('reconcileVectors', () => {
  it('enqueues missing, stale, pending, and failed memories, skipping healthy indexes', async () => {
    const repo = new FakeMemoryRepo();
    const states = new FakeStateStore();
    const vectors = new FakeVectors();
    const queue = new FakeQueue();

    const healthy = makeMemory('u', 'healthy memory');
    const failed = makeMemory('u', 'failed memory');
    const pending = makeMemory('u', 'pending memory');
    const stale = makeMemory('u', 'stale memory');
    const missing = makeMemory('u', 'missing memory');
    for (const memory of [healthy, failed, pending, stale, missing]) await repo.save(memory);

    states.set(healthy, 'indexed');
    states.set(failed, 'failed');
    states.set(pending, 'pending');
    states.set(stale, 'indexed', 'old-content-hash');
    vectors.addPoint(healthy);

    const summary = await reconcileVectors({
      memoryRepository: repo,
      indexStateStore: states,
      vectorStore: vectors,
      jobQueue: queue,
      batchSize: 2,
      scanPageSize: 2,
    });

    expect(summary.memoriesScanned).toBe(5);
    expect(summary.enqueued).toBe(4);
    expect(summary.orphanPointsDeleted).toBe(0);
    expect(queue.jobs.map((job) => (job.data as { memoryId: string }).memoryId)).not.toContain(
      healthy.id,
    );
    expect(queue.jobs.map((job) => (job.data as { memoryId: string }).memoryId)).toEqual(
      expect.arrayContaining([failed.id, pending.id, stale.id, missing.id]),
    );
    expect(queue.jobs.every((job) => job.opts?.force === true)).toBe(true);
    expect(queue.jobs.every((job) => job.opts?.jobId?.includes('_'))).toBe(true);
  });

  it('re-enqueues an indexed memory whose Qdrant points are missing', async () => {
    const repo = new FakeMemoryRepo();
    const states = new FakeStateStore();
    const vectors = new FakeVectors();
    const queue = new FakeQueue();
    const memory = makeMemory('u', 'indexed but lost');
    await repo.save(memory);
    states.set(memory, 'indexed');

    const summary = await reconcileVectors({
      memoryRepository: repo,
      indexStateStore: states,
      vectorStore: vectors,
      jobQueue: queue,
    });

    expect(summary.enqueued).toBe(1);
    expect(queue.jobs).toHaveLength(1);
  });

  it('deletes points whose memory no longer exists', async () => {
    const repo = new FakeMemoryRepo();
    const states = new FakeStateStore();
    const vectors = new FakeVectors();
    const queue = new FakeQueue();
    const memory = makeMemory('u', 'kept');
    await repo.save(memory);
    states.set(memory, 'indexed');
    vectors.addPoint(memory);
    const orphan = Memory.reconstitute({
      ...makeMemory('u', 'orphan').toProps(),
      id: '00000000-0000-0000-0000-000000000000',
    });
    vectors.addPoint(orphan);

    const summary = await reconcileVectors({
      memoryRepository: repo,
      indexStateStore: states,
      vectorStore: vectors,
      jobQueue: queue,
    });

    expect(summary.orphanPointsDeleted).toBe(1);
    expect(vectors.hasPoint('00000000-0000-0000-0000-000000000000')).toBe(false);
    expect(vectors.hasPoint(qdrantPointId(memory.id, 0))).toBe(true);
  });

  it('does not delete points for a memory created after the scan started', async () => {
    const repo = new FakeMemoryRepo();
    const states = new FakeStateStore();
    const vectors = new FakeVectors();
    const queue = new FakeQueue();

    const scanned = makeMemory('u', 'scanned');
    const concurrent = makeMemory('u', 'concurrent');
    await repo.save(scanned);
    await repo.save(concurrent);
    states.set(scanned, 'indexed');
    vectors.addPoint(scanned);
    vectors.addPoint(concurrent);
    // Simulate the memory scan missing the concurrently-created memory.
    repo.findAllIds = new Set([scanned.id]);

    await reconcileVectors({
      memoryRepository: repo,
      indexStateStore: states,
      vectorStore: vectors,
      jobQueue: queue,
    });

    expect(vectors.hasPoint(qdrantPointId(concurrent.id, 0))).toBe(true);
  });

  it('uses the provider chunk limit when verifying indexed points', async () => {
    const repo = new FakeMemoryRepo();
    const states = new FakeStateStore();
    const vectors = new FakeVectors();
    const queue = new FakeQueue();
    const memory = makeMemory('u', 'a'.repeat(3000));
    await repo.save(memory);
    states.set(memory, 'indexed');
    // One point is enough under the default 900-token chunk size, but not
    // under the 400-token provider limit.
    vectors.addPoint(memory);

    const summary = await reconcileVectors({
      memoryRepository: repo,
      indexStateStore: states,
      vectorStore: vectors,
      jobQueue: queue,
      maxChunkTokens: 400,
    });

    expect(summary.enqueued).toBe(1);
  });

  it('caps enqueues at maxEnqueue', async () => {
    const repo = new FakeMemoryRepo();
    const states = new FakeStateStore();
    const vectors = new FakeVectors();
    const queue = new FakeQueue();
    for (let i = 0; i < 5; i += 1) await repo.save(makeMemory('u', `memory ${i}`));

    const summary = await reconcileVectors({
      memoryRepository: repo,
      indexStateStore: states,
      vectorStore: vectors,
      jobQueue: queue,
      maxEnqueue: 2,
    });

    expect(summary.enqueued).toBe(2);
    expect(queue.jobs).toHaveLength(2);
  });
});
