import { InjectRepository } from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';

import { Application } from '../entities';

@Injectable()
export class AccessPortalService {
  constructor(@InjectRepository(Application) private readonly applicationRepository: Repository<Application>) {}

  async getUserApplications(userId: string) {
    return this.applicationRepository.find({
      where: { users: { id: userId }, isActive: true },
      select: ['name', 'description', 'launchUrl', 'color'],
    });
  }
}
