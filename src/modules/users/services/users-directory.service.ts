import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Brackets, Repository } from 'typeorm';

import { AssignableUserQueryDto, AssignableUserResponseDto } from '../dtos';
import { User } from '../entities';

@Injectable()
export class UsersDirectoryService {
  constructor(@InjectRepository(User) private readonly userRepository: Repository<User>) {}

  async findAssignableUsers(
    applicationId: number,
    query: AssignableUserQueryDto,
  ): Promise<AssignableUserResponseDto[]> {
    const term = query.term?.trim();
    const queryBuilder = this.createAssignableUsersQuery(applicationId);

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

    const users = await queryBuilder.orderBy('user.fullName', 'ASC').addOrderBy('user.id', 'ASC').take(20).getMany();

    return users.map((user) => this.toResponse(user));
  }

  async findAssignableUserByExternalKey(
    applicationId: number,
    externalKey: string,
  ): Promise<AssignableUserResponseDto> {
    const user = await this.createAssignableUsersQuery(applicationId)
      .andWhere('user.externalKey = :externalKey', { externalKey })
      .getOne();

    if (!user) {
      throw new NotFoundException('Assignable user not found');
    }

    return this.toResponse(user);
  }

  private createAssignableUsersQuery(applicationId: number) {
    return this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.applications', 'application', 'application.id = :applicationId', { applicationId })
      .where('user.isActive = true')
      .select(['user.id', 'user.fullName', 'user.email', 'user.login']);
  }

  private toResponse(user: User): AssignableUserResponseDto {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email ?? null,
      login: user.login,
    };
  }
}
