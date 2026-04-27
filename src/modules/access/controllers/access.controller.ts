import { Controller, Get } from '@nestjs/common';

import { ApplicationService } from '../services';
import { RequiredRole } from 'src/modules/auth/decorators';
import { UserRole } from 'src/modules/users/entities';

@RequiredRole(UserRole.ADMIN)
@Controller('access')
export class AccessController {
  constructor(private applicationService: ApplicationService) {}

  @Get('applications')
  getApplications() {
    return this.applicationService.getAllActive();
  }
}
