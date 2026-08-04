import type { MailContent } from 'src/modules/mail';

import { PasswordActionPurpose } from '../entities';
import type { IssuedPasswordAction } from '../interfaces';

export function buildPasswordActionEmail(fullName: string, action: IssuedPasswordAction): MailContent {
  const isInitialSetup = action.purpose === PasswordActionPurpose.INITIAL_SETUP;
  const purposeText = isInitialSetup ? 'configurar tu contraseña inicial' : 'restablecer tu contraseña';
  const subject = isInitialSetup
    ? 'Configura tu contraseña de Identity Hub'
    : 'Restablece tu contraseña de Identity Hub';
  const expiresAt = action.expiresAt.toISOString();
  const safeName = escapeHtml(fullName);
  const safePurposeText = escapeHtml(purposeText);
  const safeActionUrl = escapeHtml(action.actionUrl);
  const safeExpiresAt = escapeHtml(expiresAt);

  return {
    subject,
    text: [
      `Hola ${fullName},`,
      '',
      `Usa el siguiente enlace para ${purposeText}:`,
      action.actionUrl,
      '',
      `El enlace vence el ${expiresAt}.`,
      'Si no reconoces esta acción, ignora este mensaje.',
    ].join('\n'),
    html: [
      `<p>Hola ${safeName},</p>`,
      `<p>Usa el siguiente enlace para ${safePurposeText}:</p>`,
      `<p><a href="${safeActionUrl}">${safeActionUrl}</a></p>`,
      `<p>El enlace vence el ${safeExpiresAt}.</p>`,
      '<p>Si no reconoces esta acción, ignora este mensaje.</p>',
    ].join(''),
  };
}

export function buildPasswordChangedEmail(fullName: string): MailContent {
  const safeName = escapeHtml(fullName);

  return {
    subject: 'Tu contraseña de Identity Hub fue modificada',
    text: [
      `Hola ${fullName},`,
      '',
      'Tu contraseña de Identity Hub fue modificada correctamente.',
      'Si no reconoces este cambio, contacta al administrador institucional.',
    ].join('\n'),
    html: [
      `<p>Hola ${safeName},</p>`,
      '<p>Tu contraseña de Identity Hub fue modificada correctamente.</p>',
      '<p>Si no reconoces este cambio, contacta al administrador institucional.</p>',
    ].join(''),
  };
}

function escapeHtml(value: string): string {
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
