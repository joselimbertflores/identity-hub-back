# Environment

## Objetivo
Estas variables controlan configuración de runtime, base de datos, Redis, sesión, JWT y la integración entre backend y UI del Identity Hub.

La idea actual es mantener el `.env` simple:
- una sola base pública para la UI: `IDENTITY_HUB_UI_BASE_URL`
- rutas UI internas resueltas en código
- sin sobreconfigurar login, home y error por separado

## Variables vigentes
| Variable | Propósito | Ejemplo dev | Ejemplo prod |
| --- | --- | --- | --- |
| `PORT` | Puerto HTTP del backend | `8000` | `8080` |
| `NODE_ENV` | Modo de ejecución | `development` | `production` |
| `CORS_ORIGIN` | Origen permitido en desarrollo | `http://localhost:4200` | `https://identity.example.com` o vacío según despliegue |
| `DATABASE_HOST` | Host PostgreSQL | `localhost` | `postgres` |
| `DATABASE_PORT` | Puerto PostgreSQL | `5432` | `5432` |
| `DATABASE_NAME` | Nombre de base | `identity_hub` | `identity_hub` |
| `DATABASE_USER` | Usuario DB | `postgres` | `identity_hub` |
| `DATABASE_PASSWORD` | Contraseña DB | `postgres` | `***` |
| `REDIS_URL` | Conexión Redis | `redis://localhost:6379` | `redis://redis:6379` |
| `IDENTITY_HUB_UI_BASE_URL` | Base pública de la UI del Hub | `http://localhost:4200` | `https://identity.example.com` |
| `IDENTITY_COOKIE_SECURE` | Flag `secure` de `session_id` | `false` | `true` |
| `JWT_PRIVATE_KEY_PATH` | Ruta a llave privada RSA | `keys/private.pem` | `/run/secrets/private.pem` |
| `JWT_PUBLIC_KEY_PATH` | Ruta a llave pública RSA | `keys/public.pem` | `/run/secrets/public.pem` |
| `JWT_ISSUER` | Valor de `iss` en access tokens | `identity-hub` | `identity-hub` o dominio estable |

## Variables por área
### Runtime y frontend
| Variable | Notas |
| --- | --- |
| `PORT` | Puerto del servidor NestJS |
| `NODE_ENV` | El backend distingue `development` y `production` |
| `CORS_ORIGIN` | Hoy sólo se usa para habilitar CORS en desarrollo |
| `IDENTITY_HUB_UI_BASE_URL` | Es la pieza central para construir redirects de UI |

### Base de datos y Redis
| Variable | Uso |
| --- | --- |
| `DATABASE_*` | Configuración de PostgreSQL |
| `REDIS_URL` | Sesiones, `auth_request_id`, authorization codes y refresh tokens |

### Sesión y seguridad
| Variable | Uso |
| --- | --- |
| `IDENTITY_COOKIE_SECURE` | Controla si `session_id` se marca `secure` |
| `JWT_PRIVATE_KEY_PATH` | Firma RS256 |
| `JWT_PUBLIC_KEY_PATH` | Publicación JWKS |
| `JWT_ISSUER` | Emisión consistente del claim `iss` |

## Rutas UI derivadas
El backend no espera variables separadas para cada pantalla de la UI.

| Ruta interna | Construcción |
| --- | --- |
| Login | `new URL('/login', IDENTITY_HUB_UI_BASE_URL)` |
| Home | `new URL('/home/welcome', IDENTITY_HUB_UI_BASE_URL)` |
| Error | `new URL('/auth/error', IDENTITY_HUB_UI_BASE_URL)` |

Ejemplo con `IDENTITY_HUB_UI_BASE_URL=http://localhost:4200`:

| Destino | URL final |
| --- | --- |
| Login | `http://localhost:4200/login` |
| Home | `http://localhost:4200/home/welcome` |
| Error | `http://localhost:4200/auth/error` |

## Variables antiguas reemplazadas
| Variable antigua | Estado | Reemplazo |
| --- | --- | --- |
| `IDENTITY_HUB_HOME_PATH` | Eliminada | `IDENTITY_HUB_UI_BASE_URL` + ruta interna `/home/welcome` |
| `IDENTITY_HUB_LOGIN_PATH` | Eliminada | `IDENTITY_HUB_UI_BASE_URL` + ruta interna `/login` |
| `AUTH_ERROR_REDIRECT` | Eliminada | `IDENTITY_HUB_UI_BASE_URL` + ruta interna `/auth/error` |

## Motivo del cambio
Centralizar la UI del Hub en una sola base reduce:
- duplicación de variables
- combinaciones inválidas de rutas
- divergencia entre documentación, backend y frontend

También hace más claro que login, home y error son parte del Identity Hub y no callbacks arbitrarios configurables.

## Recomendaciones
| Tema | Recomendación |
| --- | --- |
| `IDENTITY_HUB_UI_BASE_URL` | Usar una base limpia, sin paths extra ni slash final innecesario |
| `IDENTITY_COOKIE_SECURE` | `true` en producción |
| `JWT_*_KEY_PATH` | Mantener llaves fuera del control de versiones |
| `JWT_ISSUER` | Mantenerlo estable para no romper validadores externos |
| `redirectUris` de clientes | Registrar coincidencias exactas |

## Ejemplo de desarrollo
```env
PORT=8000
NODE_ENV=development
CORS_ORIGIN=http://localhost:4200

DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=identity_hub
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres

REDIS_URL=redis://localhost:6379

IDENTITY_HUB_UI_BASE_URL=http://localhost:4200
IDENTITY_COOKIE_SECURE=false

JWT_PRIVATE_KEY_PATH=keys/private.pem
JWT_PUBLIC_KEY_PATH=keys/public.pem
JWT_ISSUER=identity-hub
```

## Ejemplo de producción
```env
PORT=8080
NODE_ENV=production

DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_NAME=identity_hub
DATABASE_USER=identity_hub
DATABASE_PASSWORD=change-me

REDIS_URL=redis://redis:6379

IDENTITY_HUB_UI_BASE_URL=https://identity.example.com
IDENTITY_COOKIE_SECURE=true

JWT_PRIVATE_KEY_PATH=/run/secrets/private.pem
JWT_PUBLIC_KEY_PATH=/run/secrets/public.pem
JWT_ISSUER=identity.example.com
```
