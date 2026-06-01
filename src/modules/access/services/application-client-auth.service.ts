import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { compare } from 'bcrypt';
import { Repository } from 'typeorm';

import { Application } from '../entities';

@Injectable()
export class ApplicationClientAuthService {
  constructor(@InjectRepository(Application) private readonly applicationRepository: Repository<Application>) {}

  async authenticate(clientId: string, clientSecret: string): Promise<Application> {
    const application = await this.applicationRepository
      .createQueryBuilder('application')
      .addSelect('application.clientSecretHash')
      .where('application.clientId = :clientId', { clientId })
      .andWhere('application.isActive = true')
      .getOne();

    if (!application) {
      throw new UnauthorizedException('Invalid client credentials.');
    }

    const isSecretValid = await compare(clientSecret, application.clientSecretHash);
    if (!isSecretValid) {
      throw new UnauthorizedException('Invalid client credentials.');
    }

    return application;
  }
}
