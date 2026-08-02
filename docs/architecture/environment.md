# Entorno, migraciones y despliegue

Este documento describe como configurar Identity Hub en desarrollo, staging y produccion.

## Variables

| Variable                               | Uso                            | Desarrollo                                    | Produccion                        |
| -------------------------------------- | ------------------------------ | --------------------------------------------- | --------------------------------- |
| `PORT`                                 | Puerto HTTP del backend        | `8000`                                        | segun despliegue                  |
| `DATABASE_HOST`                        | Host PostgreSQL                | `localhost`                                   | host privado                      |
| `DATABASE_PORT`                        | Puerto PostgreSQL              | `5432`                                        | `5432`                            |
| `DATABASE_NAME`                        | Nombre de base                 | `identity_hub`                                | `identity_hub`                    |
| `DATABASE_USER`                        | Usuario DB                     | `postgres`                                    | usuario dedicado                  |
| `DATABASE_PASSWORD`                    | Password DB                    | `postgres`                                    | secreto seguro                    |
| `DB_SYNCHRONIZE`                       | Sincronizacion TypeORM runtime | `true` solo local                             | `false`                           |
| `REDIS_URL`                            | Conexion Redis                 | `redis://localhost:6379`                      | Redis privado, auth/TLS si aplica |
| `JWT_PRIVATE_KEY_PATH`                 | Llave privada RSA              | `keys/private.pem`                            | secreto fuera del repo            |
| `JWT_PUBLIC_KEY_PATH`                  | Llave publica RSA              | `keys/public.pem`                             | ruta publica/segura               |
| `JWT_ISSUER`                           | Claim `iss`                    | `identity-hub`                                | valor estable                     |
| `IDENTITY_HUB_UI_BASE_URL`             | Origen publico de la UI        | `http://localhost:4200`                       | origen HTTPS del Hub              |
| `IDENTITY_HUB_UI_CHANGE_PASSWORD_PATH` | Ruta UI interna de cambio      | `/change-password`                            | ruta Angular desplegada           |
| `PASSWORD_ACTION_UI_PATH`              | Ruta UI para establecer clave  | `/set-password`                               | ruta UI desplegada                |
| `PASSWORD_INITIAL_SETUP_TTL_SECONDS`   | Vigencia de configuracion      | `86400` (24 horas)                            | segun politica institucional      |
| `PASSWORD_RESET_TTL_SECONDS`           | Vigencia de reset/recuperacion | `3600` (60 minutos)                           | segun politica institucional      |
| `SMTP_HOST`                            | Host SMTP                      | relay o servidor local                        | relay institucional               |
| `SMTP_PORT`                            | Puerto SMTP                    | `25`, `465` o `587` segun servidor            | segun proveedor                   |
| `SMTP_SECURE`                          | TLS directo de Nodemailer      | `false` salvo puerto seguro directo           | segun proveedor                   |
| `SMTP_USERNAME`                        | Usuario SMTP opcional          | omitir para relay                             | secreto, si aplica                |
| `SMTP_PASSWORD`                        | Password SMTP opcional         | omitir para relay                             | secreto, si aplica                |
| `SMTP_FROM_ADDRESS`                    | Remitente                      | direccion de desarrollo                       | direccion institucional           |
| `SMTP_FROM_NAME`                       | Nombre visible del remitente   | `Identity Hub`                                | nombre institucional              |
| `IDENTITY_COOKIE_SECURE`               | Cookie `secure`                | `false`                                       | `true`                            |
| `CORS_ORIGIN`                          | Habilita CORS solo si existe   | `http://localhost:4200` si UI usa otro origen | definir solo si aplica            |

La sincronizacion del esquema se controla solo con `DB_SYNCHRONIZE`.

`IDENTITY_HUB_UI_CHANGE_PASSWORD_PATH` y `PASSWORD_ACTION_UI_PATH` deben comenzar con `/` y no pueden contener host, query ni fragmento. El backend las resuelve siempre contra `IDENTITY_HUB_UI_BASE_URL`; no acepta un destino equivalente desde el navegador ni usa el header `Host` para construir enlaces.

Si Angular corre separado en desarrollo, `IDENTITY_HUB_UI_BASE_URL` apunta a su origen y `CORS_ORIGIN` permite ese origen con cookies. Si Nest sirve `public/browser` en produccion, la base debe ser el origen publico del mismo backend. En ambos casos las rutas de login, cambio de password, home y error son internas del Hub; no deben confundirse con callbacks OAuth almacenados en `Application.redirectUris`.

El esquema HTTP o HTTPS del enlace de configuracion procede exclusivamente de `IDENTITY_HUB_UI_BASE_URL`. Esta fase no impone un esquema nuevo: el entorno debe configurarlo segun su despliegue.

Las credenciales SMTP son opcionales, pero `SMTP_USERNAME` y `SMTP_PASSWORD` deben configurarse juntas. Si ambas se omiten, Nodemailer usa el servidor como relay. `SMTP_SECURE=true` representa TLS desde el inicio de la conexion; no debe confundirse con STARTTLS negociado por el transporte.

## DB_SYNCHRONIZE vs migraciones

`DB_SYNCHRONIZE=true` permite que TypeORM sincronice entidades en runtime. Usarlo solo para desarrollo local.

`DB_SYNCHRONIZE=false` evita cambios automaticos de esquema. Usarlo en staging y produccion.

El DataSource de TypeORM CLI vive en:

```text
src/database/data-source.ts
```

Ese DataSource siempre usa:

```ts
synchronize: false;
```

Migraciones:

```bash
npm run migration:generate -- src/database/migrations/NombreDeMigracion
npm run migration:run
npm run migration:revert
```

