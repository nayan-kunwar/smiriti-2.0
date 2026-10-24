export const EMBED_AND_INDEX_JOB = 'embed-and-index';
export const DELETE_VECTORS_JOB = 'delete-vectors';
export const RECONCILE_VECTORS_JOB = 'reconcile-vectors';
export const CLEANUP_IDEMPOTENCY_KEYS_JOB = 'cleanup-idempotency-keys';
export const CLEANUP_JOB_FAILURES_JOB = 'cleanup-job-failures';

/**
 * Jobs that are safe to replay from a durable failure record. Scheduler-only
 * jobs are intentionally excluded: they run again on their own schedule and
 * do not represent user-facing work.
 */
export const REPLAYABLE_JOB_NAMES = [EMBED_AND_INDEX_JOB, DELETE_VECTORS_JOB] as const;

export function isReplayableJobName(name: string): boolean {
  return (REPLAYABLE_JOB_NAMES as readonly string[]).includes(name);
}

export interface EmbedAndIndexPayload {
  memoryId: string;
  userId: string;
  contentHash: string;
  correlationId: string;
}

export interface DeleteVectorsPayload {
  memoryId: string;
  userId: string;
  correlationId: string;
}

export interface EnqueueOptions {
  jobId?: string;
  /**
   * Replace a terminal job with the same ID. Requeuing a failed job with a
   * duplicate ID is otherwise a no-op in BullMQ.
   */
  force?: boolean;
}

export interface JobQueue {
  enqueue(name: string, data: unknown, opts?: EnqueueOptions): Promise<void>;
  /**
   * Replay a terminal job with its original ID. The adapter removes a failed
   * or completed job with the same ID first, then enqueues the payload with
   * the queue's configured attempts/backoff/retention settings.
   */
  replay(name: string, data: unknown, jobId: string): Promise<void>;
}
