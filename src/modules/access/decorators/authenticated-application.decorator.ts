import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';

import { ApplicationClientRequest } from '../interfaces';

export const AuthenticatedApplication = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const application = ctx.switchToHttp().getRequest<ApplicationClientRequest>().application;

  if (!application) {
    throw new InternalServerErrorException('Application client is not authenticated');
  }

  return application;
});
