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

NestJS valida este archivo al iniciar mediante Joi, convierte numeros y booleanos a sus tipos de runtime y reporta conjuntamente las variables invalidas.

Levantar servicios locales:

```bash
docker compose up -d postgres redis
```

El compose local expone:

```env
NODE_ENV=development
PORT=8000
IDENTITY_HUB_PUBLIC_URL=http://localhost:8000
IDENTITY_HUB_UI_URL=http://localhost:4200
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=identity_hub
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres
REDIS_URL=redis://localhost:6379
```

En desarrollo se puede usar:

```env
DATABASE_SYNCHRONIZE=true
IDENTITY_COOKIE_SECURE=false
IDENTITY_COOKIE_SAME_SITE=lax
```

HTTP esta permitido en despliegues internos o transitorios. Como Identity Hub gestiona credenciales, sesiones y flujos OAuth, se recomienda firmemente publicar mediante HTTPS y configurar `IDENTITY_COOKIE_SECURE=true`. Con HTTP se usa normalmente `IDENTITY_COOKIE_SECURE=false` y `IDENTITY_COOKIE_SAME_SITE=lax`; `SameSite=none` requiere HTTPS y una cookie segura.

Iniciar el backend:

```bash
npm install
npm run start:dev
```

## Migraciones

`DATABASE_SYNCHRONIZE` controla solo el runtime normal de Nest. El DataSource de TypeORM CLI siempre usa `synchronize: false`.

En produccion:

```env
DATABASE_SYNCHRONIZE=false
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
BOOTSTRAP_ADMIN_PASSWORD=
BOOTSTRAP_ADMIN_FULL_NAME=Identity Hub Admin
```

Ejecutar solo cuando corresponda:

```bash
npm run bootstrap:run
```

El bootstrap no crea aplicaciones cliente. Gaceta, Intranet y otras aplicaciones se registran desde el panel administrativo del Identity Hub.

Las variables de bootstrap deben existir solo durante este proceso controlado. Retirar la password del entorno cuando termine.

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
