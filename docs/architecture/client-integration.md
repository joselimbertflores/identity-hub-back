# Integracion de aplicaciones cliente

Este documento es la fuente principal del contrato publico que deben implementar Intranet, Gaceta y cualquier otra aplicacion cliente de Identity Hub. Los demas documentos de `docs/architecture` describen decisiones y operaciones internas del Hub.

Identity Hub implementa OAuth 2.0 Authorization Code con PKCE S256 obligatorio. Intranet y Gaceta son clientes confidenciales: el navegador inicia la autorizacion, pero el callback y todas las llamadas a `/oauth/token` pertenecen al backend de cada aplicacion.

## Limite de seguridad del cliente

- El `client_secret` nunca debe llegar al frontend, al navegador ni a codigo JavaScript publico.
- El backend cliente guarda temporalmente `state` y `code_verifier` y almacena los tokens.
- Un cliente confidencial canjea y rota tokens desde su backend mediante HTTP Basic.
- El frontend cliente solo navega por redirects y utiliza la sesion local creada por su propio backend.
- La configuracion inicial, el cambio obligatorio y la recuperacion de password pertenecen a la UI de Identity Hub. Intranet y Gaceta no deben duplicar esas vistas ni solicitar los codigos correspondientes.

## Endpoints publicos relacionados

| Metodo  | Ruta                                  | Responsabilidad                                               |
| ------- | ------------------------------------- | ------------------------------------------------------------- |
| `GET`   | `/oauth/authorize`                    | Iniciar o reanudar Authorization Code                         |
| `POST`  | `/oauth/login`                        | Login utilizado por la UI de Identity Hub                     |
| `POST`  | `/oauth/token`                        | Canjear un code o rotar un refresh token                      |
| `GET`   | `/.well-known/jwks.json`              | Publicar la llave para verificar access tokens                |
| `GET`   | `/api/auth/status`                    | Consultar la sesion central desde la UI de Identity Hub       |
| `PATCH` | `/api/auth/change-password`           | Cambio autenticado y continuacion de un authorize pendiente   |
| `POST`  | `/api/auth/password-actions/complete` | Configuracion o recuperacion mediante la UI de Identity Hub   |
| `POST`  | `/api/auth/logout`                    | Cerrar la sesion central y revocar refresh tokens del usuario |

No existen endpoints de introspeccion, logout federado o scopes.

## Registro del cliente

Cada aplicacion necesita:

- un `client_id` registrado;
- un `client_secret` almacenado solo en su backend si es confidencial;
- una o mas URI de callback registradas exactamente;
- el valor esperado de `JWT_ISSUER` y acceso al JWKS publico;
- almacenamiento server-side para `state`, `code_verifier` y tokens.

Identity Hub compara `redirect_uri` por igualdad exacta. No normaliza la URI y no acepta comodines, prefijos ni dominios parciales. HTTP o HTTPS funcionan segun el ambiente, siempre que la URI completa este registrada.

## 1. Construccion de la autorizacion con PKCE

Por cada intento de login, el backend cliente debe:

1. Generar un `state` aleatorio, impredecible y de un solo uso.
2. Generar un `code_verifier` aleatorio de 43 a 128 caracteres no reservados de PKCE: letras, digitos, `.`, `_`, `~` o `-`.
3. Calcular `code_challenge = base64url(sha256(code_verifier))`, sin padding.
4. Guardar `state` y `code_verifier` en la sesion server-side asociada al navegador.
5. Redirigir el navegador al authorize endpoint.

```http
GET https://identity.example.org/oauth/authorize?response_type=code&client_id=intranet&redirect_uri=https%3A%2F%2Fintranet.example.org%2Fauth%2Fcallback&state=<state>&code_challenge=<challenge>&code_challenge_method=S256 HTTP/1.1
```

Contrato de `GET /oauth/authorize`:

