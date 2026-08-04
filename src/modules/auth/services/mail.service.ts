import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import nodemailer, { Transporter } from 'nodemailer';

import { EnvironmentVariables } from 'src/config';
import { PasswordActionPurpose } from '../entities';
import type { IssuedPasswordAction } from '../interfaces';
import type { User } from 'src/modules/users/entities';

@Injectable()
export class MailService {
  private readonly transporter: Transporter;
  private readonly from: { address: string; name: string };

  constructor(private readonly configService: ConfigService<EnvironmentVariables, true>) {
    const username = this.configService.get('SMTP_USERNAME', { infer: true });
    const password = this.configService.get('SMTP_PASSWORD', { infer: true });

    this.transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow('SMTP_HOST', { infer: true }),
      port: this.configService.getOrThrow('SMTP_PORT', { infer: true }),
      secure: this.configService.getOrThrow('SMTP_SECURE', { infer: true }),
      ...(username && password ? { auth: { user: username, pass: password } } : {}),
    });
    this.from = {
      address: this.configService.getOrThrow('SMTP_FROM_ADDRESS', { infer: true }),
      name: this.configService.getOrThrow('SMTP_FROM_NAME', { infer: true }),
    };
  }

  async sendPasswordAction(user: Pick<User, 'email' | 'fullName'>, action: IssuedPasswordAction): Promise<void> {
    if (!user.email) return;

    const isInitialSetup = action.purpose === PasswordActionPurpose.INITIAL_SETUP;
    const purposeText = isInitialSetup ? 'configurar tu contraseña inicial' : 'restablecer tu contraseña';
    const subject = isInitialSetup
      ? 'Configura tu contraseña de Identity Hub'
      : 'Restablece tu contraseña de Identity Hub';
    const expiresAt = action.expiresAt.toISOString();
    const safeName = this.escapeHtml(user.fullName);
    const safeActionUrl = this.escapeHtml(action.actionUrl);

    await this.transporter.sendMail({
      from: this.from,
      to: user.email,
      subject,
      text: [
        `Hola ${user.fullName},`,
        '',
        `Usa el siguiente enlace para ${purposeText}:`,
        action.actionUrl,
        '',
        `El enlace vence el ${expiresAt}.`,
        'Si no reconoces esta acción, ignora este mensaje.',
      ].join('\n'),
      html: [
        `<p>Hola ${safeName},</p>`,
        `<p>Usa el siguiente enlace para ${this.escapeHtml(purposeText)}:</p>`,
        `<p><a href="${safeActionUrl}">${safeActionUrl}</a></p>`,
        `<p>El enlace vence el ${this.escapeHtml(expiresAt)}.</p>`,
        '<p>Si no reconoces esta acción, ignora este mensaje.</p>',
      ].join(''),
    });
  }

  async sendPasswordChanged(user: Pick<User, 'email' | 'fullName'>): Promise<void> {
    if (!user.email) return;

    const safeName = this.escapeHtml(user.fullName);
    await this.transporter.sendMail({
      from: this.from,
      to: user.email,
      subject: 'Tu contraseña de Identity Hub fue modificada',
      text: [
        `Hola ${user.fullName},`,
        '',
        'Tu contraseña de Identity Hub fue modificada correctamente.',
        'Si no reconoces este cambio, contacta al administrador institucional.',
      ].join('\n'),
      html: [
        `<p>Hola ${safeName},</p>`,
        '<p>Tu contraseña de Identity Hub fue modificada correctamente.</p>',
        '<p>Si no reconoces este cambio, contacta al administrador institucional.</p>',
      ].join(''),
    });
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, (character) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      };
      return entities[character];
    });
  }
}
