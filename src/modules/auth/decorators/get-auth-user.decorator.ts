import { ExecutionContext, createParamDecorator, InternalServerErrorException } from '@nestjs/common';
import type { Request } from 'express';
import { User } from 'src/modules/users/entities';

export const GetAuthUser = createParamDecorator((propertiePath: keyof User, ctx: ExecutionContext) => {
  const req: Request = ctx.switchToHttp().getRequest();
  const user = req['user'] as User | undefined;
  if (!user) {
    throw new InternalServerErrorException('User not found in request');
  }
  return propertiePath ? user[propertiePath] : user;
});
