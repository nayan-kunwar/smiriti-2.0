import type { AuditLogRepository, ListAuditLogsQuery, ListUsersQuery, UserRepository } from '@smriti/domain';
import { NotFoundError } from '@smriti/shared';
import { toUserDto, type UserDto } from '../mappers/user.mapper.js';

export interface ListUsersDeps {
  userRepository: UserRepository;
}

export interface ListAuditLogsDeps {
  auditLogRepository: AuditLogRepository;
}

export interface AuditLogDto {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  payloadSnapshot: Record<string, unknown>;
  correlationId: string;
  createdAt: string;
}

export async function listUsers(
  deps: ListUsersDeps,
  query: ListUsersQuery,
): Promise<{ items: UserDto[]; cursor: string | null }> {
  const result = await deps.userRepository.findAll(query);
  return {
    items: result.items.map(toUserDto),
    cursor: result.nextCursor,
  };
}

export async function listAuditLogs(
  deps: ListAuditLogsDeps,
  query: ListAuditLogsQuery,
): Promise<{ items: AuditLogDto[]; cursor: string | null }> {
  const result = await deps.auditLogRepository.findAll(query);
  return {
    items: result.items.map((entry) => ({
      id: entry.id,
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      payloadSnapshot: entry.payloadSnapshot,
      correlationId: entry.correlationId,
      createdAt: entry.createdAt.toISOString(),
    })),
    cursor: result.nextCursor,
  };
}

export async function validateApiKeyUser(
  deps: ListUsersDeps,
  userId: string,
): Promise<UserDto> {
  const user = await deps.userRepository.findById(userId);
  if (!user) {
    throw new NotFoundError('User', userId);
  }
  return toUserDto(user);
}
