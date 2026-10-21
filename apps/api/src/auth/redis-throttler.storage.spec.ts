import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

describe('RedisThrottlerStorage (in-memory test mode)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports rates in seconds and blocks requests over the limit', async () => {
    const storage = new RedisThrottlerStorage('redis://localhost:6379');

    const first = await storage.increment('key', 60_000, 2, 60_000, 'default');
    const second = await storage.increment('key', 60_000, 2, 60_000, 'default');
    const blocked = await storage.increment('key', 60_000, 2, 60_000, 'default');

    expect(first).toMatchObject({
      totalHits: 1,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(first.timeToExpire).toBeGreaterThan(0);
    expect(first.timeToExpire).toBeLessThanOrEqual(60);
    expect(second).toMatchObject({ totalHits: 2, isBlocked: false });
    expect(blocked).toMatchObject({
      totalHits: 3,
      isBlocked: true,
      timeToBlockExpire: blocked.timeToExpire,
    });
    expect(blocked.timeToBlockExpire).toBeGreaterThanOrEqual(1);
  });

  it('resets a key after its window expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T00:00:00.000Z'));
    const storage = new RedisThrottlerStorage('redis://localhost:6379');

    await storage.increment('key', 1_000, 1, 1_000, 'default');
    const blocked = await storage.increment('key', 1_000, 1, 1_000, 'default');
    expect(blocked.isBlocked).toBe(true);

    vi.advanceTimersByTime(1_001);
    const reset = await storage.increment('key', 1_000, 1, 1_000, 'default');

    expect(reset).toMatchObject({ totalHits: 1, isBlocked: false });
  });
});
