# Flujo SSO/OAuth

Identity Hub usa OAuth 2.0 Authorization Code con PKCE S256 obligatorio. El navegador conserva una sesion global del Hub con cookie HTTP-only y las aplicaciones cliente reciben tokens JWT firmados con RS256.

## Actores

| Actor              | Responsabilidad                                                            |
| ------------------ | -------------------------------------------------------------------------- |
| Navegador          | Sigue redirects y transporta la cookie `session_id` del Hub                |
| Identity Hub UI    | Muestra login, cambio de password, home y pantalla de error del Hub        |
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

En intranet se recomienda HTTPS siempre que sea posible. HTTP o IP privada puede usarse dentro de una red institucional si la URI queda registrada exactamente. No usar comodines, prefijos, dominios parciales ni reglas tipo `startsWith`.

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

Las credenciales validas siempre pueden crear una sesion central. Si `mustChangePassword=true`, esa sesion queda restringida: permite consultar `/api/auth/status`, cambiar la password y cerrar sesion, pero los endpoints normales siguen bloqueados por `PasswordChangeGuard`. `/api/auth/status` incluye `mustChangePassword` dentro del usuario autenticado y no expone el hash ni datos de credenciales.

La ruta interna de cambio se configura con `IDENTITY_HUB_UI_CHANGE_PASSWORD_PATH` y se resuelve contra `IDENTITY_HUB_UI_BASE_URL`. No es un callback OAuth y el navegador no puede sustituirla mediante `returnUrl` o `redirect_uri`.

## Estado en Redis

| Clave                           | Contenido                                               | TTL   | Consumo                                               |
| ------------------------------- | ------------------------------------------------------- | ----- | ----------------------------------------------------- |
| `session:{sessionId}`           | Usuario autenticado del navegador                       | 10h   | Lectura por sesion                                    |
| `pending_oauth:{authRequestId}` | Request authorize validado y sesion vinculada si existe | 5 min | `GETDEL` al reanudar                                  |
| `auth_code:{code}`              | `userId`, `clientId`, `redirectUri`, PKCE y timestamp   | 5 min | Lectura inicial y compare/delete atomico al completar |
| `refresh:{refreshToken}`        | `userId`, `clientId` y scope si existiera               | 10h   | Lectura inicial y rotacion atomica al completar       |
| `user_refresh_tokens:{userId}`  | Indice para revocacion global                           | 10h   | Actualizacion atomica al emitir o rotar; `DEL` logout |

`GETDEL` evita reuso de requests pendientes. Al completar el login, el pending se vincula al `sessionId` sin extender su TTL (`KEEPTTL`). Solo esa sesion puede consumirlo. Si vence, el Hub usa su home configurado y no reconstruye el request desde parametros del navegador.

Los authorization codes y refresh tokens no se eliminan durante su lectura inicial. Despues de validar el grant y preparar los tokens en memoria, un script Lua compara el valor actual con el valor exacto leido. Solo si coincide consume la credencial y persiste el refresh nuevo junto con su indice.

## Flujo completo

1. La aplicacion cliente genera `state`, `code_verifier` y `code_challenge`.
2. El cliente redirige a `/oauth/authorize`.
3. El Hub valida cliente activo, `redirect_uri` exacta, `response_type`, `state` y PKCE.
4. Si no hay `session_id`, el Hub guarda `pending_oauth:{id}` y redirige a `/login?auth_request_id=id`.
5. El usuario hace login en `/oauth/login` y el Hub crea `session_id`.
6. Si `mustChangePassword=false`, el Hub consume el pending y reanuda `/oauth/authorize`.
7. Si `mustChangePassword=true`, conserva y vincula el pending, mantiene la sesion y dirige a la ruta interna de cambio de password.
8. Un `/oauth/authorize` iniciado con sesion restringida primero valida cliente y callback, guarda el request validado como pending y dirige a la misma ruta interna. No devuelve `access_denied` ni emite code en esta etapa.
9. `PATCH /api/auth/change-password` actualiza hash y flag en una sola escritura. Devuelve `redirectUrl`: el authorize pendiente consumido una sola vez o el home configurado si no existe o ya vencio.
10. Al reanudar, el Hub valida usuario activo, `mustChangePassword=false`, aplicacion activa y asignacion usuario-aplicacion.
11. El Hub crea `auth_code:{code}` y redirige a `redirect_uri?code=...&state=...`.
12. El backend cliente llama `/oauth/token` con formulario URL-encoded. Los clientes confidenciales usan HTTP Basic; los publicos se identifican con `client_id`.
13. El Hub lee el code, valida contexto, PKCE y nuevamente la elegibilidad del usuario, prepara el par y finalmente consume el code al persistir el refresh nuevo de forma atomica.

## Token endpoint

`POST /oauth/token` acepta exclusivamente:

```http
Content-Type: application/x-www-form-urlencoded
```

Los nombres externos son snake_case y los unicos grants soportados son `authorization_code` y `refresh_token`. No se admite `scope`.

Los clientes confidenciales se autentican exclusivamente mediante HTTP Basic. Para construir el header, el cliente aplica primero la codificacion `application/x-www-form-urlencoded` al identificador y al secreto por separado, une ambos valores codificados con `:` y codifica el resultado UTF-8 en Base64. El servidor realiza el proceso inverso despues de decodificar Base64.

