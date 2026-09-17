# Visión general

SIAU es el punto central de identidad para aplicaciones cliente. Autentica usuarios, mantiene una sesión SSO en su propio dominio y emite credenciales OAuth para los clientes autorizados.

No es un proveedor OpenID Connect completo: no emite `id_token`, no publica discovery y no implementa scopes ni `userinfo`.

## Responsabilidades

SIAU:

- administra usuarios, credenciales y administradores;
- registra aplicaciones cliente, sus callbacks y su `backchannelLogoutUri` opcional;
- asigna usuarios a aplicaciones;
- ejecuta Authorization Code con PKCE S256;
- emite access tokens JWT RS256 y refresh tokens rotativos;
- publica el JWKS para validar access tokens y Logout Tokens;
- mantiene la sesión SSO central, el estado temporal de OAuth y coordina Single Logout;
- gestiona activación inicial, cambio y recuperación de contraseña.

Cada aplicación cliente:

- mantiene su propia sesión y autorización local;
- protege su secreto y sus tokens en el backend;
- valida los tokens recibidos;
- conserva un usuario local si necesita datos o permisos propios.

SIAU no conoce los roles internos ni las reglas de negocio de los clientes. La sesión central tampoco reemplaza la sesión local de un cliente.

## Componentes y estado

| Componente       | Responsabilidad                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| SIAU UI          | Login, portal, cambio y recuperación de contraseña, y administración.                                   |
| SIAU API         | Sesiones, OAuth, usuarios, aplicaciones, asignaciones y JWKS.                                           |
| PostgreSQL       | Usuarios, aplicaciones, asignaciones y acciones de contraseña pendientes.                               |
| Redis            | Sesiones SSO, solicitudes de autorización, authorization codes, refresh tokens e índices de revocación. |
| Backend cliente  | `state`, PKCE, callback, tokens y sesión local.                                                         |

Los usuarios solo pueden obtener o refrescar credenciales para aplicaciones activas a las que estén asignados. La asignación también limita el directorio interno que puede consultar cada sistema consumidor.

## Identidad del usuario

Los tres identificadores tienen propósitos distintos:

- `externalKey` identifica de forma estable la cuenta de SIAU y es la clave que deben persistir las aplicaciones cliente;
- `relationKey` vincula la cuenta con el funcionario de RRHH: es obligatoria en nuevas creaciones administrativas, aunque puede faltar en cuentas históricas o importadas;
- `login` sirve para autenticarse y puede cambiar, por lo que no debe usarse como clave de integración.

`mustChangePassword` describe solo una restricción actual: el usuario debe cambiar su contraseña antes de continuar normalmente. No registra si la cuenta fue configurada por primera vez ni conserva historial.

## RRHH y creación administrativa de usuarios

RRHH es la fuente autoritativa de la identidad institucional: `relationKey`, `fullName`, cargo, unidad o dependencia y vigencia laboral. `relationKey` es el identificador de relación definido por RRHH a partir del CI; si este tiene complemento, también forma parte de la clave. Su formato es CI o CI-COMPLEMENTO (por ejemplo, `53535-1K`). En RRHH, el campo técnico que almacena el complemento del CI se llama `ext`. SIAU utiliza el valor canónico devuelto por RRHH y no lo reconstruye. Cargo, unidad y dependencia pueden ayudar en la búsqueda, pero SIAU no los almacena solo porque RRHH los devuelva.

SIAU administra `login`, email, roles, estado de la cuenta, aplicaciones y accesos, contraseñas y acciones de contraseña, sesiones y autenticación. Para nuevas creaciones administrativas solo admite funcionarios vigentes de RRHH. El correo es obligatorio porque la acción `INITIAL_SETUP` se entrega por ese medio; esta regla no modifica retroactivamente las cuentas históricas o importadas que puedan existir sin correo.

La integración mantiene a RRHH detrás del backend de SIAU:

| Sistema | Endpoint | Uso |
| --- | --- | --- |
| RRHH | `GET /internal/employees?q=...&page=...&limit=...` | Buscar funcionarios para seleccionarlos. |
| RRHH | `GET /internal/employees/:relationKey` | Consultar nuevamente al funcionario vigente por su clave. |
| SIAU | `GET /api/users/employees?q=...&page=...&limit=...` | Exponer la búsqueda administrativa al frontend. |
| SIAU | `POST /api/users/access` | Crear el usuario con sus accesos. |

El frontend de SIAU nunca consulta RRHH directamente. El flujo de alta es:

1. El administrador busca un funcionario mediante SIAU y selecciona un resultado.
2. El frontend conserva la `relationKey` seleccionada y la envía con la creación a SIAU.
3. El backend consulta de nuevo a RRHH por esa `relationKey` para comprobar que el funcionario sigue vigente y recibir `relationKey` y `fullName` autoritativos.
4. SIAU comprueba que ninguna cuenta esté asociada a la `relationKey` devuelta por RRHH y crea el usuario con sus accesos.
5. SIAU genera `INITIAL_SETUP` y envía el correo correspondiente.

La búsqueda solo permite seleccionar al funcionario; sus resultados no sustituyen la consulta de RRHH durante el alta. La importación desde Seguimiento de Trámites sigue siendo un flujo independiente: la selección obligatoria desde RRHH se aplica a nuevas creaciones administrativas, no cambia el proceso de importación existente.

## Administración

Un administrador registra una aplicación desde SIAU con:

- `clientId` único;
- nombre y `launchUrl`;
- una o más `redirectUris` exactas;
- tipo confidencial o público;
- `backchannelLogoutUri` opcional para recibir notificaciones de Single Logout;
- estado activo o inactivo.

Las aplicaciones son confidenciales por defecto. Al crear o regenerar una aplicación, el secreto se devuelve una sola vez y se guarda en PostgreSQL únicamente como hash. El administrador debe transferirlo al backend cliente mediante un canal seguro.

En el alta administrativa descrita arriba, los usuarios no reciben una contraseña temporal conocida: SIAU genera una credencial interna no utilizable. El código de `INITIAL_SETUP` no se expone en la respuesta; si SMTP falla, se informa el fallo de entrega para poder reintentar. La importación controlada puede aprovisionar cuentas sin notificación ni acción. Un administrador puede reenviar una acción pendiente; el nuevo código conserva su propósito y reemplaza al anterior con una nueva expiración.

Desactivar un usuario incrementa `credentialVersion`. Un reset administrativo invalida la contraseña actual, marca que debe cambiarse e incrementa la misma versión. En ambos casos, las sesiones SSO y los refresh tokens anteriores dejan de ser válidos por comparación con PostgreSQL; su eliminación en Redis es una limpieza posterior de mejor esfuerzo. Reactivar al usuario no restaura credenciales anteriores.

La recuperación pública solo crea una acción `PASSWORD_RESET` para un único usuario activo con correo y responde siempre con un mensaje neutro; no invalida la credencial actual hasta que se consume la acción. Completar cualquier acción actualiza la contraseña, incrementa `credentialVersion`, elimina las acciones pendientes y no inicia sesión. `PasswordActionToken` es autorización efímera, no historial ni estado permanente de la cuenta.

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
