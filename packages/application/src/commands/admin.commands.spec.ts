import { describe, expect, it } from 'vitest';
import type {
  AuditLogEntry,
  AuditLogRepository,
  JobFailureEntry,
  JobFailureRecord,
  JobFailureRepository,
  JobQueue,
  ListJobFailuresQuery,
} from '@smriti/domain';
import { ConflictError, NotFoundError } from '@smriti/shared';
import { listJobFailures, retryJobFailure } from './admin.commands.js';

class FakeJobFailureRepository implements JobFailureRepository {
  private readonly records = new Map<string, JobFailureRecord>();
  private sequence = 0;

  seed(record: JobFailureRecord): void {
    this.records.set(record.id, record);
  }

  async record(entry: JobFailureEntry): Promise<JobFailureRecord> {
    this.sequence += 1;
    const now = new Date();
    const record: JobFailureRecord = {
      ...entry,
      id: `failure-${this.sequence}`,
      status: 'open',
      retriedAt: null,
      retriedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return record;
  }

  async findAll(
    query: ListJobFailuresQuery,
  ): Promise<{ items: JobFailureRecord[]; nextCursor: string | null }> {
    let items = [...this.records.values()];
    if (query.status) items = items.filter((entry) => entry.status === query.status);
    if (query.jobName) items = items.filter((entry) => entry.jobName === query.jobName);
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));

