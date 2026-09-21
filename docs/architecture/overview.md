# Visión general

SIAU centraliza identidad y acceso para aplicaciones cliente. Autentica usuarios, mantiene una sesión SSO en su propio dominio y emite credenciales OAuth a clientes autorizados.

No es un proveedor OpenID Connect completo: no emite `id_token`, no publica discovery y no implementa scopes ni `userinfo`.

## Límites y responsabilidades

SIAU:

- administra usuarios, credenciales, aplicaciones y asignaciones de acceso;
- ejecuta Authorization Code con PKCE S256;
- emite access tokens JWT RS256 y refresh tokens rotativos;
- publica el JWKS para validar access tokens y Logout Tokens;
- mantiene la sesión SSO y coordina Single Logout;
- gestiona activación inicial, cambio y recuperación de contraseña;
- integra fuentes institucionales de identidad detrás de su propio backend.

Cada aplicación cliente mantiene su sesión, usuarios locales cuando corresponda, roles, permisos y reglas de negocio. La sesión central no reemplaza la sesión local. La guía del integrador está en [Integración de una aplicación cliente](client-integration.md).

## Componentes

| Componente | Responsabilidad |
| --- | --- |
| UI de SIAU | Login, portal, contraseñas y administración. |
| API de SIAU | Sesiones, OAuth, usuarios, aplicaciones, asignaciones y JWKS. |
| PostgreSQL | Estado persistente de usuarios, aplicaciones, asignaciones y acciones de contraseña. |
| Redis | Sesiones centrales, estado OAuth temporal, codes, refresh tokens e índices de revocación. |
| Backend cliente | Estado PKCE, callback, tokens y sesión local. |

Redis forma parte del estado de seguridad y no es solo caché: perderlo cierra sesiones e invalida credenciales temporales. El consumo de authorization codes, la rotación de refresh tokens y las comprobaciones ligadas a la sesión se realizan de forma atómica.

## Identidad y aprovisionamiento

Los identificadores tienen responsabilidades diferentes:

- `externalKey` es la identidad estable que persisten las aplicaciones cliente;
- `relationKey` vincula internamente la cuenta con una fuente institucional de personas y puede faltar en cuentas históricas;
- `login` sirve para autenticarse y puede cambiar;
- `sub` identifica al usuario dentro de esta instancia de SIAU.

Las altas administrativas verifican la identidad contra la fuente institucional desde el backend. La interfaz de SIAU no consulta esa fuente directamente ni considera autoritativos los resultados que devuelve una búsqueda previa. Los procesos controlados de importación son independientes de las altas nuevas.

Una aplicación solo puede obtener o refrescar credenciales para usuarios activos que tenga asignados. El directorio server-to-server `/internal/users/assignable` aplica la misma asignación y permite a un cliente confidencial preparar vinculaciones por `externalKey`; no expone roles internos de SIAU ni sustituye la autorización local.

## Aplicaciones cliente

El registro de una aplicación define:

- `clientId` único, nombre y `launchUrl`;
- una o más `redirectUris` exactas;
- condición de cliente confidencial y secreto;
- `backchannelLogoutUri` opcional;
- estado activo o inactivo y usuarios asignados.

El secreto se devuelve al crear o regenerar la aplicación y se persiste únicamente como hash. Debe entregarse al backend cliente por un canal seguro. Desactivar la aplicación impide nuevas autorizaciones y renovaciones.

## Sesiones, credenciales y revocación

La sesión central contiene la identidad del usuario, su versión de credenciales, un `sid` y los clientes participantes. Tiene expiración absoluta y se correlaciona con las sesiones locales mediante `sid`.

`credentialVersion` permite invalidar sesiones y refresh tokens cuando cambia el estado de seguridad del usuario. Desactivar una cuenta o restablecer administrativamente su contraseña incrementa esa versión; reactivar la cuenta no restaura las credenciales anteriores.

Las acciones de configuración inicial y recuperación son autorizaciones efímeras almacenadas como hash. Consumir una acción actualiza la contraseña, incrementa `credentialVersion`, elimina acciones pendientes y no inicia sesión automáticamente. La recuperación pública responde de forma neutra para no revelar si una cuenta existe.

El flujo completo de autorización, refresh y logout está en [SSO, OAuth y Single Logout](sso-flow.md).

## Configuración y seguridad

La fuente completa de variables es [`.env.template`](../../.env.template) y el arranque las valida en [`env.validation.ts`](../../src/config/env.validation.ts).

Decisiones relevantes:

- `IDENTITY_HUB_PUBLIC_URL` es la URL pública del API y el valor exacto de `iss`.
- `IDENTITY_HUB_UI_URL` define el origen y las rutas de la UI; CORS se limita a ese origen cuando difiere del API.
- `DATABASE_*` configura PostgreSQL y `DATABASE_SYNCHRONIZE` debe ser `false` en producción.
- `REDIS_URL` acepta `redis://` o `rediss://`.
- `JWT_PRIVATE_KEY_PATH` y `JWT_PUBLIC_KEY_PATH` deben apuntar al mismo par RSA; la clave privada queda fuera del repositorio y con acceso restringido.
- El JWKS actual publica una clave con `kid=main-key`; rotar clave o `kid` exige coordinación con los clientes.
- HTTPS es la configuración recomendada porque se transportan credenciales, cookies y tokens.
- La cookie central `session_id` es `HttpOnly`; `IDENTITY_COOKIE_SECURE` y `IDENTITY_COOKIE_SAME_SITE` deben coincidir con la topología.
- Las credenciales SMTP se configuran ambas o ninguna.

## Contratos que requieren migración coordinada

- issuer, RS256, `kid` y JWKS;
- audiencia y claims del access token;
- `externalKey` como identidad estable de integración;
- coincidencia exacta de `redirect_uri`;
- parámetros OAuth, PKCE S256 y respuestas de tokens;
- rutas `/oauth/authorize`, `/oauth/token` y `/.well-known/jwks.json`;
- rotación y revocación de refresh tokens;
- correlación por `sid` y formato del Logout Token.
