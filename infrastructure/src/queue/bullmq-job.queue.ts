import { Queue } from 'bullmq';
import type { EnqueueOptions, JobQueue } from '@smriti/domain';

export const SMRITI_QUEUE_NAME = 'smriti-jobs';

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

  constructor(redisUrl: string, queueName = SMRITI_QUEUE_NAME) {
    this.queue = new Queue(queueName, { connection: redisConnectionFromUrl(redisUrl) });
  }

  async enqueue(name: string, data: unknown, opts?: EnqueueOptions): Promise<void> {
    await this.queue.add(name, data as Record<string, unknown>, {
      ...(opts?.jobId ? { jobId: opts.jobId } : {}),
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
