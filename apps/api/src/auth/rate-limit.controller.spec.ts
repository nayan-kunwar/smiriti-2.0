import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe.skipIf(!dbAvailable)('Per-user rate limiting (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let userAId: string | undefined;
  let userBId: string | undefined;
  let accessTokenA: string | undefined;
  let previousMax: string | undefined;
  let previousTtl: string | undefined;
  let previousExpensiveMax: string | undefined;
  let previousExpensiveTtl: string | undefined;

  beforeAll(async () => {
    previousMax = process.env.RATE_LIMIT_MAX;
    previousTtl = process.env.RATE_LIMIT_TTL;
    previousExpensiveMax = process.env.RATE_LIMIT_EXPENSIVE_MAX;
    previousExpensiveTtl = process.env.RATE_LIMIT_EXPENSIVE_TTL;
    process.env.RATE_LIMIT_MAX = '2';
    process.env.RATE_LIMIT_TTL = '60';
    process.env.RATE_LIMIT_EXPENSIVE_MAX = '1';
    process.env.RATE_LIMIT_EXPENSIVE_TTL = '60';

    const { AppModule } = await import('../app.module.js');
    const { PRISMA_CLIENT } = await import('../prisma/prisma.module.js');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    prisma = moduleRef.get(PRISMA_CLIENT);
    await app.init();
  }, 30_000);

  afterAll(async () => {
    restoreEnv('RATE_LIMIT_MAX', previousMax);
    restoreEnv('RATE_LIMIT_TTL', previousTtl);
    restoreEnv('RATE_LIMIT_EXPENSIVE_MAX', previousExpensiveMax);
    restoreEnv('RATE_LIMIT_EXPENSIVE_TTL', previousExpensiveTtl);

    if (app) {
      const userIds = [userAId, userBId].filter((id): id is string => Boolean(id));
      if (userIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      await app.close();
    }
  });

  it('allows a second user after the first user exhausts the route limit', async () => {
    const userA = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `rate-a-${Date.now()}@example.com`, password: 'password123' })
      .expect(201);
    const userB = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `rate-b-${Date.now()}@example.com`, password: 'password123' })
      .expect(201);

    userAId = userA.body.user.id;
    userBId = userB.body.user.id;
    accessTokenA = userA.body.accessToken;

    const first = await request(app.getHttpServer())
      .get('/v1/memories')
      .set('Authorization', `Bearer ${userA.body.accessToken}`)
      .expect(200);
    expect(first.headers['x-ratelimit-limit']).toBe('2');

    await request(app.getHttpServer())
      .get('/v1/memories')
      .set('Authorization', `Bearer ${userA.body.accessToken}`)
      .expect(200);

    const blocked = await request(app.getHttpServer())
      .get('/v1/memories')
      .set('Authorization', `Bearer ${userA.body.accessToken}`)
      .expect(429);

    expect(blocked.body).toMatchObject({
      statusCode: 429,
      message: 'Rate limit exceeded',
      reason: 'RATE_LIMIT_EXCEEDED',
    });
    expect(blocked.body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);

    await request(app.getHttpServer())
      .get('/v1/memories')
      .set('Authorization', `Bearer ${userB.body.accessToken}`)
      .expect(200);
  });

  it('applies the named expensive limit to semantic search only', async () => {
    const token = accessTokenA as string;

    await request(app.getHttpServer())
      .post('/v1/memories/search')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);

    const blocked = await request(app.getHttpServer())
      .post('/v1/memories/search')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(429);

    expect(blocked.body).toMatchObject({
      statusCode: 429,
      reason: 'RATE_LIMIT_EXCEEDED',
    });
    expect(Number(blocked.headers['retry-after-expensive'])).toBeGreaterThanOrEqual(1);
  });

  it('uses separate rate-limit buckets for each API key', async () => {
    const token = accessTokenA as string;
    const firstKey = await request(app.getHttpServer())
      .post('/v1/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'rate-key-1' })
      .expect(201);
    const secondKey = await request(app.getHttpServer())
      .post('/v1/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'rate-key-2' })
      .expect(201);

    await request(app.getHttpServer())
      .get('/v1/memories')
      .set('X-API-Key', firstKey.body.key)
      .expect(200);
    await request(app.getHttpServer())
      .get('/v1/memories')
      .set('X-API-Key', firstKey.body.key)
      .expect(200);
    await request(app.getHttpServer())
      .get('/v1/memories')
      .set('X-API-Key', secondKey.body.key)
      .expect(200);
  });
});

describe('Rate limit API database availability', () => {
  it('reports whether postgres is reachable for e2e', async () => {
    databaseAvailable = await checkDatabase();
    if (!databaseAvailable) {
      console.warn('Skipping rate-limit e2e tests: Postgres not reachable');
    }
    expect(typeof databaseAvailable).toBe('boolean');
  });
});
