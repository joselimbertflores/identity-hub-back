import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { ILike, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

import { PaginationParamsDto } from 'src/modules/common';
import { CreateApplicationDto, UpdateClientDto } from '../dtos';
import { Application } from '../entities';

@Injectable()
export class ApplicationService {
  constructor(
    @InjectRepository(Application)
    private clientRepository: Repository<Application>,
  ) {}

  async create(clientDto: CreateApplicationDto) {
    const rawSecret = randomBytes(32).toString('hex');
    const hashedSecret = await bcrypt.hash(rawSecret, 10);
    const model = this.clientRepository.create({ ...clientDto, clientSecret: hashedSecret });
    const application = await this.clientRepository.save(model);
    return { application, secret: rawSecret };
  }

  async update(id: number, clientDto: UpdateClientDto) {
    const clientDB = await this.clientRepository.findOneBy({ id });

    if (!clientDB) throw new NotFoundException(`Client ${id} not found`);

    return await this.clientRepository.save({
      ...clientDB,
      ...clientDto,
    });
  }

  async findAll(paginationDto: PaginationParamsDto) {
    const { limit, offset, term } = paginationDto;
    const [clients, total] = await this.clientRepository.findAndCount({
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

  async getAllActive() {
    const result = await this.clientRepository.find({
      where: { isActive: true },
    });
    return result;
  }
}