| Parametro               | Obligatorio | Regla                                             |
| ----------------------- | ----------- | ------------------------------------------------- |
| `response_type`         | Si          | Valor exacto `code`                               |
| `client_id`             | Si          | Aplicacion existente y activa                     |
| `redirect_uri`          | Si          | Igualdad exacta con una URI registrada            |
| `state`                 | Si          | Se devuelve sin modificar en el callback validado |
| `code_challenge`        | Si          | Entre 43 y 128 caracteres no reservados de PKCE   |
| `code_challenge_method` | Si          | Valor exacto `S256`; `plain` no esta soportado    |

`scope` no esta soportado y debe omitirse. Los parametros no declarados son rechazados por la validacion general del authorize endpoint.

Identity Hub valida el cliente y el callback antes de utilizarlos. Un cliente inexistente, una aplicacion inactiva o un callback no registrado conduce a la pantalla de error interna del Hub; nunca redirige el navegador al callback no validado.

Una solicitud mal formada o con parametros requeridos ausentes puede terminar como un `400` de validacion HTTP antes de entrar al flujo interactivo. Tampoco en ese caso se utiliza el callback presentado.

## 2. Autenticacion, cambio obligatorio y reanudacion

Si no existe una sesion central, Identity Hub conserva la solicitud authorize validada durante cinco minutos y envia el navegador a su ruta interna de login. Las credenciales correctas crean una cookie central `session_id` HTTP-only con TTL de diez horas.

Si `mustChangePassword=true`, la sesion se conserva pero queda restringida. Identity Hub no emite un authorization code ni devuelve `access_denied`: dirige al usuario a la ruta configurable de cambio de password y mantiene la solicitud pendiente con su TTL original.

La UI de Identity Hub conserva `auth_request_id` y lo envia al endpoint de cambio autenticado. Al completar el cambio, el backend devuelve un `redirectUrl` que reanuda una sola vez la solicitud pendiente. Si ya vencio, el destino es el home configurado del Hub y la aplicacion cliente debe iniciar una autorizacion nueva cuando el usuario vuelva a ella.

La ruta de cambio de password es una ruta interna del Hub; no es el `redirect_uri` registrado por Intranet o Gaceta y no puede ser sustituida mediante un `returnUrl` del navegador.

## 3. Callback del cliente

Cuando el usuario es elegible, Identity Hub emite un code de un solo uso, valido durante 300 segundos, y redirige a la URI registrada:

```http
HTTP/1.1 302 Found
Location: https://intranet.example.org/auth/callback?code=<authorization-code>&state=<state>
```

El backend cliente debe comparar `state` con igualdad exacta y consumir su copia antes de canjear el code. Si no coincide o no existe, debe rechazar el callback e iniciar un flujo nuevo.

Despues de validar el callback, Identity Hub puede responder:

```text
https://intranet.example.org/auth/callback?error=access_denied&state=<state>
```

`access_denied` indica que el usuario no puede autorizar esa aplicacion. Los errores de cliente o callback ocurridos antes de validar `redirect_uri` permanecen en la UI del Hub y no forman parte del callback del cliente.

## 4. Contrato comun de POST /oauth/token

El endpoint acepta exclusivamente:

```http
Content-Type: application/x-www-form-urlencoded
```

No acepta JSON. Los nombres externos son `snake_case`; nombres anteriores en camelCase no se reconocen y no sustituyen a los parametros requeridos. Los parametros desconocidos se ignoran, pero los parametros conocidos repetidos, los valores invalidos, las combinaciones ambiguas y la ausencia de campos obligatorios producen `invalid_request`.

Solo se admiten `grant_type=authorization_code` y `grant_type=refresh_token`.

### Autenticacion de clientes confidenciales

HTTP Basic es el unico mecanismo admitido. El cliente aplica codificacion `application/x-www-form-urlencoded` al `client_id` y al secreto por separado, une ambos valores codificados con `:` y codifica el resultado UTF-8 en Base64:

```text
Authorization: Basic base64(formEncode(client_id) + ":" + formEncode(client_secret))
```

El formulario confidencial no necesita repetir `client_id`. Si lo incluye opcionalmente, debe coincidir con el identificador de Basic. `client_secret` nunca se admite en el body: por si solo produce `invalid_client` y junto con Basic produce `invalid_request`.

### Autenticacion de clientes publicos

