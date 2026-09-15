import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { compare } from 'bcrypt';
import { Repository } from 'typeorm';

import { Application } from '../entities';
import type { TokenClientAuthentication } from '../../auth/interfaces';

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

    delete (application as Partial<Application>).clientSecretHash;

    return application;
  }

  async authenticateOAuthClient(authentication: TokenClientAuthentication): Promise<Application> {
    if (authentication.method === 'basic') {
      const application = await this.authenticate(authentication.clientId, authentication.clientSecret);
      if (!application.isConfidential) throw new UnauthorizedException('Invalid client authentication method.');
      return application;
    }

    const application = await this.applicationRepository.findOne({
      where: { clientId: authentication.clientId, isActive: true, isConfidential: false },
    });
    if (!application) throw new UnauthorizedException('Invalid client credentials.');
    return application;
  }
}
