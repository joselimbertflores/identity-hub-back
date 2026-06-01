import { Controller, Get, Param, Query } from '@nestjs/common';

import { ApplicationClientAuth, AuthenticatedApplication } from '../access/decorators';
import { Application } from '../access/entities';
import { AssignableUserQueryDto } from './dtos';
import { UsersDirectoryService } from './services';

@ApplicationClientAuth()
@Controller('internal/users')
export class InternalUsersDirectoryController {
  constructor(private readonly usersDirectoryService: UsersDirectoryService) {}

  @Get('assignable')
  findAssignableUsers(@AuthenticatedApplication() application: Application, @Query() query: AssignableUserQueryDto) {
    return this.usersDirectoryService.findAssignableUsers(application.id, query);
  }

  @Get('assignable/:externalKey')
  findAssignableUserByExternalKey(
    @AuthenticatedApplication() application: Application,
    @Param('externalKey') externalKey: string,
  ) {
    return this.usersDirectoryService.findAssignableUserByExternalKey(application.id, externalKey);
  }
}
