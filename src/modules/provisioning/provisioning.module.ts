import { Module } from '@nestjs/common';

import { AccessModule } from '../access/access.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail';
import { UsersModule } from '../users/users.module';
import { UserProvisioningService } from './services';
import { UserProvisioningController } from './user-provisioning.controller';

@Module({
  controllers: [UserProvisioningController],
  providers: [UserProvisioningService],
  imports: [UsersModule, AccessModule, AuthModule, MailModule],
})
export class ProvisioningModule {}
