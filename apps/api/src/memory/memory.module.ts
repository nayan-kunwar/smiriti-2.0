import { Module } from '@nestjs/common';
import { MemoryController } from './memory.controller.js';
import { MemoryService } from './memory.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import { EMBEDDING_PROVIDER, JOB_QUEUE, VECTOR_STORE } from './memory.tokens.js';
import {
  BullMqJobQueue,
  QdrantVectorStore,
  createEmbeddingProvider,
} from '@smriti/infrastructure';
import type { AppConfig } from '@smriti/shared';
import type { EmbeddingProvider } from '@smriti/domain';

@Module({
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
      useFactory: (config: AppConfig) => new BullMqJobQueue(config.REDIS_URL),
      inject: [APP_CONFIG],
    },
  ],
})
export class MemoryModule {}
