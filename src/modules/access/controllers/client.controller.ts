import { Body, Get, Post, Query, Param, Patch, Controller, ParseIntPipe } from '@nestjs/common';

import { CreateApplicationDto, UpdateClientDto } from '../dtos';
import { RequiredRole } from 'src/modules/auth/decorators';
import { PaginationParamsDto } from 'src/modules/common';
import { UserRole } from 'src/modules/users/entities';
import { ApplicationService } from '../services';

@RequiredRole(UserRole.ADMIN)
@Controller('applications')
export class ClientController {
  constructor(private readonly applicationService: ApplicationService) {}

  @Post()
  create(@Body() createClientDto: CreateApplicationDto) {
    return this.applicationService.create(createClientDto);
  }

  @Get()
  findAll(@Query() queryParams: PaginationParamsDto) {
    return this.applicationService.findAll(queryParams);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateClientDto: UpdateClientDto) {
    return this.applicationService.update(+id, updateClientDto);
  }

  @Post(':id/regenerate-secret')
  regenerateSecret(@Param('id', ParseIntPipe) id: number) {
    return this.applicationService.regenerateSecret(id);
  }

  @Get('active')
  getApplications() {
    return this.applicationService.getAllActive();
  }
}
