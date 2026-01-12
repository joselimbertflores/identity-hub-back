import { Injectable, BadRequestException, HttpException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { User } from 'src/modules/users/entities';
import { Application, UserApplication } from '../entities';
import { CreateUserWithAccessDto, UpdateUserWithAccessDto } from '../dtos';
import { UsersService } from 'src/modules/users/users.service';

@Injectable()
export class AccessService {
  constructor(
    private dataSource: DataSource,
    private userService: UsersService,
    @InjectRepository(Application) private appRepository: Repository<Application>,
    @InjectRepository(UserApplication) private userAppRepository: Repository<UserApplication>,
  ) {}

  async provisionUserWithApplications(dto: CreateUserWithAccessDto) {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const user = await this.userService.create(dto, queryRunner.manager);

      await this.syncUserApplications(
        {
          userId: user.id,
          applicationIds: dto.applicationIds,
        },
        queryRunner.manager,
      );
      const createdUser = queryRunner.manager.getRepository(User).findOne({
        where: { id: user.id },
        relations: { userApplications: { application: true } },
      });
      await queryRunner.commitTransaction();

      return createdUser;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (!queryRunner.isReleased) await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Error create user/apps');
    } finally {
      await queryRunner.release();
    }
  }

  async updateUserWithApplications(id: string, dto: UpdateUserWithAccessDto) {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const user = await this.userService.update(id, dto, queryRunner.manager);

      if (dto.applicationIds) {
        await this.syncUserApplications(
          {
            userId: user.id,
            applicationIds: dto.applicationIds,
          },
          queryRunner.manager,
        );
      }

      const updatedUser = await queryRunner.manager.getRepository(User).findOne({
        where: { id: user.id },
        relations: { userApplications: { application: true } },
      });

      await queryRunner.commitTransaction();
      return updatedUser;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Error update user/apps');
    } finally {
      await queryRunner.release();
    }
  }

  private async syncUserApplications(dto: { userId: string; applicationIds: number[] }, manager?: EntityManager) {
    const userAppRepo = manager ? manager.getRepository(UserApplication) : this.userAppRepository;

    const appRepo = manager ? manager.getRepository(Application) : this.appRepository;

    const { userId, applicationIds } = dto;

    const applications = await appRepo.find({
      where: { id: In(applicationIds) },
    });

    if (applications.length !== applicationIds.length) {
      throw new BadRequestException('Some applications do not exist');
    }

    const current = await userAppRepo.find({
      where: { user: { id: userId } },
      relations: { application: true },
    });

    const currentIds = new Set(current.map((a) => a.application.id));
    const desiredIds = new Set(applicationIds);

    const toRemove = current.filter((a) => !desiredIds.has(a.application.id));

    const toAdd = applications
      .filter((app) => !currentIds.has(app.id))
      .map((app) =>
        userAppRepo.create({
          user: { id: userId },
          application: app,
        }),
      );

    if (toRemove.length) {
      await userAppRepo.remove(toRemove);
    }

    if (toAdd.length) {
      await userAppRepo.save(toAdd);
    }
  }
}
