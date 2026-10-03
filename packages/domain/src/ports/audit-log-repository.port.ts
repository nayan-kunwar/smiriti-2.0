export interface AuditLogEntry {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  payloadSnapshot: Record<string, unknown>;
  correlationId: string;
}

export interface AuditLogRecord extends AuditLogEntry {
  id: string;
  createdAt: Date;
}

export interface ListAuditLogsQuery {
  cursor?: string;
  limit: number;
  userId?: string;
}

export interface AuditLogRepository {
  append(entry: AuditLogEntry): Promise<void>;
  findAll(
    query: ListAuditLogsQuery,
  ): Promise<{ items: AuditLogRecord[]; nextCursor: string | null }>;
}
