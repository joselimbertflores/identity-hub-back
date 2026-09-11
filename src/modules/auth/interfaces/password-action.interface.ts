import type { PasswordActionPurpose } from '../entities';

export interface IssuedPasswordAction {
  purpose: PasswordActionPurpose;
  code: string;
  actionUrl: string;
  expiresAt: Date;
}

export interface PasswordActionDelivery {
  method: 'EMAIL';
  status: 'SENT' | 'FAILED';
  expiresAt: string;
}
