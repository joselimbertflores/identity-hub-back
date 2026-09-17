import { Injectable } from '@nestjs/common';

import { DataSource, EntityManager } from 'typeorm';

import { CreateAdministrativeUserDto, CreateUserWithAccessDto, UpdateUserWithAccessDto } from '../dtos';
import { UserApplicationsService } from '../../access/services';
import { UsersService } from '../../users/services/users.service';
import { PasswordActionPurpose } from '../../auth/entities';
import { AuthService, PasswordActionService } from '../../auth/services';
import { RrhhEmployeesService } from './rrhh-employees.service';

@Injectable()
export class UserProvisioningService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly userApplicationsService: UserApplicationsService,
    private readonly passwordActionService: PasswordActionService,
    private readonly authService: AuthService,
    private readonly rrhhEmployeesService: RrhhEmployeesService,
  ) {}

  async provisionUserWithApplications(dto: CreateAdministrativeUserDto) {
    const employee = await this.rrhhEmployeesService.findOne(dto.relationKey);
    const passwordHash = await this.usersService.prepareUnknownPasswordHash();
    const result = await this.dataSource.transaction(async (manager) => {
      await this.usersService.ensureRelationKeyAvailable(employee.relationKey, manager);
      const user = await this.createProvisionedUser(
        {
          login: dto.login,
          email: dto.email,
          roles: dto.roles,
          isActive: dto.isActive,
          applicationIds: dto.applicationIds,
          relationKey: employee.relationKey,
          fullName: employee.fullName,
        },
        passwordHash,
        manager,
      );
      const action = await this.passwordActionService.issue(user.id, PasswordActionPurpose.INITIAL_SETUP, manager);
      return { user, action };
    });
    const passwordAction = await this.passwordActionService.deliver(result.user, result.action);

    return { user: result.user, passwordAction };
  }

  async provisionUserWithApplicationsWithoutNotification(dto: CreateUserWithAccessDto) {
    const passwordHash = await this.usersService.prepareUnknownPasswordHash();
    const user = await this.dataSource.transaction((manager) => this.createProvisionedUser(dto, passwordHash, manager));
    return { user };
  }

  private async createProvisionedUser(dto: CreateUserWithAccessDto, passwordHash: string, manager: EntityManager) {
    const { applicationIds, ...userDto } = dto;
    const user = await this.usersService.create(userDto, passwordHash, manager);
    await this.userApplicationsService.syncApplications(user.id, applicationIds, manager);
    return this.usersService.findOneWithApplications(user.id, manager);
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
      await this.authService.cleanupInvalidatedAuthStateForUserBestEffort(result.user.id);
    }

    return { user: result.user };
  }

  async resetPassword(id: string) {
    const passwordHash = await this.usersService.prepareUnknownPasswordHash();
    const result = await this.dataSource.transaction(async (manager) => {
      const user = await this.usersService.invalidateCredentialsForPasswordReset(id, passwordHash, manager);
      const action = await this.passwordActionService.issue(user.id, PasswordActionPurpose.PASSWORD_RESET, manager);
      return { user, action };
    });

    await this.authService.cleanupInvalidatedAuthStateForUserBestEffort(result.user.id);
    const passwordAction = await this.passwordActionService.deliver(result.user, result.action);

    return {
      message: 'Password reset created successfully',
      passwordAction,
    };
  }

  async resendPasswordAction(id: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const action = await this.passwordActionService.resendPasswordAction(id, manager);
      const user = await this.usersService.findOneWithApplications(id, manager);
      return { user, action };
    });

    const passwordAction = await this.passwordActionService.deliver(result.user, result.action);
    return {
      message: 'Password action resent successfully',
      passwordAction,
    };
  }
}
