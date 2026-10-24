import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../common/idempotency/idempotency.module.js';
import { MemoryController } from './memory.controller.js';
import { MemoryService } from './memory.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import { EMBEDDING_PROVIDER, JOB_QUEUE, VECTOR_STORE } from './memory.tokens.js';
import { BullMqJobQueue, QdrantVectorStore, createEmbeddingProvider } from '@smriti/infrastructure';
import type { AppConfig } from '@smriti/shared';
import type { EmbeddingProvider } from '@smriti/domain';

@Module({
  imports: [IdempotencyModule],
  controllers: [MemoryController],
  providers: [
    MemoryService,
    {
      provide: EMBEDDING_PROVIDER,
      useFactory: (config: AppConfig): EmbeddingProvider => createEmbeddingProvider(config),
      inject: [APP_CONFIG],
    },
    {
      provide: VECTOR_STORE,
      useFactory: (config: AppConfig, embedding: EmbeddingProvider) =>
        new QdrantVectorStore({
          baseUrl: config.QDRANT_URL,
          collection: config.QDRANT_COLLECTION,
          dimension: embedding.dimension,
        }),
      inject: [APP_CONFIG, EMBEDDING_PROVIDER],
    },
    {
      provide: JOB_QUEUE,
      useFactory: (config: AppConfig) =>
        new BullMqJobQueue(config.REDIS_URL, {
          attempts: config.JOB_ATTEMPTS,
          backoffDelayMs: config.JOB_BACKOFF_DELAY_MS,
          removeOnComplete: config.JOB_REMOVE_ON_COMPLETE,
          removeOnFail: config.JOB_REMOVE_ON_FAIL,
        }),
      inject: [APP_CONFIG],
    },
  ],
  exports: [EMBEDDING_PROVIDER, VECTOR_STORE, JOB_QUEUE],
})
export class MemoryModule {}
