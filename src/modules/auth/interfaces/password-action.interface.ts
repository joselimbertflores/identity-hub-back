import type { PasswordActionPurpose } from '../entities';

export interface IssuedPasswordAction {
  purpose: PasswordActionPurpose;
  code: string;
  actionUrl: string;
  expiresAt: Date;
}

export type PasswordActionDelivery =
  | {
      method: 'EMAIL';
      status: 'SENT';
      expiresAt: string;
    }
  | {
      method: 'MANUAL';
      code: string;
      actionUrl: string;
      expiresAt: string;
    }
  | {
      method: 'EMAIL';
      status: 'FAILED';
      expiresAt: string;
      fallback: {
        code: string;
        actionUrl: string;
      };
    };
