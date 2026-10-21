import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

function secondsUntil(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

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
        const pttl = await this.client.pttl(key);
        const remainingMs = pttl > 0 ? pttl : ttl;
        const timeToExpire = secondsUntil(remainingMs);
        const isBlocked = totalHits > limit;
        return {
          totalHits,
          timeToExpire,
          isBlocked,
          timeToBlockExpire: isBlocked ? timeToExpire : 0,
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
        timeToExpire: secondsUntil(ttl),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    existing.totalHits += 1;
    const timeToExpire = secondsUntil(existing.expiresAt - now);
    const isBlocked = existing.totalHits > limit;
    return {
      totalHits: existing.totalHits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? timeToExpire : 0,
    };
  }
}
