import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';

import { AuthException, AuthErrorCode } from '../exceptions/auth.exception';
import { AuthSessionPayload, AuthUser } from '../interfaces';
import { SESSION_TTL_SECONDS } from '../constants/session.constants';
import { User } from 'src/modules/users/entities';
import { TokenService } from './token.service';
import { LoginDto } from '../dtos';
@Injectable()
export class AuthService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectRepository(User) private userRepository: Repository<User>,
    private tokenService: TokenService,
  ) {}

  async authenticateUser({ login, password }: LoginDto): Promise<User> {
    const userDB = await this.userRepository
      .createQueryBuilder('user')
      .where('user.login = :login', { login })
      .addSelect('user.password')
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
    const payload = await this.redis.get(`session:${sessionId}`);
    if (!payload) {
      throw new UnauthorizedException('Session not found');
    }
    const session = JSON.parse(payload) as AuthSessionPayload;

    const user = await this.userRepository.findOneBy({ id: session.userId });

    if (!user) {
      throw new UnauthorizedException(`Invalid session`);
    }

    if (!user.isActive) {
      throw new UnauthorizedException(`User is disabled`);
    }

    return {
      id: user.id,
      fullName: user.fullName,
      roles: user.roles,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async createAuthSession(user: User) {
    const sessionId = crypto.randomUUID();
    const payload: AuthSessionPayload = { userId: user.id, fullName: user.fullName };
    await this.redis.set(`session:${sessionId}`, JSON.stringify(payload), 'EX', SESSION_TTL_SECONDS);
    return sessionId;
  }

  async getAuthSession(sessionId: string) {
    const key = `session:${sessionId}`;
    const session = await this.redis.get(key);
    return session ? (JSON.parse(session) as AuthSessionPayload) : null;
  }

  async removeAuthSession(sessionId: string | undefined) {
    if (!sessionId) {
      // throw new BadRequestException('Invalid session id');
      return {
        ok: true,
        message: 'Session is already logged out',
      };
    }

    const sessionRaw = await this.redis.get(`session:${sessionId}`);

    if (!sessionRaw) {
      return {
        ok: true,
        message: 'Session is already logged out',
      };
    }

    const session = JSON.parse(sessionRaw) as AuthSessionPayload;

    // revoca refresh tokens
    await this.tokenService.revokeAllForUser(session.userId);

    // eliminar sesión
    await this.redis.del(`session:${sessionId}`);

    return {
      ok: true,
      message: 'Logout successful',
    };
  }

  async checkUserAppAccess(userId: string, applicationId: number): Promise<boolean> {
    return await this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.applications', 'application')
      .where('user.id = :userId', { userId })
      .andWhere('user.isActive = true')
      .andWhere('application.id = :applicationId', { applicationId })
      .andWhere('application.isActive = true')
      .getExists();
  }
}
