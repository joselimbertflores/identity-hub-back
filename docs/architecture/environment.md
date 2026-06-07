# Entorno, migraciones y despliegue

Este documento describe como configurar Identity Hub en desarrollo, staging y produccion.

## Variables

| Variable                   | Uso                            | Desarrollo                                    | Produccion                        |
| -------------------------- | ------------------------------ | --------------------------------------------- | --------------------------------- |
| `PORT`                     | Puerto HTTP del backend        | `8000`                                        | segun despliegue                  |
| `DATABASE_HOST`            | Host PostgreSQL                | `localhost`                                   | host privado                      |
| `DATABASE_PORT`            | Puerto PostgreSQL              | `5432`                                        | `5432`                            |
| `DATABASE_NAME`            | Nombre de base                 | `identity_hub`                                | `identity_hub`                    |
| `DATABASE_USER`            | Usuario DB                     | `postgres`                                    | usuario dedicado                  |
| `DATABASE_PASSWORD`        | Password DB                    | `postgres`                                    | secreto seguro                    |
| `DB_SYNCHRONIZE`           | Sincronizacion TypeORM runtime | `true` solo local                             | `false`                           |
| `REDIS_URL`                | Conexion Redis                 | `redis://localhost:6379`                      | Redis privado, auth/TLS si aplica |
| `JWT_PRIVATE_KEY_PATH`     | Llave privada RSA              | `keys/private.pem`                            | secreto fuera del repo            |
| `JWT_PUBLIC_KEY_PATH`      | Llave publica RSA              | `keys/public.pem`                             | ruta publica/segura               |
| `JWT_ISSUER`               | Claim `iss`                    | `identity-hub`                                | valor estable                     |
| `IDENTITY_HUB_UI_BASE_URL` | URL publica de la UI           | `http://localhost:4200`                       | dominio HTTPS                     |
| `IDENTITY_COOKIE_SECURE`   | Cookie `secure`                | `false`                                       | `true`                            |
| `CORS_ORIGIN`              | Habilita CORS solo si existe   | `http://localhost:4200` si UI usa otro origen | definir solo si aplica            |

La sincronizacion del esquema se controla solo con `DB_SYNCHRONIZE`.

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

Gaceta, Intranet y otras aplicaciones se registran desde el panel administrativo del Hub.

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
- `/internal/*`.

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
5. Registrar Gaceta/Intranet desde el panel.
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
