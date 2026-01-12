import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import { UserRole } from 'src/modules/users/entities';
import { RoleGuard } from '../guards';

export const REQUIRED_ROLE = 'required-role';

export function RequiredRole(role: UserRole) {
  return applyDecorators(SetMetadata(REQUIRED_ROLE, role), UseGuards(RoleGuard));
}
