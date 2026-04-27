import { Injectable, BadRequestException } from '@nestjs/common';

import { EntityManager, In } from 'typeorm';

import { User } from 'src/modules/users/entities';
import { Application } from '../entities';

@Injectable()
export class AccessService {
  constructor() {}

  async syncApplications(userId: string, applicationIds: number[], manager: EntityManager): Promise<void> {
    const appRepository = manager.getRepository(Application);

    const uniqueIds = [...new Set(applicationIds)];

    const applications =
      uniqueIds.length > 0
        ? await appRepository.find({
            where: { id: In(uniqueIds) },
            select: ['id'],
          })
        : [];

    if (applications.length !== uniqueIds.length) {
      throw new BadRequestException('One or more applications are invalid');
    }

    const currentApplications = await manager
      .createQueryBuilder()
      .relation(User, 'applications')
      .of(userId)
      .loadMany<Application>();

    const currentIds = currentApplications.map((app) => app.id);

    const idsToAdd = uniqueIds.filter((id) => !currentIds.includes(id));
    const idsToRemove = currentIds.filter((id) => !uniqueIds.includes(id));

    if (idsToAdd.length === 0 && idsToRemove.length === 0) {
      return;
    }

    await manager.createQueryBuilder().relation(User, 'applications').of(userId).addAndRemove(idsToAdd, idsToRemove);
  }
}
