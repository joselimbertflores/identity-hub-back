import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { hash } from 'bcrypt';
import { createHash, randomInt } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';

import { EnvironmentVariables } from 'src/config';
import { User } from 'src/modules/users/entities';
import { IDENTITY_HUB_UI_PATHS } from '../constants/oauth.constants';
import { CompletePasswordActionDto } from '../dtos';
import { PasswordActionPurpose, PasswordActionToken } from '../entities';
import type { IssuedPasswordAction } from '../interfaces';
import { buildPasswordActionEmail, buildPasswordChangedEmail } from '../mail/password-email.templates';
import { MailService } from 'src/modules/mail';
import { TokenService } from './token.service';

const PASSWORD_ACTION_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const PASSWORD_ACTION_CODE_LENGTH = 30;
const PASSWORD_ACTION_GROUP_LENGTH = 5;
const INVALID_ACTION_MESSAGE = 'The password action code is invalid or expired.';

@Injectable()
export class PasswordActionService {
  private readonly logger = new Logger(PasswordActionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly tokenService: TokenService,
    private readonly mailService: MailService,
  ) {}

  async issue(userId: string, purpose: PasswordActionPurpose, manager: EntityManager): Promise<IssuedPasswordAction> {
    await this.lockUser(userId, manager);
    return this.replaceAction(userId, purpose, manager);
  }

  async resendPasswordAction(userId: string, manager: EntityManager): Promise<IssuedPasswordAction> {
    const user = await this.lockUser(userId, manager);
    if (!user.isActive) {
      throw new BadRequestException('Cannot resend a password action for an inactive user');
    }

    const repository = manager.getRepository(PasswordActionToken);
    const current = await repository
      .createQueryBuilder('action')
      .setLock('pessimistic_write')
      .where('action.userId = :userId', { userId })
      .getOne();

    if (!current) {
      throw new NotFoundException('No pending password action found');
    }

    return this.replaceAction(userId, current.purpose, manager);
  }

