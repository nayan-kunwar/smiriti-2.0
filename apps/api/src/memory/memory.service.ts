import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import {
  createMemory,
  deleteMemory,
  getMemory,
  listMemories,
  searchMemories,
  updateMemory,
  type DuplicateMemoryMatch,
  type MemoryDto,
  type ScoredMemoryDto,
} from '@smriti/application';
import type { EmbeddingProvider, JobQueue, VectorStore } from '@smriti/domain';
import {
  PrismaAuditLogRepository,
  PrismaMemoryIndexStateStore,
  PrismaMemoryRepository,
} from '@smriti/infrastructure';
import type {
  AppConfig,
  CreateMemoryInput,
  ListMemoriesQueryInput,
  SearchMemoriesInput,
  UpdateMemoryInput,
} from '@smriti/shared';
import { APP_CONFIG } from '../config/config.module.js';
import { PRISMA_CLIENT } from '../prisma/prisma.module.js';
import { EMBEDDING_PROVIDER, JOB_QUEUE, VECTOR_STORE } from './memory.tokens.js';

@Injectable()
export class MemoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoryService.name);
  private readonly memoryRepository: PrismaMemoryRepository;
  private readonly auditLogRepository: PrismaAuditLogRepository;
  private readonly indexStateStore: PrismaMemoryIndexStateStore;

  constructor(
    @Inject(PRISMA_CLIENT) prisma: PrismaClient,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.memoryRepository = new PrismaMemoryRepository(prisma);
    this.auditLogRepository = new PrismaAuditLogRepository(prisma);
    this.indexStateStore = new PrismaMemoryIndexStateStore(prisma);
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

  create(
    userId: string,
    correlationId: string,
    input: CreateMemoryInput,
    force = false,
  ): Promise<MemoryDto> {
    return createMemory(
      {
        memoryRepository: this.memoryRepository,
        auditLogRepository: this.auditLogRepository,
        jobQueue: this.jobQueue,
        indexStateStore: this.indexStateStore,
        duplicateDetector: (ownerId, content) => this.findDuplicate(ownerId, content),
      },
      { userId, correlationId, force },
      input,
    );
  }

  /**
   * Dedup must never block a durable Postgres write. If embedding or Qdrant is
   * unavailable, fall through and let the normal indexing path retry.
   */
  private async findDuplicate(
    userId: string,
    content: string,
  ): Promise<DuplicateMemoryMatch | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), this.config.DEDUP_TIMEOUT_MS);
      });
      const result = await Promise.race([
        this.search(userId, {
          query: content,
          limit: 1,
          includeArchived: false,
        }),
        timeout,
      ]);
      if (!result) {
        this.logger.warn(`Duplicate check timed out for user ${userId}`);
        return null;
      }
      const top = result.items[0];
      if (top && top.score >= this.config.DEDUP_SIMILARITY_THRESHOLD) {
        return { memoryId: top.id, similarity: Math.min(1, top.score) };
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `Duplicate check skipped for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  get(userId: string, id: string): Promise<MemoryDto> {
    return getMemory(
      { memoryRepository: this.memoryRepository, indexStateStore: this.indexStateStore },
      userId,
      id,
    );
  }

  list(
    userId: string,
    query: ListMemoriesQueryInput,
  ): Promise<{ items: MemoryDto[]; cursor: string | null }> {
    return listMemories(
      { memoryRepository: this.memoryRepository, indexStateStore: this.indexStateStore },
      userId,
      query,
    );
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
        indexStateStore: this.indexStateStore,
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
