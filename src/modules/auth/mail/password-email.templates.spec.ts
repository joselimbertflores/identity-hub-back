import { PasswordActionPurpose } from '../entities';
import type { IssuedPasswordAction } from '../interfaces';
import { buildPasswordActionEmail, buildPasswordChangedEmail } from './password-email.templates';

describe('password email templates', () => {
  const expiresAt = new Date('2026-08-04T12:00:00.000Z');
  const actionUrl = 'https://identity.example/set-password?code=<code>&source="email"';

  function createAction(purpose: PasswordActionPurpose): IssuedPasswordAction {
    return {
      purpose,
      code: 'ABCDE-FGHJK-MNPQR-STVWX-YZ234-56789',
      actionUrl,
      expiresAt,
    };
  }

  it('builds the initial password setup email', () => {
    const email = buildPasswordActionEmail('User & <Admin>', createAction(PasswordActionPurpose.INITIAL_SETUP));

    expect(email.subject).toBe('Configura tu contraseña de Identity Hub');
    expect(email.text).toContain('Usa el siguiente enlace para configurar tu contraseña inicial:');
    expect(email.text).toContain(actionUrl);
    expect(email.html).toContain('User &amp; &lt;Admin&gt;');
    expect(email.html).toContain('code=&lt;code&gt;&amp;source=&quot;email&quot;');
    expect(email.html).toContain(expiresAt.toISOString());
  });

  it('builds the password reset email', () => {
    const email = buildPasswordActionEmail('Client User', createAction(PasswordActionPurpose.PASSWORD_RESET));

    expect(email.subject).toBe('Restablece tu contraseña de Identity Hub');
    expect(email.text).toContain('Usa el siguiente enlace para restablecer tu contraseña:');
    expect(email.html).toContain('Usa el siguiente enlace para restablecer tu contraseña:');
  });

  it('builds the password changed email', () => {
    const email = buildPasswordChangedEmail('User & <Admin>');

    expect(email.subject).toBe('Tu contraseña de Identity Hub fue modificada');
    expect(email.text).toContain('Tu contraseña de Identity Hub fue modificada correctamente.');
    expect(email.html).toContain('User &amp; &lt;Admin&gt;');
    expect(email.html).toContain('contacta al administrador institucional');
  });
});
