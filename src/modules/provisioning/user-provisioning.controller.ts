import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';

import { RequiredRole } from '../auth/decorators';
import { UserRole } from '../users/entities';
import { CreateUserWithAccessDto, UpdateUserWithAccessDto } from './dtos';
import { UserProvisioningService } from './services';

@RequiredRole(UserRole.ADMIN)
@Controller('users')
export class UserProvisioningController {
  constructor(private readonly userProvisioningService: UserProvisioningService) {}

  @Post("access")
  create(@Body() body: CreateUserWithAccessDto) {
    return this.userProvisioningService.provisionUserWithApplications(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateUserWithAccessDto) {
    return this.userProvisioningService.updateUserWithApplications(id, body);
  }

  @Post(':id/password-reset')
  resetPassword(@Param('id', ParseUUIDPipe) id: string) {
    return this.userProvisioningService.resetPassword(id);
  }

  @Post(':id/password-action/regenerate')
  regeneratePasswordAction(@Param('id', ParseUUIDPipe) id: string) {
    return this.userProvisioningService.regeneratePasswordAction(id);
  }
}
