import type { MailContent } from 'src/modules/mail';
import type { User } from 'src/modules/users/entities';

import { PasswordActionPurpose } from '../entities';
import type { IssuedPasswordAction } from '../interfaces';

const SYSTEM_NAME = 'Sistema de Identidad y Acceso Unificado';
const SYSTEM_SHORT_NAME = 'SIAU';
const UNIT_NAME = 'Unidad de Gobierno Electrónico';
const INSTITUTION_NAME = 'Gobierno Autónomo Municipal de Sacaba';

export function buildPasswordActionEmail(
  { fullName, login }: Pick<User, 'fullName' | 'login'>,
  action: IssuedPasswordAction,
): MailContent {
  const isInitialSetup = action.purpose === PasswordActionPurpose.INITIAL_SETUP;
  const subject = isInitialSetup ? 'Configura tu acceso al SIAU' : 'Restablece tu contraseña del SIAU';
  const introduction = isInitialSetup
    ? `Tu acceso al ${SYSTEM_NAME} está disponible.`
    : 'Recibimos una solicitud para restablecer la contraseña de tu cuenta.';
  const actionInstruction = isInitialSetup
    ? 'Configura tu contraseña mediante el siguiente enlace:'
    : 'Restablece tu contraseña mediante el siguiente enlace:';
  const buttonLabel = isInitialSetup ? 'Configurar contraseña' : 'Restablecer contraseña';
  const ignoreMessage = isInitialSetup
    ? 'Si no reconoces este mensaje, puedes ignorarlo.'
    : 'Si no realizaste esta solicitud, puedes ignorar este correo.';
  const expiresAt = formatBoliviaDate(action.expiresAt);
  const safeName = escapeHtml(fullName);
  const safeLogin = escapeHtml(login);
  const safeActionUrl = escapeHtml(action.actionUrl);
  const safeExpiresAt = escapeHtml(expiresAt);

  return {
    subject,
    text: [
      `${SYSTEM_NAME} (${SYSTEM_SHORT_NAME})`,
      '',
      `Hola ${fullName},`,
      '',
      introduction,
      '',
      'Usuario',
      login,
      '',
      actionInstruction,
      action.actionUrl,
      '',
      `El enlace vence el ${expiresAt} (hora de Bolivia).`,
      '',
      ignoreMessage,
      '',
      UNIT_NAME,
      INSTITUTION_NAME,
    ].join('\n'),
    html: buildEmailLayout(
      [
        `<p style="margin:0 0 20px;color:#111827;font-size:16px;line-height:24px;">Hola ${safeName},</p>`,
        `<p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:24px;">${introduction}</p>`,
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;background-color:#f7faf9;border:1px solid #dce7e2;border-radius:6px;">',
        '<tr><td style="padding:16px 18px;">',
        '<p style="margin:0 0 4px;color:#6b7280;font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:0.6px;">Usuario</p>',
        `<p style="margin:0;color:#111827;font-family:Consolas,Monaco,'Courier New',monospace;font-size:18px;font-weight:700;line-height:26px;word-break:break-word;">${safeLogin}</p>`,
        '</td></tr></table>',
        `<p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:24px;">${actionInstruction}</p>`,
        '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">',
        `<tr><td bgcolor="#16794f" style="border-radius:6px;text-align:center;"><a href="${safeActionUrl}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;">${buttonLabel}</a></td></tr>`,
        '</table>',
        `<p style="margin:0 0 22px;color:#374151;font-size:14px;line-height:22px;"><strong style="color:#111827;">Vencimiento:</strong><br>${safeExpiresAt} (hora de Bolivia)</p>`,
        '<p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:20px;">Si el botón no funciona, copia y pega esta dirección completa en tu navegador:</p>',
        `<p style="margin:0 0 24px;font-size:13px;line-height:20px;word-break:break-all;"><a href="${safeActionUrl}" style="color:#146c49;text-decoration:underline;">${safeActionUrl}</a></p>`,
        `<p style="margin:0;color:#6b7280;font-size:13px;line-height:20px;">${ignoreMessage}</p>`,
      ].join(''),
    ),
  };
}

export function buildPasswordChangedEmail(fullName: string): MailContent {
  const safeName = escapeHtml(fullName);

  return {
    subject: 'Tu contraseña del SIAU fue actualizada',
    text: [
      `${SYSTEM_NAME} (${SYSTEM_SHORT_NAME})`,
      '',
      `Hola ${fullName},`,
      '',
      'Tu contraseña del SIAU fue actualizada correctamente.',
      'Si realizaste este cambio, no necesitas hacer nada.',
      'Si no reconoces esta actividad, comunícate con la Unidad de Gobierno Electrónico.',
      '',
      UNIT_NAME,
      INSTITUTION_NAME,
    ].join('\n'),
    html: buildEmailLayout(
      [
        `<p style="margin:0 0 20px;color:#111827;font-size:16px;line-height:24px;">Hola ${safeName},</p>`,
        '<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:24px;">Tu contraseña del SIAU fue actualizada correctamente.</p>',
        '<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:24px;">Si realizaste este cambio, no necesitas hacer nada.</p>',
        '<p style="margin:0;color:#374151;font-size:15px;line-height:24px;">Si no reconoces esta actividad, comunícate con la Unidad de Gobierno Electrónico.</p>',
      ].join(''),
    ),
  };
}

function buildEmailLayout(content: string): string {
  return [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${SYSTEM_SHORT_NAME}</title>`,
    '</head>',
    '<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f3f4f6" style="width:100%;background-color:#f3f4f6;">',
    '<tr><td align="center" style="padding:32px 12px;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">',
    '<tr><td style="padding:24px 28px;border-bottom:1px solid #e5e7eb;">',
    `<p style="margin:0 0 4px;color:#173d31;font-size:17px;font-weight:700;line-height:24px;">${SYSTEM_NAME}</p>`,
    `<p style="margin:0;color:#6b7280;font-size:12px;font-weight:700;line-height:18px;letter-spacing:1px;">${SYSTEM_SHORT_NAME}</p>`,
    '</td></tr>',
    `<tr><td style="padding:28px;">${content}</td></tr>`,
    '<tr><td style="padding:20px 28px;background-color:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px;">',
    `<p style="margin:0 0 3px;color:#4b5563;font-size:12px;font-weight:700;line-height:18px;">${UNIT_NAME}</p>`,
    `<p style="margin:0;color:#6b7280;font-size:12px;line-height:18px;">${INSTITUTION_NAME}</p>`,
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('');
}

function formatBoliviaDate(value: Date): string {
  const date = new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(value);
  const time = new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);

  return `${date}, ${time}`;
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
