# Visión general

SIAU centraliza identidad y acceso para aplicaciones institucionales. Autentica usuarios, mantiene una sesión SSO server-side en su propio dominio y expone un perfil OpenID Connect mínimo sobre Authorization Code con PKCE S256.

No pretende ser un proveedor de identidad genérico. No implementa discovery, UserInfo, scopes adicionales, registro dinámico ni `offline_access`.

## Límites y responsabilidades

SIAU:

- administra usuarios, credenciales, aplicaciones y asignaciones de acceso;
- ejecuta Authorization Code con `scope=openid`, `state`, `nonce` y PKCE S256;
- emite `id_token` y `access_token` JWT firmados con RS256;
- publica el JWKS para validar ID Tokens, access tokens y Logout Tokens;
- mantiene la sesión SSO y coordina Single Logout por `sid`;
- gestiona el establecimiento, cambio y recuperación de contraseña;
- integra fuentes institucionales de identidad detrás de su propio backend.

SIAU no emite refresh tokens. Cada aplicación cliente establece y mantiene una sesión local server-side después de validar el `id_token`. El access token sigue formando parte de la respuesta OAuth/OIDC, pero no es la credencial con la que estos clientes mantienen esa sesión.

Cada aplicación conserva sus usuarios locales cuando corresponda, roles, permisos y reglas de negocio. La guía del integrador está en [Integración de una aplicación cliente](client-integration.md).

## Componentes

| Componente | Responsabilidad |
| --- | --- |
| UI de SIAU | Login, portal, contraseñas y administración. |
| API de SIAU | Sesiones, OIDC, usuarios, aplicaciones, asignaciones y JWKS. |
| PostgreSQL | Estado persistente de usuarios, aplicaciones, asignaciones y acciones de contraseña. |
| Redis | Sesiones centrales, solicitudes OIDC pendientes, authorization codes e índices de participantes. |
| Backend cliente | Estado `state`/PKCE/`nonce`, callback, validación del ID Token y sesión local. |

Redis forma parte del estado de seguridad y no es solo caché: perderlo cierra sesiones e invalida solicitudes y códigos temporales. El consumo de un authorization code, la comprobación de la sesión central y el registro del cliente participante se realizan de forma atómica.

## Identidad y aprovisionamiento

Los identificadores tienen responsabilidades diferentes:

- `sub` es el identificador OIDC estable del usuario dentro de SIAU;
- `externalKey` es la identidad institucional estable que persisten las aplicaciones cliente;
- `relationKey` vincula internamente la cuenta con una fuente institucional de personas;
- `login` sirve para autenticarse y puede cambiar;
- `sid` correlaciona una sesión SSO con las sesiones locales participantes.

Las altas administrativas verifican la identidad contra la fuente institucional desde el backend. Los procesos controlados de importación son independientes de las altas nuevas.

Antes de emitir cada authorization code, incluso al reutilizar SSO, SIAU exige que el usuario y la aplicación estén activos y que el usuario continúe asignado a la aplicación. El endpoint server-to-server `/internal/users/assignable` aplica la misma asignación para preparar vinculaciones por `externalKey`.

## Aplicaciones cliente

El registro de una aplicación define:

- `clientId` único, nombre y `launchUrl`;
- una o más `redirectUris` exactas;
- condición de cliente confidencial y secreto;
- `backchannelLogoutUri` opcional;
- estado activo o inactivo y usuarios asignados.

El secreto se devuelve al crear o regenerar la aplicación y se persiste únicamente como hash. Desactivar la aplicación impide nuevas autorizaciones y canjes. Para aplicaciones con asignación, retirarla revoca la participación de ese cliente en las sesiones del usuario y dispara Back-Channel Logout.

## Sesiones y revocación

La sesión central contiene la identidad del usuario, su versión de credenciales y un `sid`. Los clientes se registran como participantes únicamente cuando completan el canje del authorization code.

`credentialVersion` invalida sesiones y códigos emitidos antes del último cambio real de credenciales. Desactivar una cuenta o establecer una nueva contraseña incrementa esa versión y revoca sus sesiones centrales; antes de eliminarlas SIAU conserva los `sid` y clientes participantes para enviar Back-Channel Logout. Reactivar la cuenta no restaura sesiones anteriores.

La creación y recuperación usan el mismo enlace temporal para establecer una contraseña. Solicitar recuperación no invalida la contraseña ni las sesiones actuales; esos efectos ocurren únicamente cuando el enlace se consume correctamente. Desactivar la cuenta o cambiar su correo elimina cualquier enlace pendiente. El detalle está en [Contraseñas](passwords.md).

Los eventos cubiertos son:

- logout explícito, iniciado en SIAU o por un cliente participante;
- desactivación del usuario;
- cambio o restablecimiento de credenciales;
- retiro de acceso del usuario a una aplicación.

El retiro de una asignación elimina solo la participación afectada. Los demás eventos anteriores revocan la sesión central completa. La entrega back-channel es independiente por cliente: un fallo se registra y no revierte la revocación ya aplicada.

## Configuración y seguridad

La fuente completa de variables es [`.env.template`](../../.env.template) y el arranque las valida en [`env.validation.ts`](../../src/config/env.validation.ts).

Decisiones relevantes:

- `IDENTITY_HUB_PUBLIC_URL` es la URL pública canónica de SIAU, la base predeterminada de la UI y el valor exacto de `iss`.
- `IDENTITY_HUB_UI_URL` es un override opcional para la UI cuando usa otro origen; solo en ese caso se habilita CORS con credenciales para ese origen.
- `JWT_PRIVATE_KEY_PATH` y `JWT_PUBLIC_KEY_PATH` apuntan al mismo par RSA.
- El JWKS publica la clave de firma RS256 con `kid=main-key`.
- La cookie central `session_id` es `HttpOnly`; sus opciones `Secure` y `SameSite` dependen del ambiente.
- Las coincidencias de `redirect_uri` son exactas.
- Las solicitudes usan exclusivamente PKCE `S256`.

## Contratos que requieren migración coordinada

- issuer, RS256, `kid` y JWKS;
- `scope=openid`, `nonce`, `state` y PKCE S256;
- respuesta `access_token` + `id_token`, sin refresh token;
- audiencia y claims del ID Token;
- `externalKey` como vínculo institucional estable;
- rutas `/oauth/authorize`, `/oauth/token`, `/.well-known/jwks.json` y `/internal/sessions/logout`;
- correlación por `sid` y formato del Logout Token.

El flujo completo está en [SSO, OIDC y Single Logout](sso-flow.md).
