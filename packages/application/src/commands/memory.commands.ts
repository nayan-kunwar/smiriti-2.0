import type { AuditLogRepository, JobQueue, MemoryRepository } from '@smriti/domain';
import { DELETE_VECTORS_JOB, EMBED_AND_INDEX_JOB } from '@smriti/domain';
import { NotFoundError } from '@smriti/shared';
import { toMemoryDto, type MemoryDto } from '../mappers/memory.mapper.js';

export interface GetMemoryDeps {
  memoryRepository: MemoryRepository;
}

export async function getMemory(
  deps: GetMemoryDeps,
  userId: string,
  id: string,
): Promise<MemoryDto> {
  const memory = await deps.memoryRepository.findById(userId, id);
  if (!memory) {
    throw new NotFoundError('Memory', id);
  }
  return toMemoryDto(memory);
}

export interface ListMemoriesDeps {
  memoryRepository: MemoryRepository;
}

export async function listMemories(
  deps: ListMemoriesDeps,
  userId: string,
  query: {
    cursor?: string;
    limit: number;
    category?: string;
    tags?: string[];
    includeArchived?: boolean;
    isPinned?: boolean;
  },
): Promise<{ items: MemoryDto[]; cursor: string | null }> {
  const result = await deps.memoryRepository.findByUser(userId, query);
  return {
    items: result.items.map((m) => toMemoryDto(m)),
    cursor: result.nextCursor,
  };
}

export interface UpdateMemoryDeps {
  memoryRepository: MemoryRepository;
  auditLogRepository: AuditLogRepository;
  jobQueue?: JobQueue;
}

export interface UpdateMemoryContext {
  userId: string;
  correlationId: string;
}

export async function updateMemory(
  deps: UpdateMemoryDeps,
  ctx: UpdateMemoryContext,
  id: string,
  input: {
    type?: 'long_term' | 'semantic';
    content?: string;
    category?: string | null;
    tags?: string[];
    importance?: number;
    confidence?: number;
    isPinned?: boolean;
    isArchived?: boolean;
    conversationId?: string | null;
  },
): Promise<MemoryDto> {
  const memory = await deps.memoryRepository.findById(ctx.userId, id);
  if (!memory) {
    throw new NotFoundError('Memory', id);
  }

  memory.update(input);
  await deps.memoryRepository.update(memory);

  await deps.auditLogRepository.append({
    userId: ctx.userId,
    action: 'memory.update',
    entityType: 'memory',
    entityId: memory.id,
    payloadSnapshot: {
      contentHash: memory.contentHash,
      updatedFields: Object.keys(input),
    },
    correlationId: ctx.correlationId,
  });

  const contentChanged = input.content !== undefined;
  if (contentChanged && deps.jobQueue) {
    await deps.jobQueue.enqueue(
      EMBED_AND_INDEX_JOB,
      {
        memoryId: memory.id,
        userId: ctx.userId,
        contentHash: memory.contentHash,
        correlationId: ctx.correlationId,
      },
      { jobId: `${memory.id}_${memory.contentHash}` },
    );
  }

  return toMemoryDto(memory, contentChanged && deps.jobQueue ? 'pending' : 'not_applicable');
}

export interface DeleteMemoryDeps {
  memoryRepository: MemoryRepository;
  auditLogRepository: AuditLogRepository;
  jobQueue?: JobQueue;
}

export interface DeleteMemoryContext {
  userId: string;
  correlationId: string;
}

export async function deleteMemory(
  deps: DeleteMemoryDeps,
  ctx: DeleteMemoryContext,
  id: string,
): Promise<void> {
  const memory = await deps.memoryRepository.findById(ctx.userId, id);
  if (!memory) {
    throw new NotFoundError('Memory', id);
  }

  const deleted = await deps.memoryRepository.delete(ctx.userId, id);
  if (!deleted) {
    throw new NotFoundError('Memory', id);
  }

  await deps.auditLogRepository.append({
    userId: ctx.userId,
    action: 'memory.delete',
    entityType: 'memory',
    entityId: id,
    payloadSnapshot: {
      contentHash: memory.contentHash,
      type: memory.type,
    },
    correlationId: ctx.correlationId,
  });

  if (deps.jobQueue) {
    await deps.jobQueue.enqueue(
      DELETE_VECTORS_JOB,
      { memoryId: id, userId: ctx.userId, correlationId: ctx.correlationId },
      { jobId: id },
    );
  }
}
