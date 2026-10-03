import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import {
  createMemory,
  deleteMemory,
  getMemory,
  listMemories,
  searchMemories,
  updateMemory,
  type MemoryDto,
  type ScoredMemoryDto,
} from '@smriti/application';
import type { EmbeddingProvider, JobQueue, VectorStore } from '@smriti/domain';
import { PrismaAuditLogRepository, PrismaMemoryRepository } from '@smriti/infrastructure';
import type {
  CreateMemoryInput,
  ListMemoriesQueryInput,
  SearchMemoriesInput,
  UpdateMemoryInput,
} from '@smriti/shared';
import { PRISMA_CLIENT } from '../prisma/prisma.module.js';
import { EMBEDDING_PROVIDER, JOB_QUEUE, VECTOR_STORE } from './memory.tokens.js';

@Injectable()
export class MemoryService implements OnModuleInit, OnModuleDestroy {
  private readonly memoryRepository: PrismaMemoryRepository;
  private readonly auditLogRepository: PrismaAuditLogRepository;

  constructor(
    @Inject(PRISMA_CLIENT) prisma: PrismaClient,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueue,
  ) {
    this.memoryRepository = new PrismaMemoryRepository(prisma);
    this.auditLogRepository = new PrismaAuditLogRepository(prisma);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.vectorStore.ensureCollection();
    } catch (err) {
      // Don't crash API if Qdrant is briefly unavailable; search/indexing will retry.
      // eslint-disable-next-line no-console
      console.warn('Qdrant ensureCollection failed on boot:', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (isClosable(this.jobQueue)) {
      await this.jobQueue.close();
    }
  }

  create(userId: string, correlationId: string, input: CreateMemoryInput): Promise<MemoryDto> {
    return createMemory(
      {
        memoryRepository: this.memoryRepository,
        auditLogRepository: this.auditLogRepository,
        jobQueue: this.jobQueue,
      },
      { userId, correlationId },
      input,
    );
  }

  get(userId: string, id: string): Promise<MemoryDto> {
    return getMemory({ memoryRepository: this.memoryRepository }, userId, id);
  }

  list(
    userId: string,
    query: ListMemoriesQueryInput,
  ): Promise<{ items: MemoryDto[]; cursor: string | null }> {
    return listMemories({ memoryRepository: this.memoryRepository }, userId, query);
  }

  search(
    userId: string,
    input: SearchMemoriesInput,
  ): Promise<{ items: ScoredMemoryDto[]; cursor: string | null }> {
    return searchMemories(
      {
        memoryRepository: this.memoryRepository,
        embeddingProvider: this.embeddingProvider,
        vectorStore: this.vectorStore,
      },
      {
        userId,
        query: input.query,
        category: input.category,
        tags: input.tags,
        includeArchived: input.includeArchived,
        from: input.from,
        to: input.to,
        limit: input.limit,
      },
    );
  }

  update(
    userId: string,
    correlationId: string,
    id: string,
    input: UpdateMemoryInput,
  ): Promise<MemoryDto> {
    return updateMemory(
      {
        memoryRepository: this.memoryRepository,
        auditLogRepository: this.auditLogRepository,
        jobQueue: this.jobQueue,
      },
      { userId, correlationId },
      id,
      input,
    );
  }

  delete(userId: string, correlationId: string, id: string): Promise<void> {
    return deleteMemory(
      {
        memoryRepository: this.memoryRepository,
        auditLogRepository: this.auditLogRepository,
        jobQueue: this.jobQueue,
      },
      { userId, correlationId },
      id,
    );
  }
}

function isClosable(queue: JobQueue): queue is JobQueue & { close: () => Promise<void> } {
  return 'close' in queue && typeof queue.close === 'function';
}
