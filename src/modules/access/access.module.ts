import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccessController, ClientController, HubController } from './controllers';
import { AccessService, ApplicationService, HubService } from './services';
import { Application, UserApplication } from './entities';

@Module({
  controllers: [AccessController, ClientController, HubController],
  providers: [ApplicationService, AccessService, HubService],
  imports: [TypeOrmModule.forFeature([Application, UserApplication])],
  exports: [TypeOrmModule, AccessService],
})
export class AccessModule {}
