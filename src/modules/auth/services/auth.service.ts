import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { AuthException, AuthErrorCode } from '../exceptions/auth.exception';
import { AuthSessionPayload, AuthUser } from '../interfaces';
import { User } from 'src/modules/users/entities';
import { UsersService } from 'src/modules/users/services';
import { MailService } from 'src/modules/mail';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { LoginDto } from '../dtos';
import { buildPasswordChangedEmail } from '../mail/password-email.templates';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly sessionService: SessionService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly mailService: MailService,
  ) {}

  async signIn(dto: LoginDto): Promise<{ sessionId: string; mustChangePassword: boolean }> {
    const user = await this.authenticateUser(dto);
    const sessionId = await this.createAuthSession(user);
    return { sessionId, mustChangePassword: user.mustChangePassword };
  }

  async completeAuthenticatedPasswordChange(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ sessionId: string }> {
    const user = await this.usersService.applyAuthenticatedPasswordChange(userId, currentPassword, newPassword);
    await this.cleanupInvalidatedAuthStateForUserBestEffort(userId);
    const sessionId = await this.createAuthSession(user);

    if (user.email) {
      try {
        const email = buildPasswordChangedEmail(user.fullName);
        await this.mailService.send({ to: user.email, ...email });
      } catch {
        this.logger.warn('Password change notification delivery failed');
      }
    }

    return { sessionId };
  }

  private async authenticateUser({ login, password }: LoginDto): Promise<User> {
    const userDB = await this.userRepository
      .createQueryBuilder('user')
      .where('user.login = :login', { login })
      .addSelect(['user.password', 'user.credentialVersion'])
      .getOne();

    if (!userDB) {
      throw new AuthException(AuthErrorCode.INVALID_CREDENTIALS);
    }

    const isValid = await bcrypt.compare(password, userDB.password);
    if (!isValid) {
      throw new AuthException(AuthErrorCode.INVALID_CREDENTIALS);
    }

    if (!userDB.isActive) {
      throw new AuthException(AuthErrorCode.USER_DISABLED);
    }

    return userDB;
  }

  async validateSession(sessionId: string): Promise<AuthUser> {
    const authenticated = await this.loadAuthenticatedSession(sessionId);
    if (!authenticated) throw new UnauthorizedException('Invalid or expired session');
    const { user } = authenticated;

    return {
      id: user.id,
      fullName: user.fullName,
      roles: user.roles,
      mustChangePassword: user.mustChangePassword,
    };
  }

  private async createAuthSession(user: Pick<User, 'id' | 'credentialVersion'>): Promise<string> {
    if (!Number.isInteger(user.credentialVersion)) {
      throw new UnauthorizedException('Invalid credential version');
    }
    return this.sessionService.create({
      userId: user.id,
      credentialVersion: user.credentialVersion,
    });
  }

  async getValidatedSession(sessionId: string) {
    return this.loadAuthenticatedSession(sessionId);
  }

  private async loadAuthenticatedSession(
    sessionId: string,
  ): Promise<{ session: AuthSessionPayload; user: User } | null> {
    const session = await this.sessionService.get(sessionId);
    if (!session) return null;

    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.credentialVersion')
      .where('user.id = :id', { id: session.userId })
      .getOne();

    // Missing versions (legacy sessions) and stale versions must require a fresh login,
    // including when Redis cleanup fails or a login races with a credential change.
    if (
      !user?.isActive ||
      !Number.isInteger(session.credentialVersion) ||
      session.credentialVersion !== user.credentialVersion
    ) {
      try {
        await this.sessionService.remove(sessionId, session.userId);
      } catch {
        this.logger.warn('Invalid SSO session cleanup failed');
      }
      return null;
    }
    return { session, user };
  }

  async logout(sessionId: string | undefined) {
    if (!sessionId) {
      return {
        ok: true,
        message: 'Session is already logged out',
      };
    }

    const authenticated = await this.loadAuthenticatedSession(sessionId);

    if (!authenticated) {
      return {
        ok: true,
        message: 'Session is already logged out',
      };
    }

    // Logout is global for refresh tokens but removes only the presented Identity Hub session.
    await this.tokenService.revokeAllRefreshTokensForUser(authenticated.user.id);
    await this.sessionService.remove(sessionId, authenticated.user.id);

    return {
      ok: true,
      message: 'Logout successful',
    };
  }

  async cleanupInvalidatedAuthStateForUserBestEffort(userId: string): Promise<void> {
    // credentialVersion is already committed in PostgreSQL. Cleanup failures cannot
    // make old refresh tokens or sessions valid again.
    const results = await Promise.allSettled([
      this.tokenService.revokeAllRefreshTokensForUser(userId),
      this.sessionService.revokeAllSessionsForUser(userId),
    ]);
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        this.logger.warn(`${index === 0 ? 'Refresh token' : 'SSO session'} cleanup failed after credential change`);
      }
    }
  }

  async findUserEligibleForOAuthCredentials(userId: string, applicationId: number): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.credentialVersion')
      .innerJoin('user.applications', 'application')
      .where('user.id = :userId', { userId })
      .andWhere('user.isActive = true')
      .andWhere('user.mustChangePassword = false')
      .andWhere('application.id = :applicationId', { applicationId })
      .andWhere('application.isActive = true')
      .getOne();
  }
}
