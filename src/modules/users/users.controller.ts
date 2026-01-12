import { Get, Query, Controller } from '@nestjs/common';

import { UsersService } from './users.service';
import { PaginationParamsDto } from '../common';
import { RequiredRole } from '../auth/decorators';
import { UserRole } from './entities';

@RequiredRole(UserRole.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(@Query() paginationParams: PaginationParamsDto) {
    return this.usersService.findAll(paginationParams);
  }
}
