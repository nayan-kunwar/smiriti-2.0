import { Queue } from 'bullmq';
import type { EnqueueOptions, JobQueue } from '@smriti/domain';

export const SMRITI_QUEUE_NAME = 'smriti-jobs';

export const DEFAULT_JOB_ATTEMPTS = 3;
export const DEFAULT_JOB_BACKOFF_DELAY_MS = 1_000;
export const DEFAULT_JOB_REMOVE_ON_COMPLETE = 100;
export const DEFAULT_JOB_REMOVE_ON_FAIL = 500;

export interface BullMqJobQueueOptions {
  queueName?: string;
  attempts?: number;
  backoffDelayMs?: number;
  removeOnComplete?: number;
  removeOnFail?: number;
}

export function redisConnectionFromUrl(redisUrl: string): {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
} {
  const parsed = new URL(redisUrl);
  const db = parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : NaN;
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(Number.isFinite(db) ? { db } : {}),
    maxRetriesPerRequest: null,
  };
}

export class BullMqJobQueue implements JobQueue {
  private readonly queue: Queue;
  private readonly attempts: number;
  private readonly backoffDelayMs: number;
  private readonly removeOnComplete: number;
  private readonly removeOnFail: number;

  constructor(redisUrl: string, options: BullMqJobQueueOptions | string = {}) {
    // Keep the old `new BullMqJobQueue(url, queueName)` form working.
    const normalized = typeof options === 'string' ? { queueName: options } : options;
    this.attempts = normalized.attempts ?? DEFAULT_JOB_ATTEMPTS;
    this.backoffDelayMs = normalized.backoffDelayMs ?? DEFAULT_JOB_BACKOFF_DELAY_MS;
    this.removeOnComplete = normalized.removeOnComplete ?? DEFAULT_JOB_REMOVE_ON_COMPLETE;
    this.removeOnFail = normalized.removeOnFail ?? DEFAULT_JOB_REMOVE_ON_FAIL;
    this.queue = new Queue(normalized.queueName ?? SMRITI_QUEUE_NAME, {
      connection: redisConnectionFromUrl(redisUrl),
    });
  }

  async enqueue(name: string, data: unknown, opts?: EnqueueOptions): Promise<void> {
    if (opts?.jobId && opts.force) {
      const existing = await this.queue.getJob(opts.jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'failed' || state === 'completed') {
          try {
            await existing.remove();
          } catch {
            // If the job is locked by a worker, leave it for the next run.
          }
        }
      }
    }
    await this.queue.add(name, data as Record<string, unknown>, {
      ...(opts?.jobId ? { jobId: opts.jobId } : {}),
      attempts: this.attempts,
      backoff: { type: 'exponential', delay: this.backoffDelayMs },
      removeOnComplete: this.removeOnComplete,
      removeOnFail: this.removeOnFail,
    });
  }

  async replay(name: string, data: unknown, jobId: string): Promise<void> {
    await this.enqueue(name, data, { jobId, force: true });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
