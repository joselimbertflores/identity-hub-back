import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';

import { RequiredRole } from '../auth/decorators';
import { UserRole } from '../users/entities';
import { CreateAdministrativeUserDto, EmployeeSearchQueryDto, UpdateUserWithAccessDto } from './dtos';
import { UserProvisioningService } from './services';
import { RrhhEmployeesService } from './services/rrhh-employees.service';

@RequiredRole(UserRole.ADMIN)
@Controller('users')
export class UserProvisioningController {
  constructor(
    private readonly userProvisioningService: UserProvisioningService,
    private readonly rrhhEmployeesService: RrhhEmployeesService,
  ) {}

  @Get('employees')
  searchEmployees(@Query() query: EmployeeSearchQueryDto) {
    return this.rrhhEmployeesService.search(query);
  }

  @Post('access')
  create(@Body() body: CreateAdministrativeUserDto) {
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

  @Post(':id/password-action/resend')
  resendPasswordAction(@Param('id', ParseUUIDPipe) id: string) {
    return this.userProvisioningService.resendPasswordAction(id);
  }
}
