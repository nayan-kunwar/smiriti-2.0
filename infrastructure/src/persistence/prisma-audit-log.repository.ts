import type {
  AuditLogEntry,
  AuditLogRecord,
  AuditLogRepository,
  ListAuditLogsQuery,
} from '@smriti/domain';
import type { Prisma, PrismaClient } from '@prisma/client';

export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(entry: AuditLogEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        payloadSnapshot: entry.payloadSnapshot as Prisma.InputJsonValue,
        correlationId: entry.correlationId,
      },
    });
  }

  async findAll(
    query: ListAuditLogsQuery,
  ): Promise<{ items: AuditLogRecord[]; nextCursor: string | null }> {
    const where = query.userId ? { userId: query.userId } : {};
    const take = query.limit + 1;
    const records = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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
      items: page.map((record) => ({
        id: record.id,
        userId: record.userId,
        action: record.action,
        entityType: record.entityType,
        entityId: record.entityId,
        payloadSnapshot: record.payloadSnapshot as Record<string, unknown>,
        correlationId: record.correlationId,
        createdAt: record.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}
