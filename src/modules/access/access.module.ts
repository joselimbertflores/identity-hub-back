import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApplicationController, AccessPortalController } from './controllers';
import { UserApplicationsService, ApplicationService, AccessPortalService } from './services';
import { Application } from './entities';

@Module({
  controllers: [ApplicationController, AccessPortalController],
  providers: [ApplicationService, UserApplicationsService, AccessPortalService],
  imports: [TypeOrmModule.forFeature([Application])],
  exports: [TypeOrmModule, UserApplicationsService],
})
export class AccessModule {}
