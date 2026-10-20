import { EMBED_AND_INDEX_JOB, Memory } from '@smriti/domain';
import type {
  AuditLogRepository,
  JobQueue,
  MemoryIndexStateStore,
  MemoryRepository,
} from '@smriti/domain';
import { ConflictError, type CreateMemoryInput } from '@smriti/shared';
import { toMemoryDto, type MemoryDto } from '../mappers/memory.mapper.js';

export interface DuplicateMemoryMatch {
  memoryId: string;
  similarity: number;
}

export interface CreateMemoryDeps {
  memoryRepository: MemoryRepository;
  auditLogRepository: AuditLogRepository;
  jobQueue?: JobQueue;
  indexStateStore?: MemoryIndexStateStore;
  duplicateDetector?: (userId: string, content: string) => Promise<DuplicateMemoryMatch | null>;
}

export interface CreateMemoryContext {
  userId: string;
  correlationId: string;
  /** Bypass the duplicate check (REST `?force=true`). */
  force?: boolean;
}

export async function createMemory(
  deps: CreateMemoryDeps,
  ctx: CreateMemoryContext,
  input: CreateMemoryInput,
): Promise<MemoryDto> {
  if (deps.duplicateDetector && !ctx.force) {
    const duplicate = await deps.duplicateDetector(ctx.userId, input.content);
    if (duplicate) {
      throw new ConflictError('A similar memory already exists', {
        existingMemoryId: duplicate.memoryId,
        similarity: duplicate.similarity,
      });
    }
  }

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
    // Claim the state before enqueueing so a fast worker cannot write
    // "indexed" and then be overwritten by a late "pending".
    await deps.indexStateStore?.markPending(memory.id, memory.contentHash);
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
