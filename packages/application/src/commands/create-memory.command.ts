import { EMBED_AND_INDEX_JOB, Memory } from '@smriti/domain';
import type { AuditLogRepository, JobQueue, MemoryRepository } from '@smriti/domain';
import type { CreateMemoryInput } from '@smriti/shared';
import { toMemoryDto, type MemoryDto } from '../mappers/memory.mapper.js';

export interface CreateMemoryDeps {
  memoryRepository: MemoryRepository;
  auditLogRepository: AuditLogRepository;
  jobQueue?: JobQueue;
}

export interface CreateMemoryContext {
  userId: string;
  correlationId: string;
}

export async function createMemory(
  deps: CreateMemoryDeps,
  ctx: CreateMemoryContext,
  input: CreateMemoryInput,
): Promise<MemoryDto> {
  const memory = Memory.create({
    userId: ctx.userId,
    type: input.type,
    content: input.content,
    category: input.category,
    tags: input.tags,
    importance: input.importance,
    confidence: input.confidence,
    conversationId: input.conversationId,
  });

  await deps.memoryRepository.save(memory);

  await deps.auditLogRepository.append({
    userId: ctx.userId,
    action: 'memory.create',
    entityType: 'memory',
    entityId: memory.id,
    payloadSnapshot: {
      type: memory.type,
      contentHash: memory.contentHash,
      category: memory.category,
      tags: memory.tags,
    },
    correlationId: ctx.correlationId,
  });

  if (deps.jobQueue) {
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

  return toMemoryDto(memory, deps.jobQueue ? 'pending' : 'not_applicable');
}
