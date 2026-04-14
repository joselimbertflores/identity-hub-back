import { ExecutionContext, createParamDecorator, InternalServerErrorException } from '@nestjs/common';
import type { Request } from 'express';

import { AuthUser } from '../interfaces';

export const GetAuthUser = createParamDecorator((propertyPath: keyof AuthUser, ctx: ExecutionContext) => {
  const req: Request = ctx.switchToHttp().getRequest();
  const user = req['user'] as AuthUser | undefined;
  if (!user) {
    throw new InternalServerErrorException('User not found in request');
  }
  return propertyPath ? user[propertyPath] : user;
});
