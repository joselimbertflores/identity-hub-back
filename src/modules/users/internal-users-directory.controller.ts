import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { ApplicationClientAuth, AuthenticatedApplication } from '../access/decorators';
import { Application } from '../access/entities';
import { AssignableUserQueryDto } from './dtos';
import { UsersDirectoryService } from './services';
import { RATE_LIMIT_TTL_MS, RATE_LIMITS } from 'src/config/rate-limit.config';

@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: RATE_LIMIT_TTL_MS, limit: RATE_LIMITS.INTERNAL } })
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
