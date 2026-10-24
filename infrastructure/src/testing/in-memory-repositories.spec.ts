import { describe, expect, it } from 'vitest';
import {
  InMemoryAuditLogRepository,
  InMemoryJobFailureRepository,
  InMemoryMemoryRepository,
} from '../testing/in-memory-repositories.js';
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

describe('InMemoryJobFailureRepository', () => {
  it('records, filters, retries, and prunes durable failures', async () => {
    const repo = new InMemoryJobFailureRepository();
    const open = await repo.record({
      jobId: 'memory-1_hash-1',
      jobName: 'embed-and-index',
      queue: 'smriti-jobs',
      payload: { memoryId: 'memory-1' },
      attempts: 3,
      error: 'provider unavailable',
      correlationId: 'corr-1',
    });

    expect((await repo.findAll({ limit: 10, status: 'open' })).items).toHaveLength(1);

    const retried = await repo.markRetried(open.id, 'admin-1', new Date());
    expect(retried).toMatchObject({ status: 'retried', retriedBy: 'admin-1' });
    expect(await repo.markRetried(open.id, 'admin-1', new Date())).toBeNull();
    expect((await repo.findAll({ limit: 10, jobName: 'embed-and-index' })).items).toHaveLength(1);

    expect(await repo.deleteOlderThan(new Date(Date.now() + 1_000))).toBe(1);
    expect(await repo.findById(open.id)).toBeNull();
  });
});
