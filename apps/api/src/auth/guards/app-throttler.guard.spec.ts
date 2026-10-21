import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ThrottlerLimitDetail, ThrottlerStorage } from '@nestjs/throttler';
import type { RequestWithUser } from '../../common/decorators/request-context.decorator.js';
import { AppThrottlerGuard } from './app-throttler.guard.js';
import { isExpensiveThrottleRoute } from '../throttle-policy.js';

const storage = {
  increment: async () => ({
    totalHits: 1,
    timeToExpire: 60,
    isBlocked: false,
    timeToBlockExpire: 0,
  }),
} satisfies ThrottlerStorage;

class TestAppThrottlerGuard extends AppThrottlerGuard {
  tracker(request: RequestWithUser): Promise<string> {
    return this.getTracker(request);
  }

  throttle(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    return this.throwThrottlingException(context, detail);
  }
}

function guard(): TestAppThrottlerGuard {
  return new TestAppThrottlerGuard([], storage, new Reflector());
}

function request(overrides: Partial<RequestWithUser> = {}): RequestWithUser {
  return {
    ip: '203.0.113.10',
    ...overrides,
  } as RequestWithUser;
}

describe('AppThrottlerGuard', () => {
  it('keys authenticated JWT requests by user', async () => {
    const tracker = await guard().tracker(
      request({
        user: { userId: 'user-1', role: 'user', authMethod: 'jwt' },
      }),
    );

    expect(tracker).toBe('user:user-1');
  });

  it('keys API-key requests by key id', async () => {
    const tracker = await guard().tracker(
      request({
        user: {
          userId: 'user-1',
          role: 'user',
          authMethod: 'api_key',
          apiKeyId: 'key-1',
        },
      }),
    );

    expect(tracker).toBe('api-key:key-1');
  });

  it('falls back to IP for public or unauthenticated requests', async () => {
    expect(await guard().tracker(request())).toBe('ip:203.0.113.10');
  });

  it('returns a typed 429 body with a retry delay', async () => {
    const detail: ThrottlerLimitDetail = {
      totalHits: 3,
      timeToExpire: 42,
      isBlocked: true,
      timeToBlockExpire: 42,
      ttl: 60_000,
      limit: 2,
      key: 'key',
      tracker: 'user:user-1',
    };

    let caught: unknown;
    try {
      await guard().throttle({} as ExecutionContext, detail);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    const exception = caught as HttpException;
    expect(exception.getStatus()).toBe(429);
    expect(exception.getResponse()).toMatchObject({
      statusCode: 429,
      message: 'Rate limit exceeded',
      reason: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds: 42,
    });
  });
});

describe('isExpensiveThrottleRoute', () => {
  function context(path: string, routePath?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          path,
          baseUrl: '',
          route: routePath ? { path: routePath } : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('matches chat and semantic search', () => {
    expect(isExpensiveThrottleRoute(context('/v1/chat', '/v1/chat'))).toBe(true);
    expect(isExpensiveThrottleRoute(context('/v1/memories/search', '/v1/memories/search'))).toBe(
      true,
    );
    expect(isExpensiveThrottleRoute(context('/v1/chat/'))).toBe(true);
  });

  it('does not match ordinary memory routes', () => {
    expect(isExpensiveThrottleRoute(context('/v1/memories', '/v1/memories'))).toBe(false);
    expect(isExpensiveThrottleRoute(context('/v1/memories/memory-1'))).toBe(false);
  });
});
