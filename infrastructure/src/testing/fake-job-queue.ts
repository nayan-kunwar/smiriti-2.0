import type { EnqueueOptions, JobQueue } from '@smriti/domain';

export class InMemoryJobQueue implements JobQueue {
  readonly jobs: Array<{ name: string; data: unknown; opts?: EnqueueOptions }> = [];

  async enqueue(name: string, data: unknown, opts?: EnqueueOptions): Promise<void> {
    const existing = opts?.jobId
      ? this.jobs.find((j) => j.name === name && j.opts?.jobId === opts.jobId)
      : undefined;
    if (existing) return;
    this.jobs.push({ name, data, opts });
  }
}
