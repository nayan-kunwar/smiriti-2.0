import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { BeginIdempotencyResult, IdempotencyStore } from '@smriti/domain';
import { ValidationError, type AppConfig } from '@smriti/shared';
import { APP_CONFIG } from '../../config/config.module.js';
import { IDEMPOTENCY_STORE } from './idempotency.constants.js';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_REPLAYED_HEADER = 'idempotency-replayed';
const MAX_KEY_LENGTH = 255;

export interface IdempotencyRequestContext {
  key: string;
  route: string;
  requestHash: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * JSON.stringify with sorted object keys so equivalent parsed JSON bodies hash
 * consistently even when key order differs.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const object = value as Record<string, unknown>;
  const keys = Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

function normalizeQuery(query: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    normalized[key] = Array.isArray(value) ? value.map(String) : value;
  }
  return normalized;
}

export function buildIdempotencyContext(input: {
  userId: string;
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: unknown;
  rawKey: string;
}): IdempotencyRequestContext {
  const route = `${input.method.toUpperCase()} ${input.path}`;
  const scopedKey = sha256(`${input.userId}\u0000${route}\u0000${input.rawKey}`);
  const requestHash = sha256(
    stableStringify({
      method: input.method.toUpperCase(),
      path: input.path,
      query: normalizeQuery(input.query),
      body: input.body,
    }),
  );
  return { key: scopedKey, route, requestHash };
}

@Injectable()
export class IdempotencyService {
  private readonly ttlMs: number;
  private readonly lockMs: number;

  constructor(
    @Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.ttlMs = config.IDEMPOTENCY_TTL_HOURS * 60 * 60_000;
    this.lockMs = config.IDEMPOTENCY_LOCK_TIMEOUT_MS;
  }

  validateKey(rawKey: string | string[] | undefined): string | null {
    if (rawKey === undefined) return null;
    if (typeof rawKey !== 'string') {
      throw new ValidationError('Idempotency-Key must be a single header value');
    }
    const key = rawKey.trim();
    if (key.length === 0) {
      throw new ValidationError('Idempotency-Key must not be empty');
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new ValidationError(`Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters`);
    }
    return key;
  }

  begin(userId: string, context: IdempotencyRequestContext): Promise<BeginIdempotencyResult> {
    const now = Date.now();
    return this.store.begin({
      key: context.key,
      userId,
      requestHash: context.requestHash,
      lockToken: randomUUID(),
      expiresAt: new Date(now + this.ttlMs),
      lockedUntil: new Date(now + this.lockMs),
    });
  }

  complete(
    context: IdempotencyRequestContext,
    lockToken: string,
    responseStatus: number,
    responseSnapshot: unknown,
  ): Promise<void> {
    return this.store.complete({
      key: context.key,
      requestHash: context.requestHash,
      lockToken,
      responseStatus,
      responseSnapshot,
    });
  }

  abort(context: IdempotencyRequestContext, lockToken: string): Promise<void> {
    return this.store.abort(context.key, context.requestHash, lockToken);
  }

  deleteExpired(): Promise<number> {
    return this.store.deleteExpired(new Date());
  }
}
