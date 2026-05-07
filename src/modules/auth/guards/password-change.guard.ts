import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ALLOW_PASSWORD_CHANGE_KEY, IS_PUBLIC_KEY } from '../decorators';
import { AuthUser } from '../interfaces';

@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

    if (isPublic) return true;

    const allowWhenPasswordChange = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<Request>();
    const user = req['user'] as AuthUser | undefined;

    if (!user) return false;

    if (!user.mustChangePassword) return true;

    if (allowWhenPasswordChange) return true;

    throw new ForbiddenException('Password change required');
  }
}
