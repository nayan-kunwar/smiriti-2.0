import type {
  JobFailureEntry,
  JobFailureRecord,
  JobFailureRepository,
  ListJobFailuresQuery,
} from '@smriti/domain';
import type { JobFailure as PrismaJobFailure, Prisma, PrismaClient } from '@prisma/client';

function toRecord(record: PrismaJobFailure): JobFailureRecord {
  return {
    id: record.id,
    jobId: record.jobId,
    jobName: record.jobName,
    queue: record.queue,
    payload: record.payload as Record<string, unknown>,
    attempts: record.attempts,
    error: record.error,
    correlationId: record.correlationId,
    status: record.status,
    retriedAt: record.retriedAt,
    retriedBy: record.retriedBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class PrismaJobFailureRepository implements JobFailureRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: JobFailureEntry): Promise<JobFailureRecord> {
    const record = await this.prisma.jobFailure.create({
      data: {
        jobId: entry.jobId,
        jobName: entry.jobName,
        queue: entry.queue,
        payload: entry.payload as Prisma.InputJsonValue,
        attempts: entry.attempts,
        error: entry.error,
        correlationId: entry.correlationId,
      },
    });
    return toRecord(record);
  }

  async findAll(
    query: ListJobFailuresQuery,
  ): Promise<{ items: JobFailureRecord[]; nextCursor: string | null }> {
    const where: Prisma.JobFailureWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.jobName) where.jobName = query.jobName;

    const take = query.limit + 1;
    const records = await this.prisma.jobFailure.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
    });

    const hasMore = records.length > query.limit;
    const page = hasMore ? records.slice(0, query.limit) : records;

    return {
      items: page.map(toRecord),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async findById(id: string): Promise<JobFailureRecord | null> {
    const record = await this.prisma.jobFailure.findUnique({ where: { id } });
    return record ? toRecord(record) : null;
  }

  async markRetried(
    id: string,
    retriedBy: string,
    retriedAt: Date,
  ): Promise<JobFailureRecord | null> {
    const updated = await this.prisma.jobFailure.updateMany({
      where: { id, status: 'open' },
      data: { status: 'retried', retriedBy, retriedAt },
    });
    if (updated.count === 0) return null;
    const record = await this.prisma.jobFailure.findUnique({ where: { id } });
    return record ? toRecord(record) : null;
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.prisma.jobFailure.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