  async requestRecovery(identifier: string): Promise<void> {
    const result = await this.dataSource.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('(user.login = :login OR LOWER(user.email) = :email)', {
          login: identifier,
          email: identifier.toLowerCase(),
        })
        .andWhere('user.isActive = true')
        .andWhere('user.email IS NOT NULL')
        .getOne();

      if (!user) return null;

      const action = await this.issue(user.id, PasswordActionPurpose.PASSWORD_RESET, manager);
      return { user, action };
    });

    if (!result?.user.email) return;

    try {
      const email = buildPasswordActionEmail(result.user.fullName, result.action);
      void this.mailService
        .send({ to: result.user.email, ...email })
        .catch(() => this.logger.warn('Password recovery email delivery failed'));
    } catch {
      this.logger.warn('Password recovery email delivery failed');
    }
  }

  async complete(dto: CompletePasswordActionDto): Promise<{ message: string }> {
    if (dto.newPassword !== dto.passwordConfirmation) {
      throw new BadRequestException('Password confirmation does not match.');
    }

    const normalizedCode = this.normalizeCode(dto.code);
    if (!normalizedCode) {
      throw new BadRequestException(INVALID_ACTION_MESSAGE);
    }
    const tokenHash = this.hashCode(normalizedCode);
    const candidate = await this.dataSource.getRepository(PasswordActionToken).findOne({ where: { tokenHash } });
    if (!candidate || candidate.expiresAt.getTime() <= Date.now() || !this.isSupportedPurpose(candidate.purpose)) {
      throw new BadRequestException(INVALID_ACTION_MESSAGE);
    }

    const newPasswordHash = await hash(dto.newPassword, 12);

    const changedUser = await this.dataSource.transaction(async (manager) => {
      const actionRepository = manager.getRepository(PasswordActionToken);
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .addSelect('user.credentialVersion')
        .setLock('pessimistic_write')
        .where('user.id = :userId', { userId: candidate.userId })
        .getOne();

      const action = await actionRepository
        .createQueryBuilder('action')
        .setLock('pessimistic_write')
        .where('action.tokenHash = :tokenHash', { tokenHash })
        .andWhere('action.userId = :userId', { userId: candidate.userId })
        .getOne();

      if (!action) return null;

      if (
        action.tokenHash !== tokenHash ||
        action.purpose !== candidate.purpose ||
        !this.isSupportedPurpose(action.purpose)
      ) {
        return null;
      }

      if (action.expiresAt.getTime() <= Date.now()) {
        await actionRepository.remove(action);
        return null;
      }

      if (!user?.isActive) {
        await actionRepository.remove(action);
        return null;
      }

      user.password = newPasswordHash;
      user.mustChangePassword = false;
      user.credentialVersion += 1;
      await manager.getRepository(User).save(user);
      await actionRepository.delete({ userId: user.id });

      return { id: user.id, email: user.email, fullName: user.fullName };
    });

    if (!changedUser) {
      throw new BadRequestException(INVALID_ACTION_MESSAGE);
    }

    await this.tokenService.revokeAllForUserBestEffort(changedUser.id);
    if (changedUser.email) {
      try {
        const email = buildPasswordChangedEmail(changedUser.fullName);
        await this.mailService.send({ to: changedUser.email, ...email });
      } catch {
        this.logger.warn('Password change notification delivery failed');
      }
    }

    return { message: 'Password updated successfully. Sign in with your new password.' };
  }

  private async replaceAction(
    userId: string,
    purpose: PasswordActionPurpose,
    manager: EntityManager,
  ): Promise<IssuedPasswordAction> {
    const code = this.generateCode();
    const normalizedCode = this.normalizeCode(code)!;
    const expiresAt = new Date(Date.now() + this.getTtlSeconds(purpose) * 1000);
    const repository = manager.getRepository(PasswordActionToken);

    await repository.delete({ userId });
    await repository.save(
      repository.create({
        userId,
        purpose,
        tokenHash: this.hashCode(normalizedCode),
        expiresAt,
      }),
    );

    return {
      purpose,
      code,
      actionUrl: this.buildActionUrl(code),
      expiresAt,
    };
  }

  private async lockUser(userId: string, manager: EntityManager): Promise<User> {
    const user = await manager
      .getRepository(User)
      .createQueryBuilder('user')
      .setLock('pessimistic_write')
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private generateCode(): string {
    const characters = Array.from({ length: PASSWORD_ACTION_CODE_LENGTH }, () => {
      return PASSWORD_ACTION_ALPHABET[randomInt(PASSWORD_ACTION_ALPHABET.length)];
    }).join('');

    return characters.match(new RegExp(`.{1,${PASSWORD_ACTION_GROUP_LENGTH}}`, 'g'))!.join('-');
  }

  private normalizeCode(code: string): string | null {
    const normalized = code.replace(/[\s-]/g, '').toUpperCase();
    if (normalized.length !== PASSWORD_ACTION_CODE_LENGTH) return null;
    if ([...normalized].some((character) => !PASSWORD_ACTION_ALPHABET.includes(character))) return null;
    return normalized;
  }

  private hashCode(normalizedCode: string): string {
    return createHash('sha256').update(normalizedCode, 'utf8').digest('hex');
  }

  private isSupportedPurpose(purpose: PasswordActionPurpose): boolean {
    return purpose === PasswordActionPurpose.INITIAL_SETUP || purpose === PasswordActionPurpose.PASSWORD_RESET;
  }

  private getTtlSeconds(purpose: PasswordActionPurpose): number {
    return purpose === PasswordActionPurpose.INITIAL_SETUP
      ? this.configService.getOrThrow('PASSWORD_INITIAL_SETUP_TTL_SECONDS', { infer: true })
      : this.configService.getOrThrow('PASSWORD_RESET_TTL_SECONDS', { infer: true });
  }

  private buildActionUrl(code: string): string {
    const baseUrl = this.configService.getOrThrow('IDENTITY_HUB_UI_URL', { infer: true });
    const url = new URL(IDENTITY_HUB_UI_PATHS.PASSWORD_ACTION, baseUrl);
    url.searchParams.set('code', code);
    return url.toString();
  }
}
