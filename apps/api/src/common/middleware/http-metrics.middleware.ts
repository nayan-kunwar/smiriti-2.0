import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { Metrics } from '@smriti/infrastructure';
import type { NextFunction, Request, Response } from 'express';
import { METRICS } from '../../metrics/metrics.constants.js';

type RouteAwareRequest = Request & {
  route?: {
    path?: unknown;
  };
};

function routeLabel(request: RouteAwareRequest): string {
  const routePath = request.route?.path;
  if (typeof routePath !== 'string') return 'unmatched';
  return `${request.baseUrl}${routePath}` || 'unmatched';
}

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(@Inject(METRICS) private readonly metrics: Metrics) {}

  use(request: RouteAwareRequest, response: Response, next: NextFunction): void {
    if (request.path === '/metrics') {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    response.once('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      this.metrics.observeHttp(
        request.method,
        routeLabel(request),
        response.statusCode,
        durationSeconds,
      );
    });
    next();
  }
}
