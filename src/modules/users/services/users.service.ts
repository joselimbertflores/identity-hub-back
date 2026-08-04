import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { EntityManager, ILike, In, QueryFailedError, Repository } from 'typeorm';
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

    const passwordActions = users.length
      ? await this.passwordActionRepository.find({
          where: { userId: In(users.map(({ id }) => id)) },
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

    const duplicateQuery = repository.createQueryBuilder('user').where('user.login = :login', { login: dto.login });
    if (email) {
      duplicateQuery.orWhere('user.email = :email', { email });
    }
    const duplicate = await duplicateQuery.getOne();
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

  async update(id: string, dto: UpdateUserDto, manager?: EntityManager) {
    const repository = manager ? manager.getRepository(User) : this.userRepository;

    const userDB = await repository.findOneBy({ id });

    if (!userDB) throw new NotFoundException(`User ${id} not found`);

    const email = Object.hasOwn(dto, 'email') ? this.normalizeEmail(dto.email) : undefined;
    if ((dto.login && userDB.login !== dto.login) || (email !== undefined && userDB.email !== email)) {
      const duplicateQuery = repository.createQueryBuilder('user').where('user.id != :id', { id });
      if (dto.login) {
        duplicateQuery.andWhere('(user.login = :login OR user.email = :email)', {
          login: dto.login,
          email: email ?? '__no_email__',
        });
      } else {
        duplicateQuery.andWhere('user.email = :email', { email });
      }
      const duplicate = await duplicateQuery.getOne();

      if (duplicate) throw new ConflictException('Login or email already exists');
    }

    Object.assign(userDB, dto);
    if (email !== undefined) userDB.email = email;

    try {
      return await repository.save(userDB);
    } catch (error: unknown) {
      this.rethrowUniqueConflict(error);
    }
  }

  async findByExternalKey(id: string) {
    return this.userRepository.findOne({ where: { externalKey: id } });
  }

  async prepareUnknownPasswordHash(): Promise<string> {
    return this.encryptPassword(this.generateUnknownPassword());
  }

  async setUnknownPasswordForReset(
    id: string,
    passwordHash: string,
    manager: EntityManager,
  ): Promise<Pick<User, 'id' | 'email' | 'fullName'>> {
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

    return { id: user.id, email: user.email, fullName: user.fullName };
  }

  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<Pick<User, 'id' | 'email' | 'fullName'>> {
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

      return { id: user.id, email: user.email, fullName: user.fullName };
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
}
