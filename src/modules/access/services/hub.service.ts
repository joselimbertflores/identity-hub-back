import { InjectRepository } from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';

import { Application } from '../entities';

@Injectable()
export class HubService {
  constructor(@InjectRepository(Application) private appResository: Repository<Application>) {}

  async getUserApplications(userId: string) {
    return await this.appResository.find({
      where: { users: { id: userId } },
      select: ['name', 'description', 'launchUrl', 'color'],
    });
  }
}
