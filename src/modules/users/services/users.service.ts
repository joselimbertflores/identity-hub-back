import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Brackets, EntityManager, ILike, In, MoreThan, QueryFailedError, Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { ulid } from 'ulid';

import { CreateUserDto, UpdateUserDto } from '../dtos';
import { PaginationParamsDto } from '../../common';
import { User } from '../entities';
import { PasswordActionToken } from '../../auth/entities';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(PasswordActionToken)
    private readonly passwordActionRepository: Repository<PasswordActionToken>,
  ) {}

  async findAll(paginationDto: PaginationParamsDto) {
    const { limit, offset, term } = paginationDto;
    const [users, total] = await this.userRepository.findAndCount({
      take: limit,
      skip: offset,
      ...(term && {
        where: { fullName: ILike(`%${term}%`) },
      }),
      relations: { applications: true },
      select: {
        applications: {
          id: true,
          name: true,
          description: true,
        },
      },
      order: {
        createdAt: 'DESC',
      },
    });

    const now = new Date();
    const passwordActions = users.length
      ? await this.passwordActionRepository.find({
          where: { userId: In(users.map(({ id }) => id)), expiresAt: MoreThan(now) },
          select: { userId: true, purpose: true, expiresAt: true },
        })
      : [];
    const passwordActionByUserId = new Map(
      passwordActions.map(({ userId, purpose, expiresAt }) => [userId, { purpose, expiresAt }]),
    );

    return {
      users: users.map((user) => ({
        ...user,
        passwordAction: passwordActionByUserId.get(user.id) ?? null,
      })),
      total,
    };
  }

  async create(dto: CreateUserDto, passwordHash: string, manager?: EntityManager): Promise<User> {
    const repository = manager ? manager.getRepository(User) : this.userRepository;
    const email = this.normalizeEmail(dto.email);

    const duplicate = await repository
      .createQueryBuilder('user')
      .where(
        new Brackets((where) => {
          where.where('user.login = :login OR user.email = :login', { login: dto.login });
          if (email) {
            where.orWhere('user.email = :email OR user.login = :email', { email });
          }
        }),
      )
      .getOne();
    if (duplicate) {
      throw new ConflictException('Login or email already exists');
    }

    const externalKey = `IDH-U-${ulid()}`;
    const model = repository.create({
      ...dto,
      email,
      password: passwordHash,
      externalKey,
      mustChangePassword: true,
      credentialVersion: 0,
    });

    try {
      return await repository.save(model);
    } catch (error: unknown) {
      this.rethrowUniqueConflict(error);
    }
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    manager?: EntityManager,
  ): Promise<{ user: User; credentialsInvalidated: boolean }> {
    if (!manager) {
      return this.userRepository.manager.transaction((transactionManager) => this.update(id, dto, transactionManager));
    }
    const repository = manager.getRepository(User);

    const userQuery = repository
      .createQueryBuilder('user')
      .addSelect('user.credentialVersion')
      .where('user.id = :id', { id })
      .setLock('pessimistic_write');

    const userDB = await userQuery.getOne();

    if (!userDB) throw new NotFoundException(`User ${id} not found`);

    const credentialsInvalidated = userDB.isActive && dto.isActive === false;

    const email = Object.hasOwn(dto, 'email') ? this.normalizeEmail(dto.email) : undefined;
    const emailChanged = email !== undefined && userDB.email !== email;
    const loginChanged = dto.login !== undefined && userDB.login !== dto.login;
    if (loginChanged || (emailChanged && email)) {
      const duplicateQuery = repository
        .createQueryBuilder('user')
        .where('user.id != :id', { id })
        .andWhere(
          new Brackets((where) => {
            if (loginChanged) {
              where.where('user.login = :login OR user.email = :login', { login: dto.login });
            }
            if (emailChanged && email) {
              if (loginChanged) {
                where.orWhere('user.email = :email OR user.login = :email', { email });
              } else {
                where.where('user.email = :email OR user.login = :email', { email });
              }
            }
          }),
        );
      const duplicate = await duplicateQuery.getOne();

      if (duplicate) throw new ConflictException('Login or email already exists');
    }

    Object.assign(userDB, dto);
    if (email !== undefined) userDB.email = email;
    if (credentialsInvalidated) userDB.credentialVersion += 1;

    try {
      const user = await repository.save(userDB);
      if (emailChanged || credentialsInvalidated) {
        await manager.getRepository(PasswordActionToken).delete({ userId: id });
      }
      return { user, credentialsInvalidated };
    } catch (error: unknown) {
      this.rethrowUniqueConflict(error);
    }
  }

  async prepareUnknownPasswordHash(): Promise<string> {
    return this.encryptPassword(this.generateUnknownPassword());
  }

  async invalidateCredentialsForPasswordReset(
    id: string,
    passwordHash: string,
    manager: EntityManager,
  ): Promise<Pick<User, 'id' | 'email' | 'fullName' | 'login'>> {
    const repository = manager.getRepository(User);
    const user = await repository
      .createQueryBuilder('user')
      .addSelect('user.credentialVersion')
      .setLock('pessimistic_write')
      .where('user.id = :id', { id })
      .getOne();

    if (!user) throw new NotFoundException('User not found');
    if (!user.isActive) {
      throw new BadRequestException('Cannot reset the password of an inactive user');
    }

    user.password = passwordHash;
    user.mustChangePassword = true;
    user.credentialVersion += 1;
    await repository.save(user);

    return { id: user.id, email: user.email, fullName: user.fullName, login: user.login };
  }

  async applyAuthenticatedPasswordChange(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<Pick<User, 'id' | 'email' | 'fullName' | 'credentialVersion'>> {
    const currentUser = await this.userRepository
      .createQueryBuilder('user')
      .addSelect(['user.password', 'user.credentialVersion'])
      .where('user.id = :id', { id })
      .getOne();

    if (!currentUser) throw new NotFoundException('User not found');

    const currentPasswordIsValid = await bcrypt.compare(currentPassword, currentUser.password);
    if (!currentPasswordIsValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newPasswordHash = await this.encryptPassword(newPassword);

    return this.userRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(User);
      const user = await repository
        .createQueryBuilder('user')
        .addSelect(['user.password', 'user.credentialVersion'])
        .setLock('pessimistic_write')
        .where('user.id = :id', { id })
        .getOne();

      if (!user) throw new NotFoundException('User not found');

      if (
        user.password !== currentUser.password ||
        user.credentialVersion !== currentUser.credentialVersion ||
        !user.isActive
      ) {
        throw new ConflictException('Credentials changed while processing the request');
      }

      user.password = newPasswordHash;
      user.mustChangePassword = false;
      user.credentialVersion += 1;
      await repository.save(user);
      await manager.getRepository(PasswordActionToken).delete({ userId: user.id });

      return { id: user.id, email: user.email, fullName: user.fullName, credentialVersion: user.credentialVersion };
    });
  }

  async findOneWithApplications(id: string, manager?: EntityManager): Promise<User> {
    const repository = manager ? manager.getRepository(User) : this.userRepository;
    const user = await repository.findOne({
      where: { id },
      relations: { applications: true },
      select: {
        applications: { id: true, name: true, description: true },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private async encryptPassword(password: string) {
    return await bcrypt.hash(password, 12);
  }

  private generateUnknownPassword(): string {
    return randomBytes(32).toString('base64url');
  }

  private normalizeEmail(email: string | null | undefined): string | null | undefined {
    return typeof email === 'string' ? email.trim().toLowerCase() || null : email;
  }

  private rethrowUniqueConflict(error: unknown): never {
    if (error instanceof QueryFailedError && (error.driverError as { code?: string } | undefined)?.code === '23505') {
      throw new ConflictException('Login or email already exists');
    }
    throw error;
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
