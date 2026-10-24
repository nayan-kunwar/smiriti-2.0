import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import {
  FakeEmbeddingProvider,
  InMemoryJobQueue,
  InMemoryVectorStore,
} from '@smriti/infrastructure';
import { EMBEDDING_PROVIDER, JOB_QUEUE, VECTOR_STORE } from '../memory/memory.tokens.js';

async function checkDatabase(): Promise<boolean> {
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

const dbAvailable = await checkDatabase();

describe.skipIf(!dbAvailable)('Admin job failures API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const jobQueue = new InMemoryJobQueue();
  let userId: string;
  let adminUserId: string;
  let accessToken: string;
  let adminAccessToken: string;
  let failureId: string;
  const suffix = Date.now();

  beforeAll(async () => {
    const { AppModule } = await import('../app.module.js');
    const { PRISMA_CLIENT } = await import('../prisma/prisma.module.js');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(new FakeEmbeddingProvider())
      .overrideProvider(VECTOR_STORE)
      .useValue(new InMemoryVectorStore())
      .overrideProvider(JOB_QUEUE)
      .useValue(jobQueue)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PRISMA_CLIENT);

    const userRes = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `job-failure-user-${suffix}@example.com`, password: 'password123' })
      .expect(201);
    userId = userRes.body.user.id;
    accessToken = userRes.body.accessToken;

    const adminRes = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `job-failure-admin-${suffix}@example.com`, password: 'password123' })
      .expect(201);
    adminUserId = adminRes.body.user.id;
    await prisma.user.update({ where: { id: adminUserId }, data: { role: 'admin' } });

    const adminLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: adminRes.body.user.email, password: 'password123' })
      .expect(200);
    adminAccessToken = adminLogin.body.accessToken;

    const failure = await prisma.jobFailure.create({
      data: {
        jobId: `memory-${suffix}_hash-${suffix}`,
        jobName: 'embed-and-index',
        queue: 'smriti-jobs',
        payload: {
          memoryId: `memory-${suffix}`,
          userId,
          contentHash: `hash-${suffix}`,
          correlationId: 'original-indexing-correlation',
        },
        attempts: 3,
        error: 'embedding provider unavailable',
        correlationId: 'original-indexing-correlation',
      },
    });
    failureId = failure.id;
  }, 30_000);

  afterAll(async () => {
    if (!app) return;
    await prisma.auditLog.deleteMany({ where: { userId: { in: [userId, adminUserId] } } });
    await prisma.jobFailure.deleteMany({ where: { id: failureId } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [userId, adminUserId] } } });
    await prisma.apiKey.deleteMany({ where: { userId: { in: [userId, adminUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminUserId] } } });
    await app.close();
  });

  it('lists durable failures for admins only', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/job-failures')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    const response = await request(app.getHttpServer())
      .get('/v1/admin/job-failures')
      .query({ status: 'open', jobName: 'embed-and-index', limit: 10 })
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(response.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: failureId })]),
    );
    const item = response.body.items.find((entry: { id: string }) => entry.id === failureId);
    expect(item).toMatchObject({
      id: failureId,
      jobId: `memory-${suffix}_hash-${suffix}`,
      jobName: 'embed-and-index',
      queue: 'smriti-jobs',
      attempts: 3,
      error: 'embedding provider unavailable',
      correlationId: 'original-indexing-correlation',
      status: 'open',
      retriedAt: null,
      retriedBy: null,
    });
    expect(item.payload).toMatchObject({
      memoryId: `memory-${suffix}`,
      contentHash: `hash-${suffix}`,
    });
    expect(response.body.cursor).toBeNull();
  });

  it('replays a failure, audits it, and rejects a second retry', async () => {
    await request(app.getHttpServer())
      .post(`/v1/admin/job-failures/${failureId}/retry`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    const response = await request(app.getHttpServer())
      .post(`/v1/admin/job-failures/${failureId}/retry`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .set('x-correlation-id', 'admin-retry-test')
      .expect(202);

    expect(response.body.status).toBe('retried');
    expect(response.body.retriedBy).toBe(adminUserId);
    expect(response.body.retriedAt).toBeTruthy();
    expect(jobQueue.jobs).toHaveLength(1);
    expect(jobQueue.jobs[0]).toMatchObject({
      name: 'embed-and-index',
      opts: { jobId: `memory-${suffix}_hash-${suffix}`, force: true },
    });

    const audit = await prisma.auditLog.findFirst({
      where: { userId: adminUserId, action: 'job.retry', entityId: failureId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.correlationId).toBe('admin-retry-test');
    expect(audit?.payloadSnapshot).toMatchObject({
      jobName: 'embed-and-index',
      queue: 'smriti-jobs',
      attempts: 3,
      failureCorrelationId: 'original-indexing-correlation',
    });

    const conflict = await request(app.getHttpServer())
      .post(`/v1/admin/job-failures/${failureId}/retry`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(409);
    expect(conflict.body.reason).toBe('JOB_FAILURE_ALREADY_RETRIED');

    const retried = await request(app.getHttpServer())
      .get('/v1/admin/job-failures')
      .query({ status: 'retried' })
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);
    expect(retried.body.items.some((item: { id: string }) => item.id === failureId)).toBe(true);

    const metrics = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(metrics.text).toMatch(
      /smriti_job_manual_retries_total\{[^}]*job="embed-and-index"[^}]*\} 1/,
    );
  });

  it('returns 404 for an unknown failure and 400 for a malformed ID', async () => {
    await request(app.getHttpServer())
      .post('/v1/admin/job-failures/00000000-0000-4000-8000-000000000000/retry')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post('/v1/admin/job-failures/not-a-uuid/retry')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(400);
  });
});
