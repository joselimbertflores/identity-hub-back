import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccessController, ClientController, HubController } from './controllers';
import { AccessService, ApplicationService, HubService } from './services';
import { Application, UserApplication } from './entities';
import { UsersModule } from '../users/users.module';

@Module({
  controllers: [AccessController, ClientController, HubController],
  providers: [ApplicationService, AccessService, HubService],
  imports: [UsersModule, TypeOrmModule.forFeature([Application, UserApplication])],
  exports: [TypeOrmModule],
})
export class AccessModule {}
