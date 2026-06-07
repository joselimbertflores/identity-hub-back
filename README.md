# Identity Hub Backend

Identity Hub es el proveedor interno de autenticacion SSO/OAuth para aplicaciones cliente como Gaceta e Intranet.

El backend autentica usuarios centrales, mantiene una sesion global del navegador, valida acceso a aplicaciones, emite tokens JWT RS256, publica JWKS y expone endpoints internos para que los clientes consulten usuarios asignables.

## Requisitos

- Node.js compatible con NestJS 11
- npm
- Docker y Docker Compose para desarrollo local
- PostgreSQL
- Redis
- Llaves RSA para firmar tokens:
  - `JWT_PRIVATE_KEY_PATH`
  - `JWT_PUBLIC_KEY_PATH`

## Configuracion local

Crear `.env` a partir de `.env.template`.

Levantar servicios locales:

```bash
docker compose up -d postgres redis
```

El compose local expone:

```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=identity_hub
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres
REDIS_URL=redis://localhost:6379
```

En desarrollo se puede usar:

```env
DB_SYNCHRONIZE=true
IDENTITY_COOKIE_SECURE=false
CORS_ORIGIN=http://localhost:4200
```

Iniciar el backend:

```bash
npm install
npm run start:dev
```

## Migraciones

`DB_SYNCHRONIZE` controla solo el runtime normal de Nest. El DataSource de TypeORM CLI siempre usa `synchronize: false`.

En produccion:

```env
DB_SYNCHRONIZE=false
```

Comandos:

```bash
npm run migration:generate -- src/database/migrations/NombreDeMigracion
npm run migration:run
npm run migration:revert
```

La migracion inicial del esquema vive en `src/database/migrations`.

## Bootstrap inicial

El bootstrap crea unicamente el primer usuario `ADMIN` si todavia no existe ningun admin. Es manual e idempotente.

Variables:

```env
BOOTSTRAP_ADMIN_LOGIN=admin
BOOTSTRAP_ADMIN_PASSWORD=change-me
BOOTSTRAP_ADMIN_FULL_NAME=Identity Hub Admin
```

Ejecutar solo cuando corresponda:

```bash
npm run bootstrap:run
```

El bootstrap no crea aplicaciones cliente. Gaceta, Intranet y otras aplicaciones se registran desde el panel administrativo del Identity Hub.

## Pruebas y build

```bash
npm run test
npm run test:e2e
npm run build
npx tsc -p tsconfig.json --noEmit
```

`test:e2e` ejecuta la suite de integracion del flujo Identity Hub con repositorios y Redis controlados en memoria. No ejecuta migraciones ni bootstrap.

## Documentacion

La documentacion principal vive en [docs/architecture](docs/architecture).

Lectura recomendada:

1. [Overview](docs/architecture/README.md)
2. [Modulos del backend](docs/architecture/backend-modules.md)
3. [Flujo SSO/OAuth](docs/architecture/sso-flow.md)
4. [Entorno y despliegue](docs/architecture/environment.md)
5. [Catalogo interno de usuarios](docs/architecture/client-user-import.md)
6. [Pruebas](docs/architecture/testing.md)