La migracion inicial crea:

- extension `uuid-ossp`;
- tabla `applications`;
- enum `user_roles_enum`;
- tabla `user`;
- tabla `user_applications`;
- indices y constraints de la relacion usuario-aplicacion;
- tabla `migrations` generada por TypeORM al ejecutar.

`PasswordActionToken` agrega la tabla de estado pendiente `password_action_tokens`. Esta fase no incluye una migracion porque el proyecto sigue en desarrollo y la base puede recrearse con `DB_SYNCHRONIZE=true`. Antes de usar `DB_SYNCHRONIZE=false` en un entorno persistente se debe generar y revisar la migracion correspondiente como una tarea operativa separada.

La entidad `User` incluye tambien `credentialVersion`, un entero interno no nullable con valor inicial `0`. Como no se genera migracion en esta etapa de desarrollo, se debe recrear la base y limpiar Redis al desplegar este cambio. Los refresh tokens emitidos anteriormente no contienen la version y se rechazan; todos los usuarios deben volver a iniciar sesion.

## Docker local

Levantar infraestructura local:

```bash
docker compose up -d postgres redis
```

Servicios:

| Servicio   | Puerto local | Uso                                                           |
| ---------- | ------------ | ------------------------------------------------------------- |
| PostgreSQL | `5432`       | Persistencia de usuarios, aplicaciones y asignaciones         |
| Redis      | `6379`       | Sesiones, pending OAuth, authorization codes y refresh tokens |

El Redis del compose se expone para desarrollo local. No usar esta exposicion como modelo de produccion.

## Bootstrap del primer ADMIN

El bootstrap vive en:

```text
scripts/bootstrap.ts
```

Ejecutar manualmente:

```bash
npm run bootstrap:run
```

Variables:

```env
BOOTSTRAP_ADMIN_LOGIN=admin
BOOTSTRAP_ADMIN_PASSWORD=change-me
BOOTSTRAP_ADMIN_FULL_NAME=Identity Hub Admin
```

Reglas:

- crea solo el primer usuario `ADMIN`;
- si ya existe un admin, no hace nada;
- si el login ya existe como usuario no admin, falla;
- no promueve usuarios existentes automaticamente;
- no crea aplicaciones cliente;
- no imprime password ni secretos.

## Aplicaciones cliente

Las aplicaciones cliente se registran desde el panel administrativo del Hub.

No se registran desde JSON en `.env`.

Registrar:

- `clientId`;
- nombre;
- `launchUrl`;
- `redirectUris` exactas;
- estado activo/inactivo;
- si es confidencial, conservar el secreto mostrado al crear/regenerar.

## Seguridad operativa

### Llaves RSA

Recomendado:

- guardar la llave privada fuera del repo;
- usar secretos del entorno/plataforma;
- respaldar la llave privada de forma segura;
- mantener `JWT_ISSUER` estable;
- planificar rotacion futura con multiples `kid` publicados durante una ventana de transicion.

El `kid` actual es `main-key`.

### Cookies

En produccion:

- `IDENTITY_COOKIE_SECURE=true`;
- servir por HTTPS;
- mantener `sameSite=lax` salvo que el despliegue requiera otro comportamiento;
- configurar `trust proxy` si el backend corre detras de proxy TLS y Nest/Express debe confiar en headers del proxy.

### Redis

En produccion:

- Redis debe estar en red privada;
- no exponerlo publicamente;
- usar password/auth si el proveedor lo soporta;
- usar TLS si cruza redes no confiables;
- monitorear memoria y expiraciones.

### Headers HTTP

Actualmente el proyecto no aplica Helmet. Recomendacion antes de produccion publica:

- agregar Helmet o headers equivalentes en el reverse proxy;
- revisar CSP de la UI Angular;
- limitar origenes CORS a lo estrictamente necesario.

### Rate limiting

El rate limiting actual es basico y por IP:

- login;
- `/oauth/token`;
- `/api/auth/forgot-password`;
- `/api/auth/password-actions/complete`;
- `/internal/*`.

Los dos endpoints publicos de password usan `ThrottlerGuard` real sobre la infraestructura existente: recuperación permite 5 solicitudes por minuto y consumo de acciones 10 por minuto por tracker del throttler. No se implementa un contador local alternativo.

En despliegues con multiples instancias se recomienda usar storage compartido o rate limiting en proxy/WAF.

## Checklist de desarrollo

1. Copiar `.env.template` a `.env`.
2. Levantar `docker compose up -d postgres redis`.
3. Usar `DB_SYNCHRONIZE=true` o ejecutar migraciones.
4. Crear llaves RSA locales.
5. Ejecutar `npm run start:dev`.
6. Ejecutar `npm run test`.

## Checklist de staging

1. Usar base limpia dedicada.
2. Configurar `DB_SYNCHRONIZE=false`.
3. Ejecutar `npm run migration:run`.
4. Ejecutar bootstrap manual si no existe admin.
5. Registrar las aplicaciones cliente desde el panel.
6. Asignar usuarios de prueba.
7. Validar flujo SSO completo con navegador.
8. Validar endpoints internos con Basic Auth.

## Checklist de produccion

1. `DB_SYNCHRONIZE=false`.
2. Migraciones revisadas y ejecutadas en ventana controlada.
3. Llaves RSA fuera del repo y respaldadas.
4. Redis privado y protegido.
5. `IDENTITY_COOKIE_SECURE=true`.
6. HTTPS y proxy configurado.
7. CORS definido solo si la UI corre en otro origen.
8. Rate limiting compartido o en proxy si hay multiples instancias.
9. Logs sin secretos.
10. Aplicaciones cliente y asignaciones creadas desde el panel administrativo.
