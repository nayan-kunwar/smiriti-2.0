import pino from 'pino';
import { Worker } from 'bullmq';
import { loadConfig } from '@smriti/shared';
import {
  DELETE_VECTORS_JOB,
  EMBED_AND_INDEX_JOB,
  type DeleteVectorsPayload,
  type EmbedAndIndexPayload,
} from '@smriti/domain';
import {
  createEmbeddingProvider,
  disconnectPrisma,
  getPrismaClient,
  PrismaMemoryEmbeddingStore,
  PrismaMemoryRepository,
  QdrantVectorStore,
  redisConnectionFromUrl,
  SMRITI_QUEUE_NAME,
} from '@smriti/infrastructure';
import { handleDeleteVectors, handleEmbedAndIndex } from '@smriti/application';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

async function main(): Promise<void> {
  const config = loadConfig();
  const connection = redisConnectionFromUrl(config.REDIS_URL);
  const prisma = getPrismaClient();

  const embeddingProvider = createEmbeddingProvider(config);
  const vectorStore = new QdrantVectorStore({
    baseUrl: config.QDRANT_URL,
    collection: config.QDRANT_COLLECTION,
    dimension: embeddingProvider.dimension,
  });
  await vectorStore.ensureCollection();
  logger.info(
    { collection: config.QDRANT_COLLECTION, dim: embeddingProvider.dimension },
    'Qdrant collection ready',
  );

  const memoryRepository = new PrismaMemoryRepository(prisma);
  const embeddingStore = new PrismaMemoryEmbeddingStore(prisma);

  const worker = new Worker(
    SMRITI_QUEUE_NAME,
    async (job) => {
      if (job.name === EMBED_AND_INDEX_JOB) {
        const payload = job.data as EmbedAndIndexPayload;
        logger.info(
          { jobId: job.id, memoryId: payload.memoryId, correlationId: payload.correlationId },
          'embed-and-index start',
        );
        await handleEmbedAndIndex(
          {
            memoryRepository,
            embeddingProvider,
            vectorStore,
            embeddingStore,
            embeddingProviderName: config.EMBEDDING_PROVIDER,
          },
          payload,
        );
        return;
      }
      if (job.name === DELETE_VECTORS_JOB) {
        const payload = job.data as DeleteVectorsPayload;
        logger.info({ jobId: job.id, memoryId: payload.memoryId }, 'delete-vectors start');
        await handleDeleteVectors({ vectorStore, embeddingStore }, payload);
        return;
      }
      logger.warn({ jobId: job.id, jobName: job.name }, 'Unknown job, ignoring');
    },
    { connection },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job failed');
  });

  logger.info('Worker started, waiting for jobs...');

  const shutdown = async () => {
    logger.info('Shutting down worker...');
    await worker.close();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error(err, 'Worker failed to start');
  process.exit(1);
});
