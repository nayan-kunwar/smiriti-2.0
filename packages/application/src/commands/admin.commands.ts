import type {
  AuditLogRepository,
  JobFailureRecord,
  JobFailureRepository,
  JobQueue,
  ListAuditLogsQuery,
  ListJobFailuresQuery,
  ListUsersQuery,
  UserRepository,
} from '@smriti/domain';
import { isReplayableJobName } from '@smriti/domain';
import { ConflictError, NotFoundError } from '@smriti/shared';
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

export async function validateApiKeyUser(deps: ListUsersDeps, userId: string): Promise<UserDto> {
  const user = await deps.userRepository.findById(userId);
  if (!user) {
    throw new NotFoundError('User', userId);
  }
  return toUserDto(user);
}

export interface JobFailureDto {
  id: string;
  jobId: string;
  jobName: string;
  queue: string;
  payload: Record<string, unknown>;
  attempts: number;
  error: string;
  correlationId: string;
  status: 'open' | 'retried';
  retriedAt: string | null;
  retriedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListJobFailuresDeps {
  jobFailureRepository: JobFailureRepository;
}

export interface RetryJobFailureDeps extends ListJobFailuresDeps {
  auditLogRepository: AuditLogRepository;
  jobQueue: JobQueue;
}

export interface RetryJobFailureContext {
  failureId: string;
  userId: string;
  correlationId: string;
}

function toJobFailureDto(record: JobFailureRecord): JobFailureDto {
  return {
    id: record.id,
    jobId: record.jobId,
    jobName: record.jobName,
    queue: record.queue,
    payload: record.payload,
    attempts: record.attempts,
    error: record.error,
    correlationId: record.correlationId,
    status: record.status,
    retriedAt: record.retriedAt?.toISOString() ?? null,
    retriedBy: record.retriedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function listJobFailures(
  deps: ListJobFailuresDeps,
  query: ListJobFailuresQuery,
): Promise<{ items: JobFailureDto[]; cursor: string | null }> {
  const result = await deps.jobFailureRepository.findAll(query);
  return {
    items: result.items.map(toJobFailureDto),
    cursor: result.nextCursor,
  };
}

/**
 * Replays one durable terminal failure. The failure is marked retried only
 * after the queue accepts the job, so a Redis failure leaves it open for a
 * later attempt. Audit is written before the status transition; if the audit
 * sink fails, the record remains open and the replay is safe to repeat because
 * the adapter reuses the original BullMQ job ID.
 */
export async function retryJobFailure(
  deps: RetryJobFailureDeps,
  context: RetryJobFailureContext,
): Promise<JobFailureDto> {
  const failure = await deps.jobFailureRepository.findById(context.failureId);
  if (!failure) {
    throw new NotFoundError('JobFailure', context.failureId);
  }
  if (failure.status !== 'open') {
    throw new ConflictError('Job failure has already been retried', {
      reason: 'JOB_FAILURE_ALREADY_RETRIED',
    });
  }
  if (!isReplayableJobName(failure.jobName)) {
    throw new ConflictError(`Job failure cannot be replayed: ${failure.jobName}`, {
      reason: 'JOB_FAILURE_NOT_REPLAYABLE',
    });
  }

  await deps.jobQueue.replay(failure.jobName, failure.payload, failure.jobId);

  await deps.auditLogRepository.append({
    userId: context.userId,
    action: 'job.retry',
    entityType: 'job_failure',
    entityId: failure.id,
    payloadSnapshot: {
      jobId: failure.jobId,
      jobName: failure.jobName,
      queue: failure.queue,
      attempts: failure.attempts,
      failureCorrelationId: failure.correlationId,
    },
    correlationId: context.correlationId,
  });

  const retriedAt = new Date();
  const updated = await deps.jobFailureRepository.markRetried(
    failure.id,
    context.userId,
    retriedAt,
  );
  if (!updated) {
    // A concurrent admin retried between the read and the status transition.
    throw new ConflictError('Job failure has already been retried', {
      reason: 'JOB_FAILURE_ALREADY_RETRIED',
    });
  }

  return toJobFailureDto(updated);
}
