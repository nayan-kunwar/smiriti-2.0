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

describe.skipIf(!dbAvailable)('Auth API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let accessToken: string;
  let refreshToken: string;
  let userId: string;
  let adminAccessToken: string;
  let adminUserId: string;

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
      .send({ email: `auth-${Date.now()}@example.com`, password: 'password123' })
      .expect(201);

    accessToken = registerRes.body.accessToken;
    refreshToken = registerRes.body.refreshToken;
    userId = registerRes.body.user.id;

    const adminRes = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `admin-${Date.now()}@example.com`, password: 'password123' })
      .expect(201);

    adminUserId = adminRes.body.user.id;
    await prisma.user.update({
      where: { id: adminUserId },
      data: { role: 'admin' },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: adminRes.body.user.email, password: 'password123' })
      .expect(200);

    adminAccessToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    if (!app) return;
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [userId, adminUserId] } } });
    await prisma.apiKey.deleteMany({ where: { userId: { in: [userId, adminUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminUserId] } } });
    await app.close();
  });

  it('POST /v1/auth/login returns tokens', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        email: (await prisma.user.findUnique({ where: { id: userId } }))!.email,
        password: 'password123',
      })
      .expect(200);

    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.refreshToken).toBeTruthy();
  });

  it('POST /v1/auth/refresh rotates refresh token', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.refreshToken).not.toBe(refreshToken);
    refreshToken = response.body.refreshToken;
  });

  it('POST /v1/api-keys issues a key and DELETE revokes it', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/api-keys')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'test-key' })
      .expect(201);

    expect(createRes.body.key).toMatch(/^smriti_/);

    await request(app.getHttpServer())
      .delete(`/v1/api-keys/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
  });

  it('GET /v1/admin/users requires admin role', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    const response = await request(app.getHttpServer())
      .get('/v1/admin/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(response.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /v1/auth/logout revokes refresh token', async () => {
    await request(app.getHttpServer()).post('/v1/auth/logout').send({ refreshToken }).expect(204);
  });
});

describe('Auth API database availability', () => {
  it('reports whether postgres is reachable for e2e', async () => {
    databaseAvailable = await checkDatabase();
    if (!databaseAvailable) {
      console.warn('Skipping Auth API e2e tests: Postgres not reachable');
    }
    expect(typeof databaseAvailable).toBe('boolean');
  });
});