En una solicitud confidencial, `client_id` no es obligatorio en el formulario porque se obtiene de Basic. Puede enviarse opcionalmente, pero debe coincidir. Los clientes publicos no envian Basic y deben incluir `client_id` en el formulario. El campo `client_secret` no se admite en el body: por si solo produce `invalid_client` y combinado con Basic produce `invalid_request`.

Los parametros de formulario desconocidos se ignoran. Los parametros conocidos repetidos, los valores invalidos, las combinaciones ambiguas y la ausencia de parametros requeridos producen `invalid_request`.

### Authorization code

Request minimo:

```http
POST /oauth/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Authorization: Basic Y2xpZW50ZS1vYXV0aDppZGhfc2tfLi4u

grant_type=authorization_code&code=...&redirect_uri=https%3A%2F%2Fcliente.example.com%2Fauth%2Fcallback&code_verifier=...
```

Un cliente publico usa el mismo formulario y agrega `client_id=cliente-publico`, sin header Authorization.

Validaciones:

- aplicacion activa;
- secreto valido si la app es confidencial;
- code existente, no expirado y no reutilizado;
- `client_id` y `redirect_uri` iguales al contexto guardado;
- PKCE S256 correcto;
- usuario activo;
- `mustChangePassword=false`;
- usuario asignado a la aplicacion.

El code se lee sin eliminarse. Si cualquiera de estas validaciones o la firma JWT falla, permanece disponible con su TTL original. Cuando el par ya esta preparado, un script Lua compara el payload exacto, elimina el code y guarda el refresh nuevo con su indice en una sola operacion atomica. Si otro request consumio, vencio o reemplazo la clave, la comparacion falla y se devuelve `invalid_grant`; el par preparado por el perdedor no se persiste ni se devuelve.

### Refresh token

Request minimo:

```http
POST /oauth/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Authorization: Basic Y2xpZW50ZS1vYXV0aDppZGhfc2tfLi4u

grant_type=refresh_token&refresh_token=...
```

Un cliente publico agrega `client_id=cliente-publico` al formulario, sin header Authorization.

El refresh se lee sin eliminarse. Primero se valida que pertenezca al cliente y que sigan vigentes el usuario, la aplicacion, la asignacion y `mustChangePassword=false`; despues se firma el access token y se prepara un refresh nuevo en memoria. Un script Lua compara el payload exacto leido y, solo si coincide, elimina el refresh anterior, persiste el nuevo, retira el token anterior de `user_refresh_tokens:{userId}`, agrega el nuevo y renueva el TTL del indice a 10 horas.

El refresh anterior no puede reutilizarse y no existe periodo de gracia. Ante dos refresh simultaneos, ambos pueden completar las validaciones, pero solo el primer script encuentra el valor esperado. El ganador persiste y devuelve su par; el perdedor recibe `invalid_grant` sin eliminar ni modificar el token generado por el ganador. Un token presentado con otro cliente o que falla las validaciones no se consume.

Los fallos de PostgreSQL, firma o Redis anteriores a la operacion final no consumen la credencial y conservan su naturaleza interna 500/503. Puede permanecer la ventana inevitable de un fallo de red despues de que Redis haya confirmado internamente el script pero antes de que el backend reciba la respuesta: el servidor no puede saber si la operacion se completo. Resolver esa ambiguedad requeriria idempotencia o estado adicional, fuera de esta fase.

### Respuesta exitosa

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Pragma: no-cache
```

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 600,
  "refresh_token_expires_in": 36000
}
```

`refresh_token_expires_in` es una extension propia de Identity Hub. La respuesta no incluye aliases camelCase ni `scope`.

Un reset administrativo establece `mustChangePassword=true`. Los authorization codes y refresh tokens presentados desde ese momento no producen tokens nuevos. Los access tokens JWT ya emitidos siguen siendo validos hasta su expiracion; no existe blacklist en esta fase. Tras cambiar correctamente la password, el usuario puede iniciar o reanudar autorizaciones nuevas.

## Contrato de redireccion del Hub

- `IDENTITY_HUB_UI_BASE_URL` identifica el origen publico donde vive la UI del Hub.
- `IDENTITY_HUB_UI_CHANGE_PASSWORD_PATH` es una ruta relativa configurada, sin host, query ni fragmento.
- En desarrollo con UI separada, la base apunta al origen de Angular y se habilita `CORS_ORIGIN` con credenciales.
- En produccion de mismo origen, la base apunta al origen publico del backend que sirve `public/browser`.
- `/login`, la ruta de cambio, `/home/welcome` y `/auth/error` son rutas internas del Hub.
- `Application.redirectUris` contiene callbacks externos registrados y solo se usa despues de validacion exacta.
- La UI debe conservar `auth_request_id`, enviarlo como query en `PATCH /api/auth/change-password` y navegar al `redirectUrl` de la respuesta. No debe enviar un `returnUrl`.

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

## Contrato minimo para aplicaciones cliente

Cada aplicacion cliente debe:

- registrar una o mas `redirectUris` exactas;
- generar y guardar `state` por intento de login;
- usar PKCE S256;
- canjear el code desde backend, no desde navegador publico si el cliente es confidencial;
- validar JWT con JWKS, `iss`, `aud`, `exp` y firma RS256;
- usar `externalKey` como identificador estable de usuario integrado;
- manejar errores `access_denied`, code expirado, refresh expirado y refresh rotado;
- no asumir roles internos desde Identity Hub.
