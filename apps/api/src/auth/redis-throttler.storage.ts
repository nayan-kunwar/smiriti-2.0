import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly client: Redis | null;
  private readonly memory = new Map<string, { totalHits: number; expiresAt: number }>();

  constructor(redisUrl: string) {
    if (process.env.NODE_ENV === 'test') {
      this.client = null;
      return;
    }

    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    this.client.connect().catch(() => {
      // Fall back to in-memory storage when Redis is unavailable.
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    void blockDuration;
    void throttlerName;

    if (this.client?.status === 'ready') {
      try {
        const totalHits = await this.client.incr(key);
        if (totalHits === 1) {
          await this.client.pexpire(key, ttl);
        }
        const timeToExpire = await this.client.pttl(key);
        return {
          totalHits,
          timeToExpire: Math.max(timeToExpire, 0),
          isBlocked: totalHits > limit,
          timeToBlockExpire: 0,
        };
      } catch {
        // Fall through to in-memory storage.
      }
    }

    const now = Date.now();
    const existing = this.memory.get(key);
    if (!existing || existing.expiresAt <= now) {
      this.memory.set(key, { totalHits: 1, expiresAt: now + ttl });
      return {
        totalHits: 1,
        timeToExpire: ttl,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    existing.totalHits += 1;
    return {
      totalHits: existing.totalHits,
      timeToExpire: existing.expiresAt - now,
      isBlocked: existing.totalHits > limit,
      timeToBlockExpire: 0,
    };
  }
}