Un cliente publico no envia Basic ni secreto y debe incluir `client_id` en el formulario. Identity Hub no permite que un cliente publico se autentique mediante Basic.

## 5. Canje de authorization code

Request confidencial minimo, realizado desde el backend del cliente:

```http
POST /oauth/token HTTP/1.1
Host: identity.example.org
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <credenciales-form-encoded-en-base64>

grant_type=authorization_code&code=<authorization-code>&redirect_uri=https%3A%2F%2Fintranet.example.org%2Fauth%2Fcallback&code_verifier=<code-verifier>
```

Un cliente publico agrega `client_id=<client-id>` al formulario y omite `Authorization`.

`redirect_uri` debe ser exactamente la enviada en authorize y `code_verifier` debe ser el valor original. Antes de completar el grant, Identity Hub revalida PKCE, el cliente y la elegibilidad actual del usuario, la aplicacion y su asignacion. Un code solo puede completar un canje concurrente.

## 6. Rotacion mediante refresh token

Request confidencial minimo:

```http
POST /oauth/token HTTP/1.1
Host: identity.example.org
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <credenciales-form-encoded-en-base64>

grant_type=refresh_token&refresh_token=<refresh-token-actual>
```

Un cliente publico agrega `client_id=<client-id>` al formulario y omite `Authorization`.

El refresh token es rotativo, de un solo uso y tiene TTL de 36000 segundos. Cada respuesta exitosa contiene un refresh nuevo; el backend cliente debe reemplazar el anterior de forma atomica en su almacenamiento local y evitar refresh concurrentes para la misma sesion.

Si dos requests presentan el mismo refresh, solo uno puede completarse. El otro recibe `invalid_grant` y no afecta el token nuevo del ganador. Un refresh consumido, expirado, revocado, perteneciente a otro cliente o invalidado por un cambio de credencial tambien produce `invalid_grant`.

## 7. Respuesta exitosa de tokens

