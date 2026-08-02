import { Injectable, Logger } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { CreateUserWithAccessDto, UpdateUserWithAccessDto } from '../dtos';
import { UserApplicationsService } from '../../access/services';
import { UsersService } from '../../users/services/users.service';
import { PasswordActionPurpose } from '../../auth/entities';
import type { IssuedPasswordAction, PasswordActionDelivery } from '../../auth/interfaces';
import { MailService, PasswordActionService, TokenService } from '../../auth/services';
import type { User } from '../../users/entities';

@Injectable()
export class UserProvisioningService {
  private readonly logger = new Logger(UserProvisioningService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly userApplicationsService: UserApplicationsService,
    private readonly passwordActionService: PasswordActionService,
    private readonly tokenService: TokenService,
    private readonly mailService: MailService,
  ) {}

  async provisionUserWithApplications(dto: CreateUserWithAccessDto) {
    const { applicationIds, ...userDto } = dto;
    const passwordHash = await this.usersService.prepareUnknownPasswordHash();
    const result = await this.dataSource.transaction(async (manager) => {
      const user = await this.usersService.create(userDto, passwordHash, manager);
      await this.userApplicationsService.syncApplications(user.id, applicationIds, manager);
      const action = await this.passwordActionService.issue(user.id, PasswordActionPurpose.INITIAL_SETUP, manager);
      return { userId: user.id, action };
    });

    const user = await this.usersService.findOneWithApplications(result.userId);
    const passwordAction = await this.deliverPasswordAction(user, result.action);

    return { user, passwordAction };
  }

  async updateUserWithApplications(id: string, dto: UpdateUserWithAccessDto) {
    const { applicationIds, ...userDto } = dto;
    const user = await this.dataSource.transaction(async (manager) => {
      const user = await this.usersService.update(id, userDto, manager);
      if (applicationIds !== undefined) {
        await this.userApplicationsService.syncApplications(user.id, applicationIds, manager);
      }
      return this.usersService.findOneWithApplications(user.id, manager);
    });
    return { user };
  }

  async resetPassword(id: string) {
    const passwordHash = await this.usersService.prepareUnknownPasswordHash();
    const result = await this.dataSource.transaction(async (manager) => {
      const user = await this.usersService.setUnknownPasswordForReset(id, passwordHash, manager);
      const action = await this.passwordActionService.issue(user.id, PasswordActionPurpose.PASSWORD_RESET, manager);
      return { user, action };
    });

    await this.tokenService.revokeAllForUserBestEffort(result.user.id);
    const passwordAction = await this.deliverPasswordAction(result.user, result.action);

    return {
      message: 'Password reset created successfully',
      passwordAction,
    };
  }

  async regeneratePasswordAction(id: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const user = await this.usersService.findOneWithApplications(id, manager);
      const action = await this.passwordActionService.regenerate(user.id, manager);
      return { user, action };
    });

    const passwordAction = await this.deliverPasswordAction(result.user, result.action);
    return {
      message: 'Password action regenerated successfully',
      passwordAction,
    };
  }

  private async deliverPasswordAction(
    user: Pick<User, 'email' | 'fullName'>,
    action: IssuedPasswordAction,
  ): Promise<PasswordActionDelivery> {
    const expiresAt = action.expiresAt.toISOString();

    if (!user.email) {
      return {
        method: 'MANUAL',
        code: action.code,
        actionUrl: action.actionUrl,
        expiresAt,
      };
    }

    try {
      await this.mailService.sendPasswordAction(user, action);
      return { method: 'EMAIL', status: 'SENT', expiresAt };
    } catch {
      this.logger.warn('Password action email delivery failed; manual fallback returned');
      return {
        method: 'EMAIL',
        status: 'FAILED',
        expiresAt,
        fallback: {
          code: action.code,
          actionUrl: action.actionUrl,
        },
      };
    }
  }
}
