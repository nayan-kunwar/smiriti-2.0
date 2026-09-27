import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@smriti/domain';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { RequestWithUser } from '../../common/decorators/request-context.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user || !requiredRoles.includes(request.user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
