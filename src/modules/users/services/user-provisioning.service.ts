import { Injectable } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { CreateUserWithAccessDto, UpdateUserWithAccessDto } from 'src/modules/access/dtos';
import { userCredentialsTemplate } from '../templates/credentials.template';
import { PrinterService } from 'src/modules/printer/printer.service';
import { AccessService } from 'src/modules/access/services';
import { UsersService } from './users.service';

@Injectable()
export class UserProvisioningService {
  constructor(
    private dataSource: DataSource,
    private printer: PrinterService,
    private usersService: UsersService,
    private accessService: AccessService,
  ) {}

  async provisionUserWithApplications(dto: CreateUserWithAccessDto) {
    const { applicationIds, ...userDto } = dto;
    const result = await this.dataSource.transaction(async (manager) => {
      const data = await this.usersService.create(userDto, manager);
      await this.accessService.syncApplications(data.user.id, applicationIds, manager);
      return data;
    });

    const pdfContent = userCredentialsTemplate({
      fullName: result.user.fullName,
      login: result.user.login,
      password: result.password,
    });

    const user = await this.usersService.findOneWithApplications(result.user.id);

    const pdfBuffer = await this.printer.createPdfBuffer(pdfContent);

    return { user, credentialsPdfBase64: pdfBuffer.toString('base64') };
  }

  async updateUserWithApplications(id: string, dto: UpdateUserWithAccessDto) {
    const { applicationIds, ...userDto } = dto;
    const user = await this.dataSource.transaction(async (manager) => {
      const user = await this.usersService.update(id, userDto, manager);
      if (applicationIds?.length) {
        await this.accessService.syncApplications(user.id, applicationIds, manager);
      }
      return this.usersService.findOneWithApplications(user.id, manager);
    });
    return { user };
  }

  async resetTemporaryCredentials(id: string) {
    const { user, password } = await this.usersService.resetTemporaryPassword(id);

    const pdfContent = userCredentialsTemplate({
      fullName: user.fullName,
      login: user.login,
      password: password,
    });

    const pdfBuffer = await this.printer.createPdfBuffer(pdfContent);

    return {
      credentialsPdfBase64: pdfBuffer.toString('base64'),
      message: 'Credentials reset successfully',
    };
  }
}
