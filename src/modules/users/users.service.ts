import { BadRequestException, NotFoundException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { EntityManager, ILike, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { ulid } from 'ulid';

import { CreateUserDto, UpdateUserDto, UpdateUserProfileDto } from './dtos';
import { PaginationParamsDto } from '../common';
import { User } from './entities';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private userRepository: Repository<User>) {}

  async findAll(paginationDto: PaginationParamsDto) {
    const { limit, offset, term } = paginationDto;
    const [users, total] = await this.userRepository.findAndCount({
      take: limit,
      skip: offset,
      ...(term && {
        where: { fullName: ILike(`%${term}%`) },
      }),
      relations: { userApplications: true },
      order: {
        createdAt: 'DESC',
      },
    });
    return { users, total };
  }

  async create(dto: CreateUserDto, manager?: EntityManager) {
    const repository = manager ? manager.getRepository(User) : this.userRepository;

    const duplicate = await repository.findOne({ where: { login: dto.login } });
    if (duplicate) {
      throw new BadRequestException(`Duplicate login: ${dto.login}`);
    }

    const externalKey = `IDH-U-${ulid()}`;

    const password = this.generateSecurePassword();
    const passwordHash = await this.encryptPassword(password);

    const model = repository.create({
      ...dto,
      password: passwordHash,
      externalKey,
    });

    const user = await repository.save(model);

    return { user, password };
  }

  async update(id: string, dto: UpdateUserDto, manager?: EntityManager) {
    const repository = manager ? manager.getRepository(User) : this.userRepository;

    const userDB = await repository.findOneBy({ id });

    if (!userDB) throw new NotFoundException(`User ${id} not found`);

    if (dto.login && userDB.login !== dto.login) {
      const duplicate = await repository.findOne({ where: { login: dto.login } });

      if (duplicate) throw new BadRequestException(`Duplicate login: ${dto.login}`);
    }

    Object.assign(userDB, dto);

    return await repository.save(userDB);
  }

  async findByExternalKey(id: string) {
    return this.userRepository.findOne({
      where: { externalKey: id },
    });
  }

  async updateUserProfile(id: string, dto: UpdateUserProfileDto) {
    const userDB = await this.userRepository.findOne({ where: { id } });
    if (!userDB) throw new BadRequestException('User not fount');
    const passwordHash = await this.encryptPassword(dto.password);
    return await this.userRepository.save({
      ...userDB,
      password: passwordHash,
      mustChangePassword: false,
    });
  }

  async resetTemporaryPassword(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) throw new NotFoundException('User not found');

    const password = this.generateSecurePassword();
    const encryptPassword = await this.encryptPassword(password);

    user.password = encryptPassword;
    user.mustChangePassword = true;

    await this.userRepository.save(user);

    return { user, password };
  }

  async changePassword(id: string, newPassword: string) {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const passwordHash = await this.encryptPassword(newPassword);

    user.password = passwordHash;
    user.mustChangePassword = false;

    await this.userRepository.save(user);

    return { message: 'Password changed successfully' };
  }

  async findOneWithApplications(id: string, manager?: EntityManager): Promise<User> {
    const repository = manager ? manager.getRepository(User) : this.userRepository;
    const user = await repository.findOne({
      where: { id },
      relations: {
        userApplications: {
          application: true,
        },
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

  private generateSecurePassword(length = 12): string {
    return randomBytes(length).toString('base64').slice(0, length);
  }
}
