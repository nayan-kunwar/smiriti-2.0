import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { catchError, from, map, mergeMap, of, throwError } from 'rxjs';
import { ConflictError, UnauthorizedError } from '@smriti/shared';
import type { RequestWithUser } from '../decorators/request-context.decorator.js';
import {
  buildIdempotencyContext,
  IdempotencyService,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  type IdempotencyRequestContext,
} from './idempotency.service.js';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(@Inject(IdempotencyService) private readonly idempotency: IdempotencyService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const response = context.switchToHttp().getResponse<Response>();
    const rawKey = this.idempotency.validateKey(request.headers[IDEMPOTENCY_HEADER]);
    if (!rawKey) return next.handle();

    if (!request.user) {
      throw new UnauthorizedError('Authenticated user not found on request');
    }

    const idempotencyContext = buildIdempotencyContext({
      userId: request.user.userId,
      method: request.method,
      path: request.path,
      query: request.query as Record<string, unknown>,
      body: request.body,
      rawKey,
    });

    const result = await this.idempotency.begin(request.user.userId, idempotencyContext);
    if (result.kind === 'replay') {
      response.status(result.record.responseStatus ?? 200);
      response.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
      return of(result.record.responseSnapshot);
    }
    if (result.kind === 'conflict') {
      const retryAfterSeconds = result.record.lockedUntil
        ? Math.max(1, Math.ceil((result.record.lockedUntil.getTime() - Date.now()) / 1000))
        : undefined;
      throw new ConflictError(
        result.reason === 'request_mismatch'
          ? 'Idempotency-Key was already used with a different request'
          : 'A request with this Idempotency-Key is still in progress',
        {
          reason:
            result.reason === 'request_mismatch'
              ? 'IDEMPOTENCY_KEY_REUSE'
              : 'IDEMPOTENCY_IN_PROGRESS',
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        },
      );
    }

    const { lockToken } = result;
    return next.handle().pipe(
      mergeMap((data) =>
        from(
          this.idempotency.complete(
            idempotencyContext,
            lockToken,
            response.statusCode ?? 200,
            data,
          ),
        ).pipe(
          map(() => data),
          catchError((err) => {
            this.logger.error(
              `Failed to persist idempotency response for ${idempotencyContext.route}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            return of(data);
          }),
        ),
      ),
      catchError((err) =>
        from(this.abort(idempotencyContext, lockToken)).pipe(mergeMap(() => throwError(() => err))),
      ),
    );
  }

  private async abort(
    idempotencyContext: IdempotencyRequestContext,
    lockToken: string,
  ): Promise<void> {
    try {
      await this.idempotency.abort(idempotencyContext, lockToken);
    } catch (err) {
      this.logger.error(
        `Failed to release idempotency reservation for ${idempotencyContext.route}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
