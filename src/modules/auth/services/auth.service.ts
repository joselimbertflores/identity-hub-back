import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { AuthException, AuthErrorCode } from '../exceptions/auth.exception';
import { AuthSessionPayload, AuthUser, RevokedSessionContext } from '../interfaces';
import { User } from 'src/modules/users/entities';
import { UsersService } from 'src/modules/users/services';
import { Application } from 'src/modules/access/entities';
import { MailService } from 'src/modules/mail';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { ChangePasswordDto, LoginDto } from '../dtos';
import { buildPasswordChangedEmail } from '../mail/password-email.templates';
import { BACKCHANNEL_LOGOUT_TIMEOUT_MS } from '../constants/oauth.constants';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly sessionService: SessionService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Application) private readonly appRepository: Repository<Application>,
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly mailService: MailService,
  ) {}

  async signIn(dto: LoginDto): Promise<{ sessionId: string }> {
    const user = await this.authenticateUser(dto);
    const sessionId = await this.createAuthSession(user);
    return { sessionId };
  }

  async completeAuthenticatedPasswordChange(
    userId: string,
    { newPassword }: ChangePasswordDto,
  ): Promise<{ sessionId: string }> {
    const user = await this.usersService.applyAuthenticatedPasswordChange(userId, newPassword);
    await this.revokeAllUserSessions(userId);
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

    // PostgreSQL remains authoritative even if Redis cleanup fails.
    if (
      !user?.isActive ||
      !Number.isInteger(session.credentialVersion) ||
      session.credentialVersion !== user.credentialVersion
    ) {
      try {
        const revoked = await this.sessionService.remove(sessionId, session.userId);
        if (revoked) await this.notifyBackchannelLogout([revoked]);
      } catch {
        this.logger.warn('Invalid SSO session cleanup failed');
      }
      return null;
    }
    return { session, user };
  }

  async logout(sessionId: string | undefined): Promise<RevokedSessionContext | null> {
    if (!sessionId) return null;

    const session = await this.sessionService.get(sessionId);
    if (!session) return null;

    const revoked = await this.sessionService.remove(sessionId, session.userId);
    if (revoked) await this.notifyBackchannelLogout([revoked]);
    return revoked;
  }

  async logoutBySid(sid: string, requestingClientId: string): Promise<RevokedSessionContext> {
    const revoked = await this.sessionService.removeBySid(sid, requestingClientId);
    if (!revoked) {
      throw new NotFoundException('Session not found or unavailable for this client');
    }

    await this.notifyBackchannelLogout([revoked]);
    return revoked;
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    let revoked: RevokedSessionContext[];
    try {
      revoked = await this.sessionService.revokeAllSessionsForUser(userId);
    } catch {
      this.logger.warn('SSO session revocation failed');
      return;
    }

    await this.notifyBackchannelLogout(revoked);
  }

  async revokeApplicationAccessForUser(userId: string, clientIds: string[]): Promise<void> {
    const revocations = await Promise.allSettled(
      [...new Set(clientIds)].map((clientId) =>
        this.sessionService.revokeClientParticipationForUser(userId, clientId),
      ),
    );

    const revoked: RevokedSessionContext[] = [];
    for (const result of revocations) {
      if (result.status === 'fulfilled') {
        revoked.push(...result.value);
      } else {
        this.logger.warn('SSO client participation cleanup failed after access removal');
      }
    }

    await this.notifyBackchannelLogout(revoked);
  }

  private async notifyBackchannelLogout(revokedSessions: RevokedSessionContext[]): Promise<void> {
    const clientIds = [...new Set(revokedSessions.flatMap(({ clientIds }) => clientIds))];
    if (clientIds.length === 0) return;

    let applications: Application[];
    try {
      applications = await this.appRepository.find({ where: { clientId: In(clientIds) } });
    } catch {
      this.logger.warn('Could not load applications for back-channel logout');
      return;
    }

    const applicationsByClientId = new Map(applications.map((application) => [application.clientId, application]));
    await Promise.all(
      revokedSessions.flatMap(({ sid, clientIds: sessionClientIds }) =>
        [...new Set(sessionClientIds)].map((clientId) => {
          const application = applicationsByClientId.get(clientId);
          return application ? this.sendBackchannelLogout(application, sid) : Promise.resolve();
        }),
      ),
    );
  }

  private async sendBackchannelLogout(application: Application, sid: string): Promise<void> {
    if (!application.backchannelLogoutUri) return;

    try {
      const logoutToken = await this.tokenService.createLogoutToken(sid, application.clientId);
      const response = await fetch(application.backchannelLogoutUri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ logout_token: logoutToken }),
        signal: AbortSignal.timeout(BACKCHANNEL_LOGOUT_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(
          `Back-channel logout failed for client ${application.clientId} with status ${response.status}`,
        );
      }
    } catch {
      this.logger.warn(`Back-channel logout failed for client ${application.clientId}`);
    }
  }
}
