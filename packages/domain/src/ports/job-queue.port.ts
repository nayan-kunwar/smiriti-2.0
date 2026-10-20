export const EMBED_AND_INDEX_JOB = 'embed-and-index';
export const DELETE_VECTORS_JOB = 'delete-vectors';
export const RECONCILE_VECTORS_JOB = 'reconcile-vectors';
export const CLEANUP_IDEMPOTENCY_KEYS_JOB = 'cleanup-idempotency-keys';

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
}
