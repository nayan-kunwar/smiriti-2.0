import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@smriti/shared';
import { InMemoryIdempotencyStore } from '@smriti/infrastructure';
import { IdempotencyService, buildIdempotencyContext } from './idempotency.service.js';

const config = {
  IDEMPOTENCY_TTL_HOURS: 24,
  IDEMPOTENCY_LOCK_TIMEOUT_MS: 30_000,
} as AppConfig;

describe('IdempotencyService', () => {
  it('builds a stable request hash independent of body key order', () => {
    const base = {
      userId: 'user-1',
      method: 'POST',
      path: '/v1/memories',
      query: { force: 'true' },
      rawKey: 'request-1',
    };

    const first = buildIdempotencyContext({ ...base, body: { type: 'long_term', content: 'x' } });
    const second = buildIdempotencyContext({ ...base, body: { content: 'x', type: 'long_term' } });

    expect(first.key).toBe(second.key);
    expect(first.requestHash).toBe(second.requestHash);
  });

  it('replays completed responses and rejects a changed payload', async () => {
    const store = new InMemoryIdempotencyStore();
    const service = new IdempotencyService(store, config);
    const context = buildIdempotencyContext({
      userId: 'user-1',
      method: 'POST',
      path: '/v1/memories',
      query: {},
      body: { content: 'original' },
      rawKey: 'request-1',
    });

    const acquired = await service.begin('user-1', context);
    expect(acquired.kind).toBe('acquired');
    if (acquired.kind !== 'acquired') throw new Error('expected acquired reservation');
    await service.complete(context, acquired.lockToken, 201, { id: 'memory-1' });

    const replay = await service.begin('user-1', context);
    expect(replay.kind).toBe('replay');
    if (replay.kind === 'replay') {
      expect(replay.record.responseStatus).toBe(201);
      expect(replay.record.responseSnapshot).toEqual({ id: 'memory-1' });
    }

    const changed = buildIdempotencyContext({
      userId: 'user-1',
      method: 'POST',
      path: '/v1/memories',
      query: {},
      body: { content: 'changed' },
      rawKey: 'request-1',
    });
    const conflict = await service.begin('user-1', changed);
    expect(conflict.kind).toBe('conflict');
    if (conflict.kind === 'conflict') {
      expect(conflict.reason).toBe('request_mismatch');
    }
  });

  it('reports an in-progress reservation and releases it on abort', async () => {
    const store = new InMemoryIdempotencyStore();
    const service = new IdempotencyService(store, config);
    const context = buildIdempotencyContext({
      userId: 'user-1',
      method: 'POST',
      path: '/v1/chat',
      query: {},
      body: { message: 'hello' },
      rawKey: 'request-2',
    });

    const acquired = await service.begin('user-1', context);
    expect(acquired.kind).toBe('acquired');
    if (acquired.kind !== 'acquired') throw new Error('expected acquired reservation');

    const inProgress = await service.begin('user-1', context);
    expect(inProgress.kind).toBe('conflict');
    if (inProgress.kind === 'conflict') {
      expect(inProgress.reason).toBe('in_progress');
    }

    await service.abort(context, acquired.lockToken);
    expect(await service.begin('user-1', context)).toMatchObject({ kind: 'acquired' });
  });

  it('takes over an expired reservation and ignores a stale abort', async () => {
    const store = new InMemoryIdempotencyStore();
    const service = new IdempotencyService(store, config);
    const context = buildIdempotencyContext({
      userId: 'user-1',
      method: 'POST',
      path: '/v1/memories',
      query: {},
      body: { content: 'expired' },
      rawKey: 'request-3',
    });

    const first = await service.begin('user-1', context);
    expect(first.kind).toBe('acquired');
    if (first.kind !== 'acquired') throw new Error('expected acquired reservation');

    const record = store.records.get(context.key);
    if (!record) throw new Error('expected stored reservation');
    record.expiresAt = new Date(Date.now() - 1_000);

    const takeover = await service.begin('user-1', context);
    expect(takeover.kind).toBe('acquired');
    if (takeover.kind !== 'acquired') throw new Error('expected takeover reservation');
    expect(takeover.lockToken).not.toBe(first.lockToken);

    await service.abort(context, first.lockToken);
    expect((await service.begin('user-1', context)).kind).toBe('conflict');
  });

  it('validates header values', () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore(), config);
    expect(service.validateKey(undefined)).toBeNull();
    expect(service.validateKey('  key  ')).toBe('key');
    expect(() => service.validateKey('')).toThrow('must not be empty');
    expect(() => service.validateKey('x'.repeat(256))).toThrow('at most 255');
  });
});