    let start = 0;
    if (query.cursor) {
      const index = items.findIndex((entry) => entry.id === query.cursor);
      start = index >= 0 ? index + 1 : 0;
    }
    const page = items.slice(start, start + query.limit);
    return {
      items: page,
      nextCursor: start + query.limit < items.length ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async findById(id: string): Promise<JobFailureRecord | null> {
    return this.records.get(id) ?? null;
  }

  async markRetried(
    id: string,
    retriedBy: string,
    retriedAt: Date,
  ): Promise<JobFailureRecord | null> {
    const record = this.records.get(id);
    if (!record || record.status !== 'open') return null;
    const updated: JobFailureRecord = {
      ...record,
      status: 'retried',
      retriedBy,
      retriedAt,
      updatedAt: retriedAt,
    };
    this.records.set(id, updated);
    return updated;
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    let deleted = 0;
    for (const [id, record] of this.records) {
      if (record.createdAt < cutoff) {
        this.records.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

class FakeAuditLogRepository implements AuditLogRepository {
  readonly entries: AuditLogEntry[] = [];
  failNext = false;

  async append(entry: AuditLogEntry): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('audit unavailable');
    }
    this.entries.push(entry);
  }

  async findAll(): Promise<{ items: []; nextCursor: null }> {
    return { items: [], nextCursor: null };
  }
}

class FakeQueue implements JobQueue {
  readonly jobs: Array<{ name: string; data: unknown; jobId: string }> = [];

  async enqueue(): Promise<void> {}

  async replay(name: string, data: unknown, jobId: string): Promise<void> {
    this.jobs.push({ name, data, jobId });
  }
}

function failure(overrides: Partial<JobFailureRecord> = {}): JobFailureRecord {
  return {
    id: '0f4f3a2e-1c3b-4a5d-8e9f-1234567890ab',
    jobId: 'memory-1_hash-1',
    jobName: 'embed-and-index',
    queue: 'smriti-jobs',
    payload: {
      memoryId: 'memory-1',
      userId: 'user-1',
      contentHash: 'hash-1',
      correlationId: 'original-corr',
    },
    attempts: 3,
    error: 'embedding provider unavailable',
    correlationId: 'original-corr',
    status: 'open',
    retriedAt: null,
    retriedBy: null,
    createdAt: new Date('2026-10-24T10:00:00.000Z'),
    updatedAt: new Date('2026-10-24T10:00:00.000Z'),
    ...overrides,
  };
}

describe('admin job failure use cases', () => {
  it('lists durable failures with filters and maps timestamps', async () => {
    const repository = new FakeJobFailureRepository();
    repository.seed(failure());
    repository.seed(
      failure({
        id: '1f4f3a2e-1c3b-4a5d-8e9f-1234567890ab',
        jobName: 'delete-vectors',
        status: 'retried',
        retriedAt: new Date('2026-10-24T11:00:00.000Z'),
        retriedBy: 'admin-1',
      }),
    );

    const open = await listJobFailures(
      { jobFailureRepository: repository },
      { limit: 10, status: 'open' },
    );
    expect(open.items).toHaveLength(1);
    expect(open.items[0].jobName).toBe('embed-and-index');
    expect(open.items[0].createdAt).toBe('2026-10-24T10:00:00.000Z');

    const retried = await listJobFailures(
      { jobFailureRepository: repository },
      { limit: 10, jobName: 'delete-vectors' },
    );
    expect(retried.items).toHaveLength(1);
    expect(retried.items[0].status).toBe('retried');
    expect(retried.items[0].retriedBy).toBe('admin-1');
  });

  it('replays the original job, audits the retry, and marks the failure retried', async () => {
    const repository = new FakeJobFailureRepository();
    const record = failure();
    repository.seed(record);
    const audit = new FakeAuditLogRepository();
    const queue = new FakeQueue();

    const result = await retryJobFailure(
      { jobFailureRepository: repository, auditLogRepository: audit, jobQueue: queue },
      { failureId: record.id, userId: 'admin-1', correlationId: 'retry-corr' },
    );

    expect(queue.jobs).toEqual([
      {
        name: 'embed-and-index',
        jobId: 'memory-1_hash-1',
        data: record.payload,
      },
    ]);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      userId: 'admin-1',
      action: 'job.retry',
      entityType: 'job_failure',
      entityId: record.id,
      correlationId: 'retry-corr',
      payloadSnapshot: {
        jobId: 'memory-1_hash-1',
        jobName: 'embed-and-index',
        queue: 'smriti-jobs',
        attempts: 3,
        failureCorrelationId: 'original-corr',
      },
    });
    expect(result.status).toBe('retried');
    expect(result.retriedBy).toBe('admin-1');
    expect(result.retriedAt).not.toBeNull();
    expect((await repository.findById(record.id))?.status).toBe('retried');
  });

  it('rejects missing and already retried failures', async () => {
    const repository = new FakeJobFailureRepository();
    const audit = new FakeAuditLogRepository();
    const queue = new FakeQueue();

    await expect(
      retryJobFailure(
        { jobFailureRepository: repository, auditLogRepository: audit, jobQueue: queue },
        { failureId: 'missing', userId: 'admin-1', correlationId: 'retry-corr' },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    const record = failure({ status: 'retried', retriedBy: 'admin-1' });
    repository.seed(record);
    await expect(
      retryJobFailure(
        { jobFailureRepository: repository, auditLogRepository: audit, jobQueue: queue },
        { failureId: record.id, userId: 'admin-2', correlationId: 'retry-corr' },
      ),
    ).rejects.toMatchObject({
      name: 'ConflictError',
      details: { reason: 'JOB_FAILURE_ALREADY_RETRIED' },
    } satisfies Partial<ConflictError>);
    expect(queue.jobs).toHaveLength(0);
  });

  it('rejects scheduler-only jobs', async () => {
    const repository = new FakeJobFailureRepository();
    const record = failure({ jobName: 'reconcile-vectors' });
    repository.seed(record);

    await expect(
      retryJobFailure(
        {
          jobFailureRepository: repository,
          auditLogRepository: new FakeAuditLogRepository(),
          jobQueue: new FakeQueue(),
        },
        { failureId: record.id, userId: 'admin-1', correlationId: 'retry-corr' },
      ),
    ).rejects.toMatchObject({
      details: { reason: 'JOB_FAILURE_NOT_REPLAYABLE' },
    });
  });

  it('leaves the failure open when the audit write fails', async () => {
    const repository = new FakeJobFailureRepository();
    const record = failure();
    repository.seed(record);
    const audit = new FakeAuditLogRepository();
    audit.failNext = true;

    await expect(
      retryJobFailure(
        {
          jobFailureRepository: repository,
          auditLogRepository: audit,
          jobQueue: new FakeQueue(),
        },
        { failureId: record.id, userId: 'admin-1', correlationId: 'retry-corr' },
      ),
    ).rejects.toThrow('audit unavailable');

    expect((await repository.findById(record.id))?.status).toBe('open');
  });
});
