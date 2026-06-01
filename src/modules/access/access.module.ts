import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApplicationController, AccessPortalController } from './controllers';
import {
  UserApplicationsService,
  ApplicationService,
  AccessPortalService,
  ApplicationClientAuthService,
} from './services';
import { ApplicationClientAuthGuard } from './guards';
import { Application } from './entities';

@Module({
  controllers: [ApplicationController, AccessPortalController],
  providers: [
    ApplicationService,
    UserApplicationsService,
    AccessPortalService,
    ApplicationClientAuthService,
    ApplicationClientAuthGuard,
  ],
  imports: [TypeOrmModule.forFeature([Application])],
  exports: [TypeOrmModule, UserApplicationsService, ApplicationClientAuthService, ApplicationClientAuthGuard],
})
export class AccessModule {}
