import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Brackets, Repository } from 'typeorm';

import { AssignableUserQueryDto } from '../dtos';
import { User } from '../entities';

@Injectable()
export class UsersDirectoryService {
  constructor(@InjectRepository(User) private readonly userRepository: Repository<User>) {}

  async findAssignableUsers(applicationId: number, query: AssignableUserQueryDto) {
    const term = query.term?.trim();
    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.applications', 'application', 'application.id = :applicationId', { applicationId })
      .where('user.isActive = true');

    if (term) {
      queryBuilder.andWhere(
        new Brackets((where) => {
          where
            .where('user.fullName ILIKE :term', { term: `%${term}%` })
            .orWhere('user.email ILIKE :term', { term: `%${term}%` })
            .orWhere('user.login ILIKE :term', { term: `%${term}%` });
        }),
      );
    }

    const users = await queryBuilder
      .select(['user.id', 'user.externalKey', 'user.fullName', 'user.email', 'user.login'])
      .orderBy('user.fullName', 'ASC')
      .take(20)
      .getMany();

    return users.map((user) => ({
      externalKey: user.externalKey,
      fullName: user.fullName,
      email: user.email ?? null,
      login: user.login,
    }));
  }
  async findAssignableUserByExternalKey(applicationId: number, externalKey: string) {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.applications', 'application', 'application.id = :applicationId', { applicationId })
      .where('user.isActive = true')
      .andWhere('user.externalKey = :externalKey', { externalKey })
      .select(['user.externalKey', 'user.fullName', 'user.email', 'user.login', 'user.relationKey'])
      .getOne();

    if (!user) {
      throw new NotFoundException('Assignable user not found');
    }

    return {
      externalKey: user.externalKey,
      fullName: user.fullName,
      email: user.email ?? null,
      login: user.login,
      relationKey: user.relationKey ?? null,
    };
  }
}
