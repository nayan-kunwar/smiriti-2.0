import pino from 'pino';
import { Queue, Worker } from 'bullmq';
import { loadConfig } from '@smriti/shared';
import {
  DELETE_VECTORS_JOB,
  EMBED_AND_INDEX_JOB,
  RECONCILE_VECTORS_JOB,
  type DeleteVectorsPayload,
  type EmbedAndIndexPayload,
} from '@smriti/domain';
import {
  BullMqJobQueue,
  createEmbeddingProvider,
  disconnectPrisma,
  getPrismaClient,
  PrismaMemoryEmbeddingStore,
  PrismaMemoryIndexStateStore,
  PrismaMemoryRepository,
  QdrantVectorStore,
  redisConnectionFromUrl,
  SMRITI_QUEUE_NAME,
} from '@smriti/infrastructure';
import { handleDeleteVectors, handleEmbedAndIndex, reconcileVectors } from '@smriti/application';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const RECONCILE_SCHEDULER_ID = 'reconcile-vectors';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
  const indexStateStore = new PrismaMemoryIndexStateStore(prisma);
  const jobQueue = new BullMqJobQueue(config.REDIS_URL);
  const schedulerQueue = new Queue(SMRITI_QUEUE_NAME, { connection });

  const worker = new Worker(
    SMRITI_QUEUE_NAME,
    async (job) => {
      if (job.name === EMBED_AND_INDEX_JOB) {
        const payload = job.data as EmbedAndIndexPayload;
        logger.info(
          { jobId: job.id, memoryId: payload.memoryId, correlationId: payload.correlationId },
          'embed-and-index start',
        );
        try {
          await handleEmbedAndIndex(
            {
              memoryRepository,
              embeddingProvider,
              vectorStore,
              embeddingStore,
              indexStateStore,
              embeddingProviderName: config.EMBEDDING_PROVIDER,
            },
            payload,
          );
        } catch (err) {
          const maxAttempts = job.opts.attempts ?? 1;
          if (job.attemptsMade + 1 >= maxAttempts) {
            await indexStateStore
              .markFailed(payload.memoryId, payload.contentHash, errorMessage(err))
              .catch((stateErr) => {
                logger.error(
                  { jobId: job.id, memoryId: payload.memoryId, err: stateErr },
                  'Failed to record indexing failure',
                );
              });
          }
          throw err;
        }
        return;
      }
      if (job.name === DELETE_VECTORS_JOB) {
        const payload = job.data as DeleteVectorsPayload;
        logger.info({ jobId: job.id, memoryId: payload.memoryId }, 'delete-vectors start');
        await handleDeleteVectors({ vectorStore, embeddingStore }, payload);
        return;
      }
      if (job.name === RECONCILE_VECTORS_JOB) {
        const summary = await reconcileVectors({
          memoryRepository,
          indexStateStore,
          vectorStore,
          jobQueue,
          batchSize: config.RECONCILE_BATCH_SIZE,
          maxEnqueue: config.RECONCILE_MAX_ENQUEUE,
          maxChunkTokens: embeddingProvider.maxInputTokens,
          correlationId: job.id ?? 'reconcile',
        });
        logger.info({ jobId: job.id, ...summary }, 'reconcile-vectors complete');
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

  if (config.RECONCILE_ENABLED) {
    await schedulerQueue.upsertJobScheduler(
      RECONCILE_SCHEDULER_ID,
      { every: config.RECONCILE_INTERVAL_MINUTES * 60_000 },
      { name: RECONCILE_VECTORS_JOB, data: {} },
    );
    logger.info(
      { intervalMinutes: config.RECONCILE_INTERVAL_MINUTES },
      'Reconcile scheduler registered',
    );
  } else {
    await schedulerQueue.removeJobScheduler(RECONCILE_SCHEDULER_ID);
  }

  logger.info('Worker started, waiting for jobs...');

  const shutdown = async () => {
    logger.info('Shutting down worker...');
    await worker.close();
    await jobQueue.close();
    await schedulerQueue.close();
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
