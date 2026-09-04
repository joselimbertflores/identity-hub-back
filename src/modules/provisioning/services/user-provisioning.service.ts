import { Injectable, Logger } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { CreateUserWithAccessDto, UpdateUserWithAccessDto } from '../dtos';
import { UserApplicationsService } from '../../access/services';
import { UsersService } from '../../users/services/users.service';
import { PasswordActionPurpose } from '../../auth/entities';
import type { IssuedPasswordAction, PasswordActionDelivery } from '../../auth/interfaces';
import { PasswordActionService, TokenService } from '../../auth/services';
import { buildPasswordActionEmail } from '../../auth/mail/password-email.templates';
import { MailService } from '../../mail';
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
    const result = await this.createProvisionedUser(dto);
    const passwordAction = await this.deliverPasswordAction(result.user, result.action);

    return { user: result.user, passwordAction };
  }

  async provisionUserWithApplicationsWithoutNotification(dto: CreateUserWithAccessDto) {
    const { user } = await this.createProvisionedUser(dto);
    return { user };
  }

  private async createProvisionedUser(dto: CreateUserWithAccessDto) {
    const { applicationIds, ...userDto } = dto;
    const passwordHash = await this.usersService.prepareUnknownPasswordHash();
    const result = await this.dataSource.transaction(async (manager) => {
      const user = await this.usersService.create(userDto, passwordHash, manager);
      await this.userApplicationsService.syncApplications(user.id, applicationIds, manager);
      const action = await this.passwordActionService.issue(user.id, PasswordActionPurpose.INITIAL_SETUP, manager);
      return { userId: user.id, action };
    });

    const user = await this.usersService.findOneWithApplications(result.userId);
    return { user, action: result.action };
  }

  async updateUserWithApplications(id: string, dto: UpdateUserWithAccessDto) {
    const { applicationIds, ...userDto } = dto;
    const result = await this.dataSource.transaction(async (manager) => {
      const { user, credentialsInvalidated } = await this.usersService.update(id, userDto, manager);
      if (applicationIds !== undefined) {
        await this.userApplicationsService.syncApplications(user.id, applicationIds, manager);
      }
      return {
        user: await this.usersService.findOneWithApplications(user.id, manager),
        credentialsInvalidated,
      };
    });

    if (result.credentialsInvalidated) {
      await this.tokenService.revokeAllForUserBestEffort(result.user.id);
    }

    return { user: result.user };
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

  async resendPasswordAction(id: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const user = await this.usersService.findOneWithApplications(id, manager);
      const action = await this.passwordActionService.resendPasswordAction(user.id, manager);
      return { user, action };
    });

    const passwordAction = await this.deliverPasswordAction(result.user, result.action);
    return {
      message: 'Password action resent successfully',
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
      const email = buildPasswordActionEmail(user.fullName, action);
      await this.mailService.send({ to: user.email, ...email });
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
