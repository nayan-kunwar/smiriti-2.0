import 'reflect-metadata';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

let databaseAvailable = false;

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

describe.skipIf(!dbAvailable)('Memory API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let userId: string;
  let accessToken: string;
  let apiKey: string;

  beforeAll(async () => {
    const { AppModule } = await import('../app.module.js');
    const { PRISMA_CLIENT } = await import('../prisma/prisma.module.js');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PRISMA_CLIENT);

    const registerRes = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `memory-${Date.now()}@example.com`, password: 'password123' })
      .expect(201);

    userId = registerRes.body.user.id;
    accessToken = registerRes.body.accessToken;

    const apiKeyRes = await request(app.getHttpServer())
      .post('/v1/api-keys')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'memory-tests' })
      .expect(201);

    apiKey = apiKeyRes.body.key;
  });

  afterAll(async () => {
    if (!app) return;
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.memory.deleteMany({ where: { userId } });
    await prisma.apiKey.deleteMany({ where: { userId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it('POST /v1/memories creates a memory and audit log', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/memories')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Correlation-Id', 'test-corr-1')
      .send({
        type: 'long_term',
        content: 'Favorite color is blue',
        tags: ['preferences'],
      })
      .expect(201);

    expect(response.body.content).toBe('Favorite color is blue');
    expect(response.body.userId).toBe(userId);
    expect(response.body.tags).toEqual(['preferences']);

    const auditLogs = await prisma.auditLog.findMany({
      where: { userId, action: 'memory.create' },
    });
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('supports API key authentication', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/memories')
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);

    expect(Array.isArray(response.body.items)).toBe(true);
  });

  it('GET /v1/memories lists memories', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/memories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'semantic', content: 'TypeScript is great' });

    const response = await request(app.getHttpServer())
      .get('/v1/memories')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.items.length).toBeGreaterThanOrEqual(1);
    expect(response.body.items.some((m: { id: string }) => m.id === createRes.body.id)).toBe(true);
  });

  it('PATCH /v1/memories/:id updates a memory', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/memories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'long_term', content: 'Original content' });

    const response = await request(app.getHttpServer())
      .patch(`/v1/memories/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isPinned: true })
      .expect(200);

    expect(response.body.isPinned).toBe(true);
  });

  it('DELETE /v1/memories/:id removes a memory', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/memories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'long_term', content: 'To be deleted' });

    await request(app.getHttpServer())
      .delete(`/v1/memories/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/v1/memories/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('returns 401 without authentication', async () => {
    await request(app.getHttpServer())
      .post('/v1/memories')
      .send({ type: 'long_term', content: 'No auth' })
      .expect(401);
  });
});

describe('Memory API database availability', () => {
  it('reports whether postgres is reachable for e2e', async () => {
    databaseAvailable = await checkDatabase();
    if (!databaseAvailable) {
      console.warn('Skipping Memory API e2e tests: Postgres not reachable');
    }
    expect(typeof databaseAvailable).toBe('boolean');
  });
});
