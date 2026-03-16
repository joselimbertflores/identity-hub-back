import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';

import { AuthException, AuthErrorCode } from '../exceptions/auth.exception';
import { UserApplication } from 'src/modules/access/entities';
import { AuthSessionPayload } from '../interfaces';
import { User } from 'src/modules/users/entities';
import { LoginDto } from '../dtos';
import { TokenService } from './token.service';
@Injectable()
export class AuthService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectRepository(User) private userRepository: Repository<User>,
    @InjectRepository(UserApplication) private userAppRepository: Repository<UserApplication>,
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

  async validateSession(sessionId: string) {
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
    };
  }

  async createAuthSession(user: User) {
    // * Central sessionId, logout global
    const sessionId = crypto.randomUUID();
    const LABORAL_HOURS_SECONDS = 10 * 60 * 60;
    const payload: AuthSessionPayload = { userId: user.id, fullName: user.fullName };
    await this.redis.set(`session:${sessionId}`, JSON.stringify(payload), 'EX', LABORAL_HOURS_SECONDS);
    return sessionId;
  }

  async getAuthSession(sessionId: string) {
    const key = `session:${sessionId}`;
    const session = await this.redis.get(key);
    return session ? (JSON.parse(session) as AuthSessionPayload) : null;
  }

  async removeAuthSession(sessionId: string | undefined) {
    if (!sessionId) {
      throw new BadRequestException('Invalid session id');
    }

    const sessionRaw = await this.redis.get(`session:${sessionId}`);

    if (!sessionRaw) {
      return {
        ok: true,
        message: 'Session is already logged out',
      };
    }

    const session = JSON.parse(sessionRaw) as AuthSessionPayload;

    // revocar refresh tokens
    await this.tokenService.revokeAllForUser(session.userId);

    // eliminar sesión
    await this.redis.del(`session:${sessionId}`);

    return {
      ok: true,
      message: 'Logout successful',
    };
  }

  async checkUserAppAccess(userId: string, applicationId: number) {
    const hasAccess = await this.userAppRepository.findOne({
      where: { user: { id: userId, isActive: true }, applicationId },
    });
    return hasAccess ? true : false;
  }
}
