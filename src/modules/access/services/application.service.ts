import { ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { ILike, QueryFailedError, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

import { PaginationParamsDto } from 'src/modules/common';
import { CreateApplicationDto, UpdateClientDto } from '../dtos';
import { Application } from '../entities';

@Injectable()
export class ApplicationService {
  constructor(@InjectRepository(Application) private applicationRepository: Repository<Application>) {}

  async create(clientDto: CreateApplicationDto) {
    const clientSecret = this.generateClientSecret();
    const clientSecretHash = await this.hashClientSecret(clientSecret);

    const model = this.applicationRepository.create({
      ...clientDto,
      clientSecretHash,
    });

    try {
      const application = await this.applicationRepository.save(model);
      delete (application as Partial<Application>).clientSecretHash;

      return { application, clientSecret };
    } catch (error: unknown) {
      if (error instanceof QueryFailedError && (error.driverError as object)['code'] === '23505') {
        throw new ConflictException('clientId already exists');
      }
      throw new InternalServerErrorException('Could not create application');
    }
  }

  async update(id: number, clientDto: UpdateClientDto) {
    const clientDB = await this.applicationRepository.findOneBy({ id });

    if (!clientDB) throw new NotFoundException(`Client ${id} not found`);

    return await this.applicationRepository.save({
      ...clientDB,
      ...clientDto,
    });
  }

  async findAll(paginationDto: PaginationParamsDto) {
    const { limit, offset, term } = paginationDto;
    const [clients, total] = await this.applicationRepository.findAndCount({
      take: limit,
      skip: offset,
      ...(term && {
        where: { name: ILike(`%${term}%`) },
      }),
      order: {
        createdAt: 'DESC',
      },
    });
    return { clients, total };
  }

  async findOptions() {
    return await this.applicationRepository.find({
      where: { isActive: true },
      select: { id: true, name: true, description: true },
    });
  }

  async regenerateSecret(id: number) {
    const application = await this.applicationRepository.findOne({ where: { id } });

    if (!application) throw new NotFoundException('Application not found');

    const clientSecret = this.generateClientSecret();

    application.clientSecretHash = await this.hashClientSecret(clientSecret);

    await this.applicationRepository.save(application);

    return { clientSecret };
  }

  private generateClientSecret(): string {
    return `idh_sk_${randomBytes(32).toString('hex')}`;
  }

  private async hashClientSecret(clientSecret: string): Promise<string> {
    return bcrypt.hash(clientSecret, 10);
  }
}
