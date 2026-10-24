import { describe, expect, it } from 'vitest';
import { Memory } from '@smriti/domain';
import { ConflictError } from '@smriti/shared';
import type {
  AuditLogEntry,
  AuditLogRepository,
  JobQueue,
  MemoryIndexStateRecord,
  MemoryIndexStateStore,
  MemoryRepository,
} from '@smriti/domain';
import { createMemory } from './create-memory.command.js';
import { deleteMemory, getMemory, listMemories, updateMemory } from './memory.commands.js';

class InMemoryMemoryRepository implements MemoryRepository {
  private store = new Map<string, Memory>();

  async save(memory: Memory): Promise<void> {
    this.store.set(memory.id, Memory.reconstitute(memory.toProps()));
  }

  async findById(userId: string, id: string): Promise<Memory | null> {
    const memory = this.store.get(id);
    if (!memory || memory.userId !== userId) return null;
    return Memory.reconstitute(memory.toProps());
  }

  async findByUser(userId: string, query: Parameters<MemoryRepository['findByUser']>[1]) {
    let items = [...this.store.values()].filter((m) => m.userId === userId);

    if (!query.includeArchived) {
      items = items.filter((m) => !m.isArchived);
    }
    if (query.category) {
      items = items.filter((m) => m.category === query.category);
    }
    if (query.tags?.length) {
      items = items.filter((m) => query.tags!.every((t) => m.tags.includes(t)));
    }
    if (query.isPinned !== undefined) {
      items = items.filter((m) => m.isPinned === query.isPinned);
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    let startIndex = 0;
    if (query.cursor) {
      const cursorIndex = items.findIndex((m) => m.id === query.cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + query.limit);
    const nextCursor =
      startIndex + query.limit < items.length ? (page[page.length - 1]?.id ?? null) : null;

    return {
      items: page.map((m) => Memory.reconstitute(m.toProps())),
      nextCursor,
    };
  }

  async findAll(cursor: string | undefined, limit: number) {
    const items = [...this.store.values()].sort((a, b) => a.id.localeCompare(b.id));
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = items.findIndex((m) => m.id === cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }
    const page = items.slice(startIndex, startIndex + limit);
    return {
      items: page.map((m) => Memory.reconstitute(m.toProps())),
      nextCursor: startIndex + limit < items.length ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async existsByIds(ids: string[]): Promise<Set<string>> {
    return new Set(ids.filter((id) => this.store.has(id)));
  }

  async update(memory: Memory): Promise<void> {
    this.store.set(memory.id, Memory.reconstitute(memory.toProps()));
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const memory = this.store.get(id);
    if (!memory || memory.userId !== userId) return false;
    return this.store.delete(id);
  }
}

class InMemoryAuditLogRepository implements AuditLogRepository {
  entries: AuditLogEntry[] = [];

  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class InMemoryIndexStateStore implements MemoryIndexStateStore {
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
    if (!state || state.contentHash !== contentHash) return;
    this.states.set(memoryId, { ...state, status: 'indexed', error: null });
  }

  async markFailed(memoryId: string, contentHash: string, error: string): Promise<void> {
    const state = this.states.get(memoryId);
    if (!state || state.contentHash !== contentHash) return;
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

class FakeQueue implements JobQueue {
  readonly jobs: Array<{ name: string; data: unknown; opts?: { jobId?: string } }> = [];

  async enqueue(name: string, data: unknown, opts?: { jobId?: string }): Promise<void> {
    this.jobs.push({ name, data, opts });
  }

  async replay(name: string, data: unknown, jobId: string): Promise<void> {
    await this.enqueue(name, data, { jobId });
  }
}

describe('Memory use cases', () => {
  const userId = 'user-1';
  const correlationId = 'corr-1';

  it('creates, reads, updates, lists, and deletes a memory', async () => {
    const memoryRepository = new InMemoryMemoryRepository();
    const auditLogRepository = new InMemoryAuditLogRepository();

    const created = await createMemory(
      { memoryRepository, auditLogRepository },
      { userId, correlationId },
      { type: 'long_term', content: 'Favorite color is blue', tags: ['preferences'] },
    );

    expect(created.content).toBe('Favorite color is blue');
    expect(created.indexingStatus).toBe('not_applicable');
    expect(auditLogRepository.entries).toHaveLength(1);
    expect(auditLogRepository.entries[0].action).toBe('memory.create');

    const fetched = await getMemory({ memoryRepository }, userId, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.indexingStatus).toBe('not_applicable');

    const updated = await updateMemory(
      { memoryRepository, auditLogRepository },
      { userId, correlationId },
      created.id,
      { isPinned: true },
    );
    expect(updated.isPinned).toBe(true);

    const listed = await listMemories({ memoryRepository }, userId, { limit: 10 });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].indexingStatus).toBe('not_applicable');

    await deleteMemory(
      { memoryRepository, auditLogRepository },
      { userId, correlationId },
      created.id,
    );
    expect(auditLogRepository.entries.some((e) => e.action === 'memory.delete')).toBe(true);
  });

  it('reports durable pending, indexed, failed, and stale indexing states', async () => {
    const memoryRepository = new InMemoryMemoryRepository();
    const auditLogRepository = new InMemoryAuditLogRepository();
    const indexStateStore = new InMemoryIndexStateStore();
    const jobQueue = new FakeQueue();

    const created = await createMemory(
      { memoryRepository, auditLogRepository, indexStateStore, jobQueue },
      { userId, correlationId },
      { type: 'long_term', content: 'I live in Pune' },
    );
    expect(created.indexingStatus).toBe('pending');
    expect(indexStateStore.states.get(created.id)?.status).toBe('pending');

    const memory = await memoryRepository.findById(userId, created.id);
    expect(memory).not.toBeNull();

    expect(
      (await getMemory({ memoryRepository, indexStateStore }, userId, created.id)).indexingStatus,
    ).toBe('pending');
    expect(
      (await listMemories({ memoryRepository, indexStateStore }, userId, { limit: 10 })).items[0]
        .indexingStatus,
    ).toBe('pending');

    await indexStateStore.markIndexed(created.id, memory!.contentHash);
    const indexed = await getMemory({ memoryRepository, indexStateStore }, userId, created.id);
    expect(indexed.indexingStatus).toBe('indexed');
    expect(
      (await listMemories({ memoryRepository, indexStateStore }, userId, { limit: 10 })).items[0]
        .indexingStatus,
    ).toBe('indexed');

    indexStateStore.states.set(created.id, {
      memoryId: created.id,
      contentHash: 'previous-content-hash',
      status: 'indexed',
      error: null,
      updatedAt: new Date(),
    });
    const stale = await getMemory({ memoryRepository, indexStateStore }, userId, created.id);
    expect(stale.indexingStatus).toBe('pending');

    await indexStateStore.markPending(created.id, memory!.contentHash);
    await indexStateStore.markFailed(created.id, memory!.contentHash, 'embedding provider down');
    const failed = await getMemory({ memoryRepository, indexStateStore }, userId, created.id);
    expect(failed.indexingStatus).toBe('failed');
  });

  it('resets indexing state to pending when content changes', async () => {
    const memoryRepository = new InMemoryMemoryRepository();
    const auditLogRepository = new InMemoryAuditLogRepository();
    const indexStateStore = new InMemoryIndexStateStore();
    const jobQueue = new FakeQueue();

    const created = await createMemory(
      { memoryRepository, auditLogRepository, indexStateStore, jobQueue },
      { userId, correlationId },
      { type: 'semantic', content: 'Original content' },
    );
    const original = await memoryRepository.findById(userId, created.id);
    await indexStateStore.markIndexed(created.id, original!.contentHash);

    const updated = await updateMemory(
      { memoryRepository, auditLogRepository, indexStateStore, jobQueue },
      { userId, correlationId },
      created.id,
      { content: 'Updated content' },
    );

    expect(updated.indexingStatus).toBe('pending');
    const state = indexStateStore.states.get(created.id);
    expect(state?.status).toBe('pending');
    expect(state?.contentHash).not.toBe(original!.contentHash);
    expect(jobQueue.jobs).toHaveLength(2);
  });

  it('rejects duplicate content unless force is set', async () => {
    const memoryRepository = new InMemoryMemoryRepository();
    const auditLogRepository = new InMemoryAuditLogRepository();
    const duplicateDetector = async () => ({
      memoryId: 'existing-memory',
      similarity: 0.97,
    });

    await expect(
      createMemory(
        { memoryRepository, auditLogRepository, duplicateDetector },
        { userId, correlationId },
        { type: 'long_term', content: 'I live in NYC' },
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const forced = await createMemory(
      { memoryRepository, auditLogRepository, duplicateDetector },
      { userId, correlationId, force: true },
      { type: 'long_term', content: 'I live in NYC' },
    );
    expect(forced.content).toBe('I live in NYC');
    const listed = await listMemories({ memoryRepository }, userId, { limit: 10 });
    expect(listed.items).toHaveLength(1);
  });
});
