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

    expect(response.body.turnId).toBeTruthy();
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

    const storedMessages = await prisma.conversationMessage.findMany({
      where: { conversationId: response.body.conversationId },
    });
    expect(storedMessages).toHaveLength(2);
    expect(storedMessages.every((message) => message.turnId === response.body.turnId)).toBe(true);

    const memory = await prisma.memory.findFirst({
      where: { userId, content: 'I live in Lisbon' },
    });
    expect(memory).not.toBeNull();
    expect(memory?.turnId).toBe(response.body.turnId);

    const turn = await request(app.getHttpServer())
      .get(`/v1/chat/turns/${response.body.turnId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(turn.body).toMatchObject({
      turnId: response.body.turnId,
      conversationId: response.body.conversationId,
      status: 'completed',
      attempts: 1,
      error: null,
    });
    expect(turn.body.result.message).toBe(response.body.message);

    // Retrying a completed turn replays its stored result instead of re-running
    // the graph.
    const callsBefore = model.calls.length;
    const replayed = await request(app.getHttpServer())
      .post(`/v1/chat/turns/${response.body.turnId}/retry`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(replayed.body.turnId).toBe(response.body.turnId);
    expect(replayed.body.message).toBe(response.body.message);
    expect(model.calls).toHaveLength(callsBefore);
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
    expect(second.body.turnId).toBe(first.body.turnId);
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

  it('returns a failed turn with its turnId and retries it exactly once', async () => {
    const message = 'Remember that I live in Braga';

    // No scripted responses remain, so the graph fails after the user message
    // has been persisted.
    const failed = await request(app.getHttpServer())
      .post('/v1/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message })
      .expect(500);

    expect(failed.body).toMatchObject({
      code: 'CHAT_TURN_FAILED',
      retryable: true,
      conversationId: expect.any(String),
      turnId: expect.any(String),
    });

    const failedStatus = await request(app.getHttpServer())
      .get(`/v1/chat/turns/${failed.body.turnId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(failedStatus.body).toMatchObject({
      turnId: failed.body.turnId,
      conversationId: failed.body.conversationId,
      status: 'failed',
      attempts: 1,
      result: null,
    });
    expect(failedStatus.body.error.code).toBeTruthy();

    const before = await prisma.conversationMessage.findMany({
      where: { conversationId: failed.body.conversationId },
    });
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ role: 'user', turnId: failed.body.turnId });

    model.push(
      '{"intent":"remember","memories":[{"content":"I live in Braga","type":"long_term","confidence":0.95}]}',
      'Noted — you live in Braga.',
    );

    const retried = await request(app.getHttpServer())
      .post(`/v1/chat/turns/${failed.body.turnId}/retry`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(retried.body.turnId).toBe(failed.body.turnId);
    expect(retried.body.conversationId).toBe(failed.body.conversationId);
    expect(retried.body.message).toContain('Braga');

    const completedStatus = await request(app.getHttpServer())
      .get(`/v1/chat/turns/${failed.body.turnId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(completedStatus.body).toMatchObject({
      status: 'completed',
      attempts: 2,
      error: null,
    });
    expect(completedStatus.body.result.message).toBe(retried.body.message);

    const after = await prisma.conversationMessage.findMany({
      where: { conversationId: failed.body.conversationId },
    });
    expect(after.map((entry) => entry.role)).toEqual(['user', 'assistant']);
    expect(after.every((entry) => entry.turnId === failed.body.turnId)).toBe(true);
    expect(await prisma.memory.count({ where: { userId, turnId: failed.body.turnId } })).toBe(1);

    const retryAudit = await prisma.auditLog.findFirst({
      where: { userId, action: 'chat.turn.retry', entityId: failed.body.turnId },
    });
    expect(retryAudit).not.toBeNull();
  });

  it('auto-resumes a failed turn when the same Idempotency-Key is reused', async () => {
    const key = `chat-turn-resume-${Date.now()}`;
    const payload = { message: 'Remember that I live in Faro' };

    const failed = await request(app.getHttpServer())
      .post('/v1/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(500);
    expect(failed.body.code).toBe('CHAT_TURN_FAILED');

    model.push(
      '{"intent":"remember","memories":[{"content":"I live in Faro","type":"long_term","confidence":0.95}]}',
      'Noted — you live in Faro.',
    );
    const conversationsBeforeResume = await prisma.conversation.count({ where: { userId } });

    const resumed = await request(app.getHttpServer())
      .post('/v1/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);

    expect(resumed.body.turnId).toBe(failed.body.turnId);
    expect(resumed.body.conversationId).toBe(failed.body.conversationId);
    expect(resumed.body.message).toContain('Faro');
    expect(await prisma.conversation.count({ where: { userId } })).toBe(conversationsBeforeResume);

    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId: failed.body.conversationId },
    });
    expect(messages.map((entry) => entry.role)).toEqual(['user', 'assistant']);
    expect(messages.every((entry) => entry.turnId === failed.body.turnId)).toBe(true);

    const turn = await prisma.chatTurn.findUniqueOrThrow({ where: { id: failed.body.turnId } });
    expect(turn.status).toBe('completed');
    expect(turn.attempts).toBe(2);
    expect(await prisma.memory.count({ where: { userId, turnId: failed.body.turnId } })).toBe(1);
  });

  it('rejects chat without authentication', async () => {
    await request(app.getHttpServer()).post('/v1/chat').send({ message: 'hello' }).expect(401);
  });
});
