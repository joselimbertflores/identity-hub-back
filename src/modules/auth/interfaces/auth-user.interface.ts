import { UserRole } from 'src/modules/users/entities';

export interface AuthUser {
  id: string;
  fullName: string;
  roles: UserRole[];
  mustChangePassword: boolean;
}
