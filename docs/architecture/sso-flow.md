# Flujo SSO/OAuth

Identity Hub usa OAuth 2.0 Authorization Code con PKCE S256 obligatorio. El navegador conserva una sesion global del Hub con cookie HTTP-only y las aplicaciones cliente reciben tokens JWT firmados con RS256.

## Actores

| Actor              | Responsabilidad                                                            |
| ------------------ | -------------------------------------------------------------------------- |
| Navegador          | Sigue redirects y transporta la cookie `session_id` del Hub                |
| Identity Hub UI    | Muestra login, home y pantalla de error del Hub                            |
| Identity Hub API   | Valida clientes, usuarios, acceso, PKCE, emite codes/tokens y publica JWKS |
| Aplicacion cliente | Inicia `/oauth/authorize`, guarda `state`, genera PKCE y canjea el code    |
| Redis              | Guarda estado efimero del flujo                                            |
| PostgreSQL         | Guarda usuarios, aplicaciones y asignaciones                               |

## Endpoints principales

| Metodo  | Ruta                     | Uso                                          |
| ------- | ------------------------ | -------------------------------------------- |
| `GET`   | `/oauth/authorize`       | Inicio o continuacion del Authorization Code |
| `POST`  | `/oauth/login`           | Login del usuario en la UI del Hub           |
| `POST`  | `/oauth/token`           | Canje de authorization code o refresh token  |
| `POST`  | `/auth/logout`           | Logout global del Hub                        |
| `GET`   | `/.well-known/jwks.json` | Llaves publicas para validar JWT             |
| `GET`   | `/auth/status`           | Usuario autenticado actual para la UI        |
| `PATCH` | `/auth/change-password`  | Cambio de password cuando corresponde        |

`/oauth/*`, `/.well-known/*` y `/internal/*` no usan el prefijo global `/api`.

## Authorize request

El cliente debe redirigir al navegador a:

```http
GET /oauth/authorize?client_id=...&redirect_uri=...&response_type=code&state=...&code_challenge=...&code_challenge_method=S256
```

Parametros requeridos:

| Parametro               | Regla                                             |
| ----------------------- | ------------------------------------------------- |
| `client_id`             | Debe existir y la aplicacion debe estar activa    |
| `redirect_uri`          | Debe coincidir exactamente con una URI registrada |
| `response_type`         | Solo `code`                                       |
| `state`                 | Obligatorio; se devuelve intacto al cliente       |
| `code_challenge`        | 43 a 128 caracteres PKCE permitidos               |
| `code_challenge_method` | Solo `S256`; `plain` se rechaza                   |

`scope` no tiene soporte funcional actual. Si se envia, se rechaza en vez de copiarlo silenciosamente a tokens.

## PKCE S256

El cliente genera:

```text
code_verifier = string aleatorio seguro
code_challenge = base64url(sha256(code_verifier))
code_challenge_method = S256
```

El Hub guarda `codeChallenge` y `codeChallengeMethod` junto con el authorization code. En `/oauth/token` recalcula `base64url(sha256(code_verifier))` y lo compara contra el valor guardado.

## Redirect URI exacta

La comparacion de `redirect_uri` es exacta contra `Application.redirectUris`.

No se normaliza ni se permite coincidencia parcial. Si el callback no esta registrado, el Hub redirige a su propia pantalla de error y nunca a la URL enviada por el cliente.

## Sesion global

Cookie:

| Propiedad  | Valor                    |
| ---------- | ------------------------ |
| Nombre     | `session_id`             |
| `httpOnly` | `true`                   |
| `sameSite` | `lax`                    |
| `secure`   | `IDENTITY_COOKIE_SECURE` |
| `path`     | `/`                      |
| TTL        | 10 horas                 |

Si no hay sesion, el Hub crea un request pendiente en Redis y redirige a la UI de login.

## Estado en Redis

