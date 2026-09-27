import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { UserRole } from '@smriti/domain';

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  authMethod: 'jwt' | 'api_key';
}

export type RequestWithUser = Request & {
  user?: AuthenticatedUser;
  correlationId?: string;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new Error('Authenticated user not found on request');
    }
    return request.user;
  },
);

export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new Error('Authenticated user not found on request');
    }
    return request.user.userId;
  },
);

export const CorrelationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return (
      request.correlationId ??
      (request.headers['x-correlation-id'] as string | undefined) ??
      'unknown'
    );
  },
);
