import { Controller, Get } from '@nestjs/common';

import { GetAuthUser } from 'src/modules/auth/decorators';
import type { AuthUser } from 'src/modules/auth/interfaces';
import { AccessPortalService } from '../services';

@Controller('access-portal')
export class AccessPortalController {
  constructor(private accessPortalService: AccessPortalService) {}

  @Get('my-applications')
  getMyApplications(@GetAuthUser() user: AuthUser) {
    return this.accessPortalService.getUserApplications(user.id);
  }
}
