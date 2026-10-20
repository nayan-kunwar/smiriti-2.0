import type { EnqueueOptions, JobQueue } from '@smriti/domain';

export class InMemoryJobQueue implements JobQueue {
  readonly jobs: Array<{ name: string; data: unknown; opts?: EnqueueOptions }> = [];

  async enqueue(name: string, data: unknown, opts?: EnqueueOptions): Promise<void> {
    const index = opts?.jobId
      ? this.jobs.findIndex((j) => j.name === name && j.opts?.jobId === opts.jobId)
      : -1;
    if (index >= 0) {
      if (!opts?.force) return;
      this.jobs.splice(index, 1);
    }
    this.jobs.push({ name, data, opts });
  }
}
