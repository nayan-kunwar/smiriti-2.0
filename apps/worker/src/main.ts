import { createServer } from 'node:http';
import pino from 'pino';
import { Queue, Worker, type Job } from 'bullmq';
import { loadConfig } from '@smriti/shared';
import {
  CLEANUP_CHAT_TURNS_JOB,
  CLEANUP_IDEMPOTENCY_KEYS_JOB,
  CLEANUP_JOB_FAILURES_JOB,
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
  Metrics,
  PrismaChatTurnRepository,
  PrismaIdempotencyStore,
  PrismaJobFailureRepository,
  PrismaMemoryEmbeddingStore,
  PrismaMemoryIndexStateStore,
  PrismaMemoryRepository,
  QdrantVectorStore,
  redisConnectionFromUrl,
  SMRITI_QUEUE_NAME,
} from '@smriti/infrastructure';
import { handleDeleteVectors, handleEmbedAndIndex, reconcileVectors } from '@smriti/application';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const metrics = new Metrics();
const RECONCILE_SCHEDULER_ID = 'reconcile-vectors';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinalAttempt(job: Job): boolean {
  const maxAttempts = job.opts.attempts ?? 1;
  return job.attemptsMade + 1 >= maxAttempts;
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
  const idempotencyStore = new PrismaIdempotencyStore(prisma);
  const jobFailureRepository = new PrismaJobFailureRepository(prisma);
  const chatTurnRepository = new PrismaChatTurnRepository(prisma);
  const jobQueue = new BullMqJobQueue(config.REDIS_URL, {
    attempts: config.JOB_ATTEMPTS,
    backoffDelayMs: config.JOB_BACKOFF_DELAY_MS,
    removeOnComplete: config.JOB_REMOVE_ON_COMPLETE,
    removeOnFail: config.JOB_REMOVE_ON_FAIL,
  });
  const schedulerQueue = new Queue(SMRITI_QUEUE_NAME, { connection });

  async function recordTerminalFailure(job: Job, err: unknown): Promise<void> {
    const payload = isRecord(job.data) ? job.data : {};
    const correlationId =
      typeof payload.correlationId === 'string' && payload.correlationId.length > 0
        ? payload.correlationId
        : (job.id ?? 'unknown');
    const attempts = Math.min(job.attemptsMade + 1, job.opts.attempts ?? 1);

    try {
      await jobFailureRepository.record({
        jobId: job.id ?? 'unknown',
        jobName: job.name,
        queue: SMRITI_QUEUE_NAME,
        payload,
        attempts,
        error: errorMessage(err),
        correlationId,
      });
      metrics.observeTerminalJobFailure(SMRITI_QUEUE_NAME, job.name);
      logger.error(
        { jobId: job.id, jobName: job.name, attempts, correlationId },
        'Terminal job failure persisted',
      );
    } catch (recordErr) {
      logger.error(
        { jobId: job.id, jobName: job.name, err: recordErr },
        'Failed to persist terminal job failure',
      );
    }
  }

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
          if (isFinalAttempt(job)) {
            await indexStateStore
              .markFailed(payload.memoryId, payload.contentHash, errorMessage(err))
              .catch((stateErr) => {
                logger.error(
                  { jobId: job.id, memoryId: payload.memoryId, err: stateErr },
                  'Failed to record indexing failure',
                );
              });
            await recordTerminalFailure(job, err);
          }
          throw err;
        }
        return;
      }
      if (job.name === DELETE_VECTORS_JOB) {
        const payload = job.data as DeleteVectorsPayload;
        logger.info({ jobId: job.id, memoryId: payload.memoryId }, 'delete-vectors start');
        try {
          await handleDeleteVectors({ vectorStore, embeddingStore }, payload);
        } catch (err) {
          if (isFinalAttempt(job)) {
            await recordTerminalFailure(job, err);
          }
          throw err;
        }
        return;
      }
      if (job.name === CLEANUP_IDEMPOTENCY_KEYS_JOB) {
        const deleted = await idempotencyStore.deleteExpired(new Date());
        logger.info({ jobId: job.id, deleted }, 'cleanup-idempotency-keys complete');
        return;
      }
      if (job.name === CLEANUP_JOB_FAILURES_JOB) {
        const cutoff = new Date(
          Date.now() - config.JOB_FAILURE_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
        );
        const deleted = await jobFailureRepository.deleteOlderThan(cutoff);
        logger.info(
          {
            jobId: job.id,
            deleted,
            retentionDays: config.JOB_FAILURE_RETENTION_DAYS,
          },
          'cleanup-job-failures complete',
        );
        return;
      }
      if (job.name === CLEANUP_CHAT_TURNS_JOB) {
        const cutoff = new Date(
          Date.now() - config.CHAT_TURN_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
        );
        const deleted = await chatTurnRepository.deleteOlderThan(cutoff);
        logger.info(
          {
            jobId: job.id,
            deleted,
            retentionDays: config.CHAT_TURN_RETENTION_DAYS,
          },
          'cleanup-chat-turns complete',
        );
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

  function jobDurationSeconds(processedOn?: number, finishedOn?: number): number {
    const start = processedOn ?? Date.now();
    const end = finishedOn ?? Date.now();
    return Math.max(0, (end - start) / 1000);
  }

  worker.on('completed', (job) => {
    metrics.observeJob(
      SMRITI_QUEUE_NAME,
      job.name,
      'completed',
      jobDurationSeconds(job.processedOn ?? job.timestamp, job.finishedOn),
    );
    logger.info({ jobId: job.id }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    if (job) {
      metrics.observeJob(
        SMRITI_QUEUE_NAME,
        job.name,
        'failed',
        jobDurationSeconds(job.processedOn ?? job.timestamp, job.finishedOn),
      );
    }
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

  await schedulerQueue.upsertJobScheduler(
    'cleanup-idempotency-keys',
    { every: config.IDEMPOTENCY_CLEANUP_INTERVAL_MINUTES * 60_000 },
    { name: CLEANUP_IDEMPOTENCY_KEYS_JOB, data: {} },
  );
  logger.info(
    { intervalMinutes: config.IDEMPOTENCY_CLEANUP_INTERVAL_MINUTES },
    'Idempotency cleanup scheduler registered',
  );

  await schedulerQueue.upsertJobScheduler(
    'cleanup-job-failures',
    { every: config.JOB_FAILURE_CLEANUP_INTERVAL_MINUTES * 60_000 },
    { name: CLEANUP_JOB_FAILURES_JOB, data: {} },
  );
  logger.info(
    {
      intervalMinutes: config.JOB_FAILURE_CLEANUP_INTERVAL_MINUTES,
      retentionDays: config.JOB_FAILURE_RETENTION_DAYS,
    },
    'Job failure cleanup scheduler registered',
  );

  await schedulerQueue.upsertJobScheduler(
    'cleanup-chat-turns',
    { every: config.CHAT_TURN_CLEANUP_INTERVAL_MINUTES * 60_000 },
    { name: CLEANUP_CHAT_TURNS_JOB, data: {} },
  );
  logger.info(
    {
      intervalMinutes: config.CHAT_TURN_CLEANUP_INTERVAL_MINUTES,
      retentionDays: config.CHAT_TURN_RETENTION_DAYS,
    },
    'Chat turn cleanup scheduler registered',
  );

  const metricsServer = createServer(async (request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (request.method !== 'GET' || path !== '/metrics') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    try {
      const body = await metrics.render();
      response.writeHead(200, {
        'Content-Type': metrics.contentType,
        'Cache-Control': 'no-store',
      });
      response.end(body);
    } catch (err) {
      logger.error({ err }, 'Failed to render worker metrics');
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Metrics unavailable');
    }
  });
  metricsServer.on('error', (err) => {
    logger.error({ err, port: config.WORKER_METRICS_PORT }, 'Worker metrics server error');
  });
  metricsServer.listen(config.WORKER_METRICS_PORT, () => {
    logger.info({ port: config.WORKER_METRICS_PORT }, 'Worker metrics server listening');
  });

  logger.info('Worker started, waiting for jobs...');

  const shutdown = async () => {
    logger.info('Shutting down worker...');
    if (metricsServer.listening) {
      await new Promise<void>((resolve) => {
        metricsServer.close(() => resolve());
      });
    }
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
