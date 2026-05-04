import { Controller, Get } from '@nestjs/common';

import { GetAuthUser } from 'src/modules/auth/decorators';
import { User } from 'src/modules/users/entities';
import { AccessPortalService } from '../services';

@Controller('access-portal')
export class AccessPortalController {
  constructor(private accessPortalService: AccessPortalService) {}

  @Get('my-applications')
  getMyApplications(@GetAuthUser() user: User) {
    return this.accessPortalService.getUserApplications(user.id);
  }
}
