export type JobFailureStatus = 'open' | 'retried';

export interface JobFailureEntry {
  jobId: string;
  jobName: string;
  queue: string;
  payload: Record<string, unknown>;
  attempts: number;
  error: string;
  correlationId: string;
}

export interface JobFailureRecord extends JobFailureEntry {
  id: string;
  status: JobFailureStatus;
  retriedAt: Date | null;
  retriedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListJobFailuresQuery {
  cursor?: string;
  limit: number;
  status?: JobFailureStatus;
  jobName?: string;
}

export interface JobFailureRepository {
  record(entry: JobFailureEntry): Promise<JobFailureRecord>;
  findAll(
    query: ListJobFailuresQuery,
  ): Promise<{ items: JobFailureRecord[]; nextCursor: string | null }>;
  findById(id: string): Promise<JobFailureRecord | null>;
  /** Atomically marks an open failure as retried. Returns null when it is missing or already retried. */
  markRetried(id: string, retriedBy: string, retriedAt: Date): Promise<JobFailureRecord | null>;
  deleteOlderThan(cutoff: Date): Promise<number>;
}
