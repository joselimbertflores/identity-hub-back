import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';

import { ApplicationService, AccessService } from '../services';
import { CreateUserWithAccessDto, UpdateUserWithAccessDto } from '../dtos';
import { RequiredRole } from 'src/modules/auth/decorators';
import { UserRole } from 'src/modules/users/entities';

@RequiredRole(UserRole.ADMIN)
@Controller('access')
export class AccessController {
  constructor(
    private assigmentService: AccessService,
    private applicationService: ApplicationService,
  ) {}

  @Get('applications')
  getApplications() {
    return this.applicationService.getAllActive();
  }

  @Post()
  create(@Body() body: CreateUserWithAccessDto) {
    return this.assigmentService.provisionUserWithApplications(body);
  }

  @Put('/:userId')
  update(@Param('userId') userId: string, @Body() body: UpdateUserWithAccessDto) {
    return this.assigmentService.updateUserWithApplications(userId, body);
  }
}
