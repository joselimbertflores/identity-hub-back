export interface IssuedPasswordAction {
  code: string;
  actionUrl: string;
  expiresAt: Date;
}

export interface PasswordActionDelivery {
  method: 'EMAIL';
  status: 'SENT' | 'FAILED';
  expiresAt: string;
}
