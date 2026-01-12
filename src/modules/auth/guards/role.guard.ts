import { CanActivate, ExecutionContext, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Request } from 'express';

import { User, UserRole } from 'src/modules/users/entities';
import { REQUIRED_ROLE } from '../decorators';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const requiredRole = this.reflector.getAllAndOverride<UserRole>(REQUIRED_ROLE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRole) return true;

    const req: Request = context.switchToHttp().getRequest();
    const user = req['user'] as User | undefined;

    if (!user) throw new InternalServerErrorException('User is not authenticated');

    return user.roles.includes(requiredRole);
  }
}
