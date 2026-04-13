import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities';
import { AccessModule } from '../access/access.module';
import { PrinterModule } from '../printer/printer.module';
import { UserProvisioningService } from './services';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UserProvisioningService],
  imports: [TypeOrmModule.forFeature([User]), AccessModule, PrinterModule],
  exports: [TypeOrmModule, UsersService],
})
export class UsersModule {}