| Clave                           | Contenido                                             | TTL   | Consumo                      |
| ------------------------------- | ----------------------------------------------------- | ----- | ---------------------------- |
| `session:{sessionId}`           | Usuario autenticado del navegador                     | 10h   | Lectura por sesion           |
| `pending_oauth:{authRequestId}` | Request authorize pendiente                           | 5 min | `GETDEL` al reanudar login   |
| `auth_code:{code}`              | `userId`, `clientId`, `redirectUri`, PKCE y timestamp | 5 min | `GETDEL` en canje            |
| `refresh:{refreshToken}`        | `userId`, `clientId` y scope si existiera             | 10h   | `GETDEL` en refresh          |
| `user_refresh_tokens:{userId}`  | Indice para revocacion global                         | 10h   | `SMEMBERS` y `DEL` en logout |

`GETDEL` evita reuso de requests pendientes, authorization codes y refresh tokens.

## Flujo completo

1. La aplicacion cliente genera `state`, `code_verifier` y `code_challenge`.
2. El cliente redirige a `/oauth/authorize`.
3. El Hub valida cliente activo, `redirect_uri` exacta, `response_type`, `state` y PKCE.
4. Si no hay `session_id`, el Hub guarda `pending_oauth:{id}` y redirige a `/login?auth_request_id=id`.
5. El usuario hace login en `/oauth/login`.
6. El Hub crea `session_id`, consume el pending OAuth y reanuda `/oauth/authorize`.
7. El Hub valida usuario activo y asignacion usuario-aplicacion.
8. El Hub crea `auth_code:{code}` y redirige a `redirect_uri?code=...&state=...`.
9. El backend cliente llama `/oauth/token` con `grant_type=authorization_code`, `client_id`, secreto si aplica, `redirect_uri`, `code` y `code_verifier`.
10. El Hub consume el code, valida contexto y PKCE, y emite access/refresh tokens.

## Token endpoint

### Authorization code

Request minimo:

```json
{
  "grant_type": "authorization_code",
  "client_id": "gaceta",
  "client_secret": "idh_sk_...",
  "code": "...",
  "redirect_uri": "https://gaceta.example.com/auth/callback",
  "code_verifier": "..."
}
```

Validaciones:

- aplicacion activa;
- secreto valido si la app es confidencial;
- code existente, no expirado y no reutilizado;
- `client_id` y `redirect_uri` iguales al contexto guardado;
- PKCE S256 correcto;
- usuario activo;
- usuario asignado a la aplicacion.

### Refresh token

Request minimo:

```json
{
  "grant_type": "refresh_token",
  "client_id": "gaceta",
  "client_secret": "idh_sk_...",
  "refresh_token": "..."
}
```

El refresh token se consume y se reemplaza por uno nuevo. El token anterior no puede reutilizarse. Si se usa con otro cliente, falla y queda consumido.

## Access token

El access token es un JWT RS256.

Claims/headers relevantes:

| Campo         | Valor                                  |
| ------------- | -------------------------------------- |
| `alg`         | `RS256`                                |
| `kid`         | `main-key`                             |
| `iss`         | `JWT_ISSUER`                           |
| `aud`         | `clientId`                             |
| `sub`         | id interno del usuario en Identity Hub |
| `externalKey` | identificador estable para clientes    |
| `name`        | nombre completo                        |
| `exp`         | expiracion                             |

Los clientes deben validar firma con JWKS, `iss`, `aud` y expiracion.

## JWKS

La llave publica se expone en:

```http
GET /.well-known/jwks.json
```

La llave privada no debe estar en el repositorio. Para rotacion futura se recomienda soportar varios `kid` durante una ventana de transicion.

## Logout

`POST /auth/logout` elimina la sesion global y revoca todos los refresh tokens indexados para el usuario. Es un logout global del Identity Hub, no un logout federado en cada cliente.

Despues del logout, un nuevo `/oauth/authorize` debe requerir login nuevamente.

## Contrato minimo para Gaceta/Intranet

Cada cliente debe:

- registrar una o mas `redirectUris` exactas;
- generar y guardar `state` por intento de login;
- usar PKCE S256;
- canjear el code desde backend, no desde navegador publico si el cliente es confidencial;
- validar JWT con JWKS, `iss`, `aud`, `exp` y firma RS256;
- usar `externalKey` como identificador estable de usuario integrado;
- manejar errores `access_denied`, code expirado, refresh expirado y refresh rotado;
- no asumir roles internos desde Identity Hub.