El canje y la rotacion devuelven exactamente:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Pragma: no-cache
Content-Type: application/json; charset=utf-8
```

```json
{
  "access_token": "<access-token>",
  "refresh_token": "<refresh-token-nuevo>",
  "token_type": "Bearer",
  "expires_in": 600,
  "refresh_token_expires_in": 36000
}
```

`refresh_token_expires_in` es una extension de Identity Hub. No se devuelven aliases camelCase ni `scope`.

## 8. Errores OAuth del token endpoint

Los errores propios de `/oauth/token` tienen exclusivamente este formato:

```json
{
  "error": "invalid_grant",
  "error_description": "The authorization grant is invalid or expired."
}
```

| Codigo                   | HTTP | `error_description`                              | Significado para el cliente                                                 |
| ------------------------ | ---- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| `invalid_request`        | 400  | `The token request is invalid.`                  | Formulario ausente, invalido, repetido, ambiguo o mal formado               |
| `invalid_client`         | 401  | `Client authentication failed.`                  | Autenticacion del cliente invalida; incluye `WWW-Authenticate: Basic`       |
| `invalid_grant`          | 400  | `The authorization grant is invalid or expired.` | Code o refresh no utilizable, PKCE/callback incorrecto o acceso no elegible |
| `unsupported_grant_type` | 400  | `The authorization grant type is not supported.` | Grant distinto de `authorization_code` o `refresh_token`                    |

`unauthorized_client` esta definido para una futura politica por grant, pero el codigo actual no tiene esa politica y no lo emite. `access_denied` pertenece al authorization endpoint, no a `/oauth/token`.

Un `invalid_grant` es definitivo para la credencial presentada: el cliente elimina el code o refresh local y comienza una autorizacion nueva. No debe intentar inferir si la causa fue expiracion, reutilizacion, reset, usuario inactivo o perdida de asignacion.

Un fallo inesperado de PostgreSQL, Redis, firma u otra infraestructura conserva una respuesta segura 500 o 503; no se convierte automaticamente en `invalid_grant`. El cliente debe tratarlo como transitorio segun su politica y no declararlo automaticamente como "sesion expirada" ni eliminar un refresh que todavia podria ser valido.

## 9. Access token y JWKS

El access token es un JWT firmado con RS256 y TTL de 600 segundos. Su header actual contiene:

| Campo | Valor      |
| ----- | ---------- |
| `alg` | `RS256`    |
| `kid` | `main-key` |

El JWKS se descarga sin autenticacion:

```http
GET /.well-known/jwks.json HTTP/1.1
Host: identity.example.org
```

El cliente selecciona del JWKS la llave cuyo `kid` coincide con el header del JWT y debe verificar:

1. algoritmo `RS256` y firma;
2. `iss` contra el issuer configurado para ese ambiente;
3. `aud` contra su propio `client_id`;
4. `exp` contra el reloj actual.

Claims emitidos actualmente:

| Claim         | Significado y uso publico                                                |
| ------------- | ------------------------------------------------------------------------ |
| `sub`         | UUID interno del usuario en esta instancia de Identity Hub               |
| `externalKey` | Identificador estable recomendado para el usuario shadow del cliente     |
| `name`        | Nombre visible mutable                                                   |
| `iss`         | Emisor del token                                                         |
| `aud`         | `client_id` receptor; es el claim que debe validarse como audiencia      |
| `iat`         | Instante de emision en segundos Unix                                     |
| `exp`         | Instante de expiracion en segundos Unix                                  |
| `clientId`    | Campo redundante del payload actual; no sustituye la validacion de `aud` |

El token no incluye `nbf`, roles, email, password, `mustChangePassword`, datos de recuperacion ni la version interna de credenciales. Tampoco incluye `scope`. Los clientes no deben inferir autorizaciones locales a partir de claims que no forman parte de este contrato.

## 10. Sesion central y logout

`GET /api/auth/status` usa la cookie central y devuelve a la UI del Hub el estado autenticado y `mustChangePassword`:

```json
{
  "user": {
    "id": "<user-id>",
    "fullName": "<display-name>",
    "roles": ["USER"],
    "mustChangePassword": false
  }
}
```

Esta sesion central no reemplaza la sesion local de Intranet o Gaceta. Los clientes deben proteger su aplicacion con su propia cookie o mecanismo local despues de validar el callback y el token.

`POST /api/auth/logout` es idempotente, elimina la sesion central cuando existe y revoca los refresh tokens asociados al usuario. Identity Hub no implementa logout federado: cada cliente debe eliminar siempre su propia sesion y sus tokens locales. Si el cliente decide llamar tambien al logout del Hub, debe hacerlo con el navegador y la cookie central segun su despliegue.

## 11. Recuperacion ante grants invalidos

- Code invalido o expirado: descartar el intento, generar `state` y PKCE nuevos e iniciar `/oauth/authorize` otra vez.
- Refresh invalido, consumido, expirado o revocado: eliminar la sesion/token local e iniciar una autorizacion nueva.
- `access_denied`: no repetir silenciosamente; informar falta de acceso o derivar al proceso administrativo.
- Error 500/503: aplicar una politica transitoria limitada. No convertirlo automaticamente en `invalid_grant` ni borrar credenciales locales por esa sola respuesta.
- `mustChangePassword`: no crear vistas locales. El navegador permanece en Identity Hub hasta completar el cambio o iniciar nuevamente el flujo si el pending vencio.

## Checklist para Intranet y Gaceta

1. Registrar `client_id`, secreto confidencial y callback exacto por ambiente.
2. Mantener el secreto exclusivamente en el backend.
3. Generar y validar `state` por intento.
4. Implementar PKCE S256 y guardar `code_verifier` server-side.
5. Canjear el code desde el backend con formulario URL-encoded y HTTP Basic.
6. Validar JWT con JWKS, RS256, `kid`, `iss`, `aud` y `exp`.
7. Usar `externalKey` como identificador estable del usuario shadow.
8. Guardar y reemplazar el refresh token rotado de forma segura.
9. Diferenciar `invalid_grant` definitivo de errores 500/503 transitorios.
10. Implementar logout y eliminacion de sesion local; llamar al logout central solo cuando corresponda.
