import { describe, expect, it } from 'vitest';
import { InMemoryAuditLogRepository, InMemoryMemoryRepository } from '../testing/in-memory-repositories.js';
import { Memory } from '@smriti/domain';

describe('InMemoryMemoryRepository', () => {
  it('saves and retrieves memories scoped by user', async () => {
    const repo = new InMemoryMemoryRepository();
    const memory = Memory.create({
      userId: 'user-1',
      type: 'long_term',
      content: 'Test memory',
    });

    await repo.save(memory);

    const found = await repo.findById('user-1', memory.id);
    expect(found?.content).toBe('Test memory');

    const notFound = await repo.findById('user-2', memory.id);
    expect(notFound).toBeNull();
  });

  it('filters archived memories by default', async () => {
    const repo = new InMemoryMemoryRepository();
    const active = Memory.create({ userId: 'user-1', type: 'long_term', content: 'Active' });
    const archived = Memory.create({ userId: 'user-1', type: 'long_term', content: 'Archived' });
    archived.update({ isArchived: true });

    await repo.save(active);
    await repo.save(archived);

    const result = await repo.findByUser('user-1', { limit: 10 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].content).toBe('Active');
  });
});

describe('InMemoryAuditLogRepository', () => {
  it('appends audit entries', async () => {
    const repo = new InMemoryAuditLogRepository();
    await repo.append({
      userId: 'user-1',
      action: 'memory.create',
      entityType: 'memory',
      entityId: 'mem-1',
      payloadSnapshot: { contentHash: 'abc' },
      correlationId: 'corr-1',
    });

    expect(repo.entries).toHaveLength(1);
    expect(repo.entries[0].action).toBe('memory.create');
  });
});
