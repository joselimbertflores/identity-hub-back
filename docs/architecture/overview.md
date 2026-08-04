# Visión general

Identity Hub es el punto central de identidad para aplicaciones cliente. Autentica usuarios, mantiene una sesión SSO en su propio dominio y emite credenciales OAuth para los clientes autorizados.

No es un proveedor OpenID Connect completo: no emite `id_token`, no publica discovery y no implementa scopes ni `userinfo`.

## Responsabilidades

Identity Hub:

- administra usuarios, credenciales y administradores;
- registra aplicaciones cliente y sus callbacks;
- asigna usuarios a aplicaciones;
- ejecuta Authorization Code con PKCE S256;
- emite access tokens JWT RS256 y refresh tokens rotativos;
- publica el JWKS para validar access tokens;
- mantiene la sesión central y el estado temporal de OAuth;
- gestiona activación inicial, cambio y recuperación de contraseña.

Cada aplicación cliente:

- mantiene su propia sesión y autorización local;
- protege su secreto y sus tokens en el backend;
- valida los tokens recibidos;
- conserva un usuario local si necesita datos o permisos propios.

Identity Hub no conoce los roles internos ni las reglas de negocio de los clientes. La sesión central tampoco reemplaza la sesión local de un cliente.

## Componentes y estado

| Componente       | Responsabilidad                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Identity Hub UI  | Login, portal, cambio y recuperación de contraseña, y administración.                                   |
| Identity Hub API | Sesiones, OAuth, usuarios, aplicaciones, asignaciones y JWKS.                                           |
| PostgreSQL       | Usuarios, aplicaciones, asignaciones y acciones de contraseña pendientes.                               |
| Redis            | Sesiones SSO, solicitudes de autorización, authorization codes, refresh tokens e índices de revocación. |
| Backend cliente  | `state`, PKCE, callback, tokens y sesión local.                                                         |

Los usuarios solo pueden obtener o refrescar credenciales para aplicaciones activas a las que estén asignados. La asignación también limita el directorio interno que puede consultar cada sistema consumidor.

## Administración

Un administrador registra una aplicación desde Identity Hub con:

- `clientId` único;
- nombre y `launchUrl`;
- una o más `redirectUris` exactas;
- tipo confidencial o público;
- estado activo o inactivo.

Las aplicaciones son confidenciales por defecto. Al crear o regenerar una aplicación, el secreto se devuelve una sola vez y se guarda en PostgreSQL únicamente como hash. El administrador debe transferirlo al backend cliente mediante un canal seguro.

Los usuarios se crean junto con sus asignaciones. No reciben una contraseña temporal conocida: Identity Hub genera una credencial interna no utilizable y crea una acción de configuración inicial de un solo uso. La acción se envía por correo o se entrega manualmente si no existe correo o falla SMTP.

Un reset administrativo invalida la contraseña, exige establecer una nueva y revoca lógicamente los refresh tokens mediante la versión de credencial. La recuperación pública solo crea una acción para un usuario activo con correo y responde siempre con un mensaje neutro; no invalida la credencial actual hasta que se consume la acción. Completar una acción no inicia una sesión.

## Configuración y seguridad

La fuente completa de variables es [`.env.template`](../../.env.template). El arranque las valida con Joi en [`env.validation.ts`](../../src/config/env.validation.ts), convierte números y booleanos y rechaza combinaciones inválidas.

Decisiones que deben conservarse:

- `IDENTITY_HUB_PUBLIC_URL` es la URL pública del API y el valor exacto de `iss` en los JWT.
- `IDENTITY_HUB_UI_URL` construye las rutas de la UI. Si su origen difiere del origen público, CORS se habilita solo para ese origen y con credenciales.
- PostgreSQL usa variables `DATABASE_*`. `DATABASE_SYNCHRONIZE` debe ser `false` en producción.
- `REDIS_URL` acepta `redis://` o `rediss://`. Redis no es solo caché: perder sus datos cierra sesiones e invalida grants temporales.
- `JWT_PRIVATE_KEY_PATH` y `JWT_PUBLIC_KEY_PATH` deben apuntar al mismo par RSA. La clave privada debe quedar fuera del repositorio y con acceso restringido.
- El JWKS actual publica una sola clave con `kid=main-key`. Cambiar el par o el `kid` requiere coordinar cachés y validadores de todos los clientes; no existe una ventana de rotación con varias claves.
- HTTP está permitido por la validación para redes internas o etapas transitorias. HTTPS es la configuración recomendada porque se transportan credenciales, cookies y tokens.
- La cookie `session_id` siempre es `HttpOnly`. `IDENTITY_COOKIE_SECURE` y `IDENTITY_COOKIE_SAME_SITE` deben coincidir con el protocolo y la topología; `SameSite=none` se rechaza si la cookie no es segura.
- Las credenciales SMTP deben configurarse ambas o ninguna. Los códigos de activación y recuperación se almacenan solo como SHA-256.

## Contratos estables

Estos elementos afectan directamente a los clientes y no deben cambiarse sin una migración coordinada:

- issuer, algoritmo RS256, `kid` y JWKS;
- audiencia basada en `clientId` y claims del access token;
- `externalKey` como identificador estable de integración del usuario;
- comparación exacta de `redirect_uri`;
- parámetros OAuth en `snake_case`, PKCE S256 y formatos de respuesta;
- rutas públicas `/oauth/authorize`, `/oauth/token` y `/.well-known/jwks.json`;
- semántica de rotación y revocación de refresh tokens;
- nombres y atributos de la cookie de sesión central.

El flujo detallado está en [Flujo SSO y OAuth](sso-flow.md). Las obligaciones del cliente están en [Integración de clientes](client-integration.md).
