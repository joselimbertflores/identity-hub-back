import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccessModule } from '../access/access.module';
import { InternalUsersDirectoryController } from './internal-users-directory.controller';
import { UsersController } from './users.controller';
import { UsersDirectoryService, UsersService } from './services';
import { User } from './entities';

@Module({
  controllers: [UsersController, InternalUsersDirectoryController],
  providers: [UsersService, UsersDirectoryService],
  imports: [TypeOrmModule.forFeature([User]), AccessModule],
  exports: [TypeOrmModule, UsersService],
})
export class UsersModule {}
