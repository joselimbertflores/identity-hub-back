import { BadRequestException, NotFoundException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { EntityManager, ILike, Repository } from 'typeorm';
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
      select: { password: false },
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

    const passwordHash = await this.encryptPassword('123456');

    const user = repository.create({
      ...dto,
      password: passwordHash,
      externalKey,
    });

    return repository.save(user);
  }

  async update(id: string, dto: UpdateUserDto, manager?: EntityManager) {
    const repository = manager ? manager.getRepository(User) : this.userRepository;

    const userDB = await repository.findOneBy({ id });

    if (!userDB) throw new NotFoundException(`El usuario editado no existe`);
    if (dto.login && userDB.login !== dto.login) {
      const duplicate = await repository.findOne({
        where: { login: dto.login },
      });

      if (duplicate) {
        throw new BadRequestException(`Duplicate login: ${dto.login}`);
      }
    }
    return await repository.save({
      ...userDB,
      ...dto,
    });
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
    });
  }

  private async encryptPassword(password: string) {
    return await bcrypt.hash(password, 12);
  }
}
