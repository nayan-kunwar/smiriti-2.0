export const EMBED_AND_INDEX_JOB = 'embed-and-index';
export const DELETE_VECTORS_JOB = 'delete-vectors';

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
}

export interface JobQueue {
  enqueue(name: string, data: unknown, opts?: EnqueueOptions): Promise<void>;
}
