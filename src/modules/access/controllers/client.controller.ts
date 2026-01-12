import { Body, Get, Post, Query, Param, Patch, Controller } from '@nestjs/common';

import { PaginationParamsDto } from 'src/modules/common';
import { ApplicationService } from '../services';
import { CreateApplicationDto, UpdateClientDto } from '../dtos';
import { RequiredRole } from 'src/modules/auth/decorators';
import { UserRole } from 'src/modules/users/entities';

@RequiredRole(UserRole.ADMIN)
@Controller('clients')
export class ClientController {
  constructor(private readonly clientService: ApplicationService) {}

  @Post()
  create(@Body() createClientDto: CreateApplicationDto) {
    return this.clientService.create(createClientDto);
  }

  @Get()
  findAll(@Query() queryParams: PaginationParamsDto) {
    return this.clientService.findAll(queryParams);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateClientDto: UpdateClientDto) {
    return this.clientService.update(+id, updateClientDto);
  }
}
