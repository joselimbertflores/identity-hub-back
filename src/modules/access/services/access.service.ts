import { Injectable, BadRequestException } from '@nestjs/common';

import { EntityManager, In } from 'typeorm';

import { Application, UserApplication } from '../entities';

@Injectable()
export class AccessService {
  constructor() {}

  async syncApplications(userId: string, applicationIds: number[], manager: EntityManager): Promise<void> {
    const userApprepository = manager.getRepository(UserApplication);
    const appRepository = manager.getRepository(Application);

    const uniqueIds = [...new Set(applicationIds)];

    const applications = await appRepository.find({ where: { id: In(uniqueIds) }, select: ['id'] });

    if (applications.length !== uniqueIds.length) {
      throw new BadRequestException('One or more applications are invalid');
    }

    const currentRelations = await userApprepository.find({ where: { userId }, select: ['id', 'applicationId'] });

    const currentIds = currentRelations.map((item) => item.applicationId);

    const idsToAdd = uniqueIds.filter((id) => !currentIds.includes(id));
    const idsToRemove = currentIds.filter((id) => !uniqueIds.includes(id));

    if (idsToRemove.length > 0) {
      await userApprepository.delete({ userId, applicationId: In(idsToRemove) });
    }

    if (idsToAdd.length > 0) {
      const rows = idsToAdd.map((applicationId) => userApprepository.create({ userId, applicationId }));
      await userApprepository.save(rows);
    }
  }

  // async provisionUserWithApplications(dto: CreateUserWithAccessDto) {
  //   const queryRunner = this.dataSource.createQueryRunner();

  //   await queryRunner.connect();
  //   await queryRunner.startTransaction();

  //   try {
  //     const { user, password } = await this.userService.create(dto, queryRunner.manager);

  //     await this.syncUserApplications(
  //       {
  //         userId: user.id,
  //         applicationIds: dto.applicationIds,
  //       },
  //       queryRunner.manager,
  //     );
  //     const createdUser = await queryRunner.manager.getRepository(User).findOne({
  //       where: { id: user.id },
  //       relations: { userApplications: { application: true } },
  //     });

  //     await queryRunner.commitTransaction();

  //     const pdf = await this.generatePdf({ ...user, password });
  //     return { user: createdUser, credentialsPdfBase64: pdf.toString('base64') };
  //   } catch (error) {
  //     if (error instanceof HttpException) throw error;
  //     if (!queryRunner.isReleased) await queryRunner.rollbackTransaction();
  //     throw new InternalServerErrorException('Error create user/apps');
  //   } finally {
  //     await queryRunner.release();
  //   }
  // }

  // async updateUserWithApplications(id: string, dto: UpdateUserWithAccessDto) {
  //   const queryRunner = this.dataSource.createQueryRunner();

  //   await queryRunner.connect();
  //   await queryRunner.startTransaction();

  //   try {
  //     const user = await this.userService.update(id, dto, queryRunner.manager);

  //     if (dto.applicationIds) {
  //       await this.syncUserApplications(
  //         {
  //           userId: user.id,
  //           applicationIds: dto.applicationIds,
  //         },
  //         queryRunner.manager,
  //       );
  //     }

  //     const updatedUser = await queryRunner.manager.getRepository(User).findOne({
  //       where: { id: user.id },
  //       relations: { userApplications: { application: true } },
  //     });

  //     await queryRunner.commitTransaction();
  //     return updatedUser;
  //   } catch (error) {
  //     if (error instanceof HttpException) throw error;
  //     await queryRunner.rollbackTransaction();
  //     throw new InternalServerErrorException('Error update user/apps');
  //   } finally {
  //     await queryRunner.release();
  //   }
  // }

  // async resetCredentials(userId: string) {
  //   const { user, password } = await this.userService.resetPassword(userId);

  //   const pdfBuffer = await this.generatePdf({ ...user, password });

  //   return {
  //     user,
  //     credentialsPdfBase64: pdfBuffer.toString('base64'),
  //   };
  // }

  // private async syncUserApplications(dto: { userId: string; applicationIds: number[] }, manager?: EntityManager) {
  //   const userAppRepo = manager ? manager.getRepository(UserApplication) : this.userAppRepository;

  //   const appRepo = manager ? manager.getRepository(Application) : this.appRepository;

  //   const { userId, applicationIds } = dto;

  //   const applications = await appRepo.find({
  //     where: { id: In(applicationIds) },
  //   });

  //   if (applications.length !== applicationIds.length) {
  //     throw new BadRequestException('Some applications do not exist');
  //   }

  //   const current = await userAppRepo.find({
  //     where: { user: { id: userId } },
  //     relations: { application: true },
  //   });

  //   const currentIds = new Set(current.map((a) => a.application.id));
  //   const desiredIds = new Set(applicationIds);

  //   const toRemove = current.filter((a) => !desiredIds.has(a.application.id));

  //   const toAdd = applications
  //     .filter((app) => !currentIds.has(app.id))
  //     .map((app) =>
  //       userAppRepo.create({
  //         user: { id: userId },
  //         application: app,
  //       }),
  //     );

  //   if (toRemove.length) {
  //     await userAppRepo.remove(toRemove);
  //   }

  //   if (toAdd.length) {
  //     await userAppRepo.save(toAdd);
  //   }
  // }

  // private async generatePdf({ fullName, login, password }: User) {
  //   const pdfContent = userCredentialsTemplate({ fullName, login, password });
  //   const pdfBuffer = await this.printer.createPdfBuffer(pdfContent);
  //   return pdfBuffer;
  // }
}
