import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedError } from '@smriti/shared';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type {
  AuthenticatedUser,
  RequestWithUser,
} from '../../common/decorators/request-context.decorator.js';
import { AuthService } from '../auth.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = await this.authenticate(request);
    request.user = user;
    return true;
  }

  private async authenticate(request: Request): Promise<AuthenticatedUser> {
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
    const authorization = request.headers.authorization;

    if (apiKeyHeader) {
      return this.wrapAuth(() => this.authService.authenticateApiKey(apiKeyHeader));
    }

    if (authorization?.startsWith('Bearer ')) {
      const token = authorization.slice('Bearer '.length).trim();
      if (token.startsWith('smriti_')) {
        return this.wrapAuth(() => this.authService.authenticateApiKey(token));
      }
      return this.authenticateJwt(token);
    }

    throw new UnauthorizedException('Authentication required');
  }

  private async wrapAuth(fn: () => Promise<AuthenticatedUser>): Promise<AuthenticatedUser> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }

  private authenticateJwt(token: string): AuthenticatedUser {
    try {
      const payload = this.jwtService.verify<{ sub: string; role: 'user' | 'admin' }>(token);
      return {
        userId: payload.sub,
        role: payload.role,
        authMethod: 'jwt',
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
