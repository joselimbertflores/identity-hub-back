# Visión general

SIAU centraliza identidad y acceso para aplicaciones institucionales. Autentica usuarios, administra credenciales y asignaciones de acceso, mantiene una sesión SSO en su dominio y coordina el cierre de las sesiones participantes.

Expone un perfil OpenID Connect mínimo: Authorization Code con PKCE S256, `scope=openid` y tokens firmados con RS256. No pretende ser un proveedor genérico: no ofrece discovery, UserInfo, scopes adicionales, registro dinámico ni refresh tokens.

Cada aplicación mantiene su propia sesión server-side, usuarios locales cuando corresponda, roles, permisos y reglas de negocio. SIAU establece la identidad y controla el acceso a la aplicación; el cliente decide qué puede hacer el usuario dentro de ella.

## Componentes

| Componente | Responsabilidad |
| --- | --- |
| UI de SIAU | Login, portal, contraseñas y administración. |
| API de SIAU | Identidad, credenciales, acceso, OIDC y sesiones centrales. |
| PostgreSQL | Usuarios, aplicaciones, asignaciones y enlaces de contraseña. |
| Redis | Sesiones, solicitudes OIDC, códigos temporales y participantes de SSO. |
| Backend cliente | Integración OIDC y sesiones locales. |

Redis forma parte del estado de seguridad: perderlo cierra sesiones e invalida solicitudes y códigos temporales. Las fuentes institucionales de identidad se consultan desde el backend; las altas administrativas verifican esa identidad y las importaciones controladas son procesos independientes.

## Identidad y acceso

- `sub`: identificador OIDC estable del usuario en SIAU.
- `externalKey`: identidad institucional estable para vincular usuarios en las aplicaciones.
- `relationKey`: vínculo interno con la fuente institucional de personas.
- `login`: identificador de autenticación que puede cambiar.
- `sid`: correlación entre una sesión SSO y sus sesiones locales participantes.

Una autorización requiere usuario y aplicación activos, además de una asignación vigente, incluso al reutilizar SSO. Cada aplicación registra sus callbacks exactos y credenciales; retirar una asignación revoca solo la participación de ese cliente. Desactivar la aplicación impide nuevas autorizaciones y canjes.

## Contraseñas e invalidación

Alta y recuperación comparten el concepto de `password_action_token`: cada usuario tiene como máximo un enlace temporal vigente para establecer una contraseña. Emitir uno nuevo reemplaza al anterior; consumirlo correctamente establece la contraseña y elimina el enlace.

“No puedo acceder” es el mecanismo de recuperación autoservicio, también cuando el enlace de alta venció o no llegó. Solicitarlo no cambia la contraseña ni cierra sesiones. El cambio voluntario requiere una sesión autenticada, afecta solo a esa cuenta y no exige la contraseña anterior. No existen `mustChangePassword`, reset administrativo ni reenvío administrativo.

El límite del cambio voluntario se aplica por usuario autenticado, compartido entre sus sesiones e independiente de la IP. La protección CSRF del endpoint se apoya en `PATCH` y la política CORS existente.

`credentialVersion` invalida sesiones y códigos anteriores tras un cambio real de credenciales. Establecer o cambiar la contraseña elimina enlaces pendientes y revoca las sesiones anteriores con Single Logout; el cambio voluntario crea una nueva sesión para quien lo realiza. Desactivar la cuenta también incrementa la versión, elimina el enlace y revoca sesiones; reactivarla no las restaura. Cambiar el correo invalida el enlace enviado a la dirección anterior.

## Documentación y configuración

- [SSO, OIDC y Single Logout](sso-flow.md): protocolo, reutilización de sesión y revocación.
- [Integración de una aplicación cliente](client-integration.md): instrucciones completas para el backend de otra aplicación.
- [`.env.template`](../../.env.template): configuración disponible, validada al arrancar por [`env.validation.ts`](../../src/config/env.validation.ts).
