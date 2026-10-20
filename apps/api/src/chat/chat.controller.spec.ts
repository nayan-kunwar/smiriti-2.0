import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import {
  FakeChatModel,
  FakeEmbeddingProvider,
  InMemoryJobQueue,
  InMemoryVectorStore,
} from '@smriti/infrastructure';
import { CHAT_MODEL } from './chat.tokens.js';
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

describe.skipIf(!dbAvailable)('Chat API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let userId: string;
  let accessToken: string;
  let model: FakeChatModel;

  beforeAll(async () => {
    const { AppModule } = await import('../app.module.js');
    const { PRISMA_CLIENT } = await import('../prisma/prisma.module.js');
    model = new FakeChatModel([
      '{"intent":"remember","memories":[{"content":"I live in Lisbon","type":"long_term","confidence":0.95}]}',
      'Noted — you live in Lisbon.',
      '{"intent":"remember","memories":[{"content":"I live in Porto","type":"long_term","confidence":0.95}]}',
      'Noted — you live in Porto.',
      '{"intent":"general","memories":[]}',
      'Hello! How can I help?',
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(new FakeEmbeddingProvider())
      .overrideProvider(VECTOR_STORE)
      .useValue(new InMemoryVectorStore())
      .overrideProvider(JOB_QUEUE)
      .useValue(new InMemoryJobQueue())
      .overrideProvider(CHAT_MODEL)
      .useValue(model)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PRISMA_CLIENT);

    const registerRes = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: `chat-${Date.now()}@example.com`, password: 'password123' })
      .expect(201);
    userId = registerRes.body.user.id;
    accessToken = registerRes.body.accessToken;
  }, 30_000);

  afterAll(async () => {
    if (!app) return;
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.conversation.deleteMany({ where: { userId } });
    await prisma.memory.deleteMany({ where: { userId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it('POST /v1/chat creates a conversation, stores a memory, and persists both messages', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'Remember that I live in Lisbon' })
      .expect(200);

    expect(response.body.conversationId).toBeTruthy();
    expect(response.body.message).toContain('Lisbon');
    expect(response.body.memoriesCreated).toHaveLength(1);

    const messages = await request(app.getHttpServer())
      .get(`/v1/conversations/${response.body.conversationId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(messages.body.items.map((message: { role: string }) => message.role)).toEqual([
      'user',
      'assistant',
    ]);

    const memory = await prisma.memory.findFirst({
      where: { userId, content: 'I live in Lisbon' },
    });
    expect(memory).not.toBeNull();
  });

  it('replays an identical idempotent chat turn without writing duplicate messages', async () => {
    const key = `chat-idempotency-${Date.now()}`;
    const payload = { message: 'Remember that I live in Porto' };

    const first = await request(app.getHttpServer())
      .post('/v1/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);

    const second = await request(app.getHttpServer())
      .post('/v1/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);

    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body.conversationId).toBe(first.body.conversationId);
    expect(model.calls).toHaveLength(4);
    expect(
      await prisma.conversationMessage.count({
        where: { conversationId: first.body.conversationId },
      }),
    ).toBe(2);
    expect(await prisma.memory.count({ where: { userId, content: 'I live in Porto' } })).toBe(1);
  });

  it('rejects an idempotency key reused with a different chat request', async () => {
    const key = `chat-idempotency-conflict-${Date.now()}`;
    await request(app.getHttpServer())
      .post('/v1/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', key)
      .send({ message: 'Hello there' })
      .expect(200);

    const conflict = await request(app.getHttpServer())
      .post('/v1/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', key)
      .send({ message: 'Hello again' })
      .expect(409);

    expect(conflict.body.reason).toBe('IDEMPOTENCY_KEY_REUSE');
  });

  it('rejects chat without authentication', async () => {
    await request(app.getHttpServer()).post('/v1/chat').send({ message: 'hello' }).expect(401);
  });
});
