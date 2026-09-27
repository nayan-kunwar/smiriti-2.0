import { describe, expect, it } from 'vitest';
import { Memory } from '@smriti/domain';
import type { AuditLogEntry, AuditLogRepository, MemoryRepository } from '@smriti/domain';
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
      startIndex + query.limit < items.length ? page[page.length - 1]?.id ?? null : null;

    return {
      items: page.map((m) => Memory.reconstitute(m.toProps())),
      nextCursor,
    };
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
    expect(auditLogRepository.entries).toHaveLength(1);
    expect(auditLogRepository.entries[0].action).toBe('memory.create');

    const fetched = await getMemory({ memoryRepository }, userId, created.id);
    expect(fetched.id).toBe(created.id);

    const updated = await updateMemory(
      { memoryRepository, auditLogRepository },
      { userId, correlationId },
      created.id,
      { isPinned: true },
    );
    expect(updated.isPinned).toBe(true);

    const listed = await listMemories({ memoryRepository }, userId, { limit: 10 });
    expect(listed.items).toHaveLength(1);

    await deleteMemory(
      { memoryRepository, auditLogRepository },
      { userId, correlationId },
      created.id,
    );
    expect(auditLogRepository.entries.some((e) => e.action === 'memory.delete')).toBe(true);
  });
});
