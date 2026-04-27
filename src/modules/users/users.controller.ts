import { Get, Query, Controller, Post, Body, Param, Patch } from '@nestjs/common';

import { RequiredRole } from '../auth/decorators';
import { PaginationParamsDto } from '../common';
import { UsersService } from './services/users.service';

import { CreateUserWithAccessDto, UpdateUserWithAccessDto } from '../access/dtos';
import { UserProvisioningService } from './services';
import { UserRole } from './entities';

@RequiredRole(UserRole.ADMIN)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly userProvisioningService: UserProvisioningService,
  ) {}

  @Get()
  findAll(@Query() paginationParams: PaginationParamsDto) {
    return this.usersService.findAll(paginationParams);
  }

  @Post()
  create(@Body() body: CreateUserWithAccessDto) {
    return this.userProvisioningService.provisionUserWithApplications(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateUserWithAccessDto) {
    return this.userProvisioningService.updateUserWithApplications(id, body);
  }

  @Post(':id/reset-credentials')
  resetCredentials(@Param('id') id: string) {
    return this.userProvisioningService.resetTemporaryCredentials(id);
  }
  
}
