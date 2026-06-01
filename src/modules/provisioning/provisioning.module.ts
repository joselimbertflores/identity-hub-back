import { Module } from '@nestjs/common';

import { AccessModule } from '../access/access.module';
import { PrinterModule } from '../printer/printer.module';
import { UsersModule } from '../users/users.module';
import { UserProvisioningService } from './services';
import { UserProvisioningController } from './user-provisioning.controller';

@Module({
  controllers: [UserProvisioningController],
  providers: [UserProvisioningService],
  imports: [UsersModule, AccessModule, PrinterModule],
})
export class ProvisioningModule {}
