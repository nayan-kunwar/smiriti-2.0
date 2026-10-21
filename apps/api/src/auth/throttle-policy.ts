import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

type RouteAwareRequest = Request & {
  route?: {
    path?: unknown;
  };
};

const EXPENSIVE_ROUTES = new Set(['/v1/chat', '/v1/memories/search']);

/**
 * The expensive throttler applies only to synchronous, provider-backed work.
 * Using the matched route template keeps this independent of query strings.
 */
export function isExpensiveThrottleRoute(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<RouteAwareRequest>();
  const routePath = request.route?.path;
  const path =
    typeof routePath === 'string' ? `${request.baseUrl ?? ''}${routePath}` : request.path;

  return EXPENSIVE_ROUTES.has(path.length > 1 ? path.replace(/\/+$/, '') : path);
}
