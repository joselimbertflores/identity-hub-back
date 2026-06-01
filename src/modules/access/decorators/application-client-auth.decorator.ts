import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import { IS_APPLICATION_CLIENT_AUTH_KEY } from '../../common';
import { ApplicationClientAuthGuard } from '../guards';

export const ApplicationClientAuth = () =>
  applyDecorators(SetMetadata(IS_APPLICATION_CLIENT_AUTH_KEY, true), UseGuards(ApplicationClientAuthGuard));
