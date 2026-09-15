import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { ApplicationClientAuth, AuthenticatedApplication } from 'src/modules/access/decorators';
import { Application } from 'src/modules/access/entities';
import { RATE_LIMIT_TTL_MS, RATE_LIMITS } from 'src/config/rate-limit.config';

import { LogoutSessionDto } from '../dtos';
import { OAuthService } from '../services';

@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: RATE_LIMIT_TTL_MS, limit: RATE_LIMITS.INTERNAL } })
@ApplicationClientAuth()
@Controller('internal/sessions')
export class InternalSessionController {
  constructor(private readonly oauthService: OAuthService) {}

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@AuthenticatedApplication() application: Application, @Body() body: LogoutSessionDto) {
    return this.oauthService.logoutBySid(body.sid, application.clientId);
  }
}
