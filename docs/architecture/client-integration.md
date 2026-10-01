# Integración de una aplicación cliente

Esta es la guía oficial para conectar una aplicación con el perfil OIDC mínimo de SIAU. El flujo se implementa en el backend del cliente: el navegador no recibe el secreto, el `id_token` ni el `access_token`.

Esta guía contiene lo necesario para implementar la integración. Para entender cómo SIAU coordina el flujo, consulta [SSO, OIDC y Single Logout](sso-flow.md).

## 1. Registrar la aplicación

Solicita un registro por ambiente y conserva:

- `clientId`;
- `clientSecret` para el backend confidencial;
- `launchUrl`, normalmente el endpoint que inicia SSO;
- `redirectUris` exactas;
- `backchannelLogoutUri`.

Guarda el secreto en un gestor de secretos o variable protegida; no lo incluyas en código, repositorios, logs ni respuestas al frontend. El administrador de SIAU debe asignar a la aplicación los usuarios autorizados.

## 2. Configurar el backend cliente

| Variable | Contenido |
| --- | --- |
| `SIAU_BASE_URL` | URL pública de SIAU y `iss` esperado. |
| `SIAU_CLIENT_ID` | `clientId` asignado. |
| `SIAU_CLIENT_SECRET` | Secreto del cliente confidencial. |
| `SIAU_REDIRECT_URI` | Callback exacto registrado. |
| `SIAU_BACKCHANNEL_LOGOUT_URI` | Receptor de Single Logout. |

Las rutas fijas son `/oauth/authorize`, `/oauth/token`, `/.well-known/jwks.json` y `/internal/sessions/logout`. Este perfil no publica discovery.

## 3. Implementar Authorization Code + PKCE

Por cada inicio de sesión, el backend cliente debe:

1. Generar `state`, `nonce` y `code_verifier` aleatorios e impredecibles.
2. Calcular `code_challenge = BASE64URL(SHA256(code_verifier))`, sin padding. Usa un verifier de 43 a 128 caracteres válidos para PKCE.
3. Guardar `state`, `nonce` y `code_verifier` server-side, asociados al navegador y con expiración corta.
4. Redirigir a `/oauth/authorize` con `response_type=code`, `scope=openid`, `client_id`, `redirect_uri`, `state`, `nonce`, `code_challenge` y `code_challenge_method=S256`.
5. En el callback, comparar y consumir `state`; rechazar valores ausentes, vencidos o diferentes.
6. Canjear el `code` una sola vez desde el backend, usando HTTP Basic, la misma `redirect_uri` y el `code_verifier`.

Redirige el navegador a la URL pública de SIAU con estos parámetros, codificando sus valores para la URL:

```http
GET /oauth/authorize?response_type=code&client_id=<clientId>&redirect_uri=<uri>&scope=openid&state=<state>&nonce=<nonce>&code_challenge=<challenge>&code_challenge_method=S256
```

El callback recibe `code` y `state`, o `error=access_denied` y `state`. Valida `state` también en el caso de error; muestra la denegación sin iniciar un ciclo automático de reintentos.

Canjea el código con esta petición. Para HTTP Basic, codifica por separado el identificador y el secreto como formulario, únelos con `:` y aplica Base64; codifica también los valores del cuerpo como formulario.

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(formEncode(clientId):formEncode(clientSecret))>

grant_type=authorization_code&code=<code>&redirect_uri=<uri>&code_verifier=<verifier>
```

La respuesta contiene `access_token`, `id_token`, `token_type=Bearer` y `expires_in` (vigencia del access token en segundos).

## 4. Validar el ID Token

Obtén las claves públicas en `GET /.well-known/jwks.json` de SIAU y usa una biblioteca JWT/OIDC para validar el token.

Antes de crear la sesión local, valida:

- firma RS256 y `kid` contra el JWKS;
- `iss` exactamente igual a `SIAU_BASE_URL`;
- `aud` igual al `clientId`;
- `iat` razonable y `exp` vigente;
- `nonce` igual al valor guardado para ese intento;
- presencia y tipo esperado de `sub`, `sid`, `externalKey` y `name`.

Consume también el `nonce` y el resto del estado temporal del intento para impedir reutilización. El `id_token` establece la identidad; no uses el access token como sustituto ni dependas de él para mantener la sesión.

## 5. Crear la sesión local y vincular al usuario

La sesión de la aplicación debe ser server-side. Entrega al navegador solo una cookie propia, opaca, `HttpOnly`, `Secure` en HTTPS y con una política `SameSite` adecuada.

Guarda al menos:

- identificador local del usuario;
- `sid` para correlación de logout;
- los datos de identidad mínimos que la aplicación necesite.

Usa `externalKey` como vínculo estable y único con el usuario local. No uses `login`, nombre, correo ni `sub` como clave institucional de integración.

La estrategia puede ser JIT o vinculación previa, pero nunca debe unir cuentas automáticamente por coincidencia de nombre, login o correo. Los roles, permisos, estado y datos propios siguen siendo responsabilidad del cliente.

SIAU no entrega refresh token. Para renovar el acceso mediante SSO, inicia una nueva autorización con nuevos `state`, `nonce` y PKCE. Si la sesión central sigue vigente y el usuario conserva el acceso, no tendrá que introducir sus credenciales otra vez.

## 6. Implementar Single Logout

Cuando el usuario cierre sesión, el backend cliente:

1. toma el `sid` de su sesión local;
2. solicita el cierre central en `/internal/sessions/logout`;
3. elimina inmediatamente su propia sesión y cookie, sin esperar la notificación de retorno, incluso si la petición central falla.

La petición central usa las mismas credenciales HTTP Basic del canje:

```http
POST /internal/sessions/logout
Authorization: Basic <credenciales del cliente>
Content-Type: application/json

{ "sid": "<sid de la sesión local>" }
```

El `backchannelLogoutUri` debe ser accesible desde SIAU y aceptar `POST` con `Content-Type: application/x-www-form-urlencoded` y cuerpo `logout_token=<JWT>`, sin depender de una cookie del navegador. El receptor debe:

1. validar RS256 y `kid` con el JWKS;
2. exigir `typ=logout+jwt`;
3. validar `iss`, `aud`, `iat`, `exp` y `jti`;
4. exigir `sid` y el evento `http://schemas.openid.net/event/backchannel-logout` dentro de `events`;
5. rechazar un Logout Token que contenga `nonce`;
6. eliminar de forma idempotente todas las sesiones locales asociadas al `sid`.

SIAU también enviará esta notificación si el usuario es desactivado, cambian sus credenciales o se retira su acceso a la aplicación.

## Checklist de migración

- [ ] Registro y secretos separados por ambiente.
- [ ] `redirect_uri` y `backchannelLogoutUri` correctas.
- [ ] `scope=openid`, `state`, `nonce` y PKCE S256 generados por intento.
- [ ] Estado temporal guardado y consumido server-side.
- [ ] Canje del code desde el backend mediante HTTP Basic.
- [ ] ID Token validado con JWKS, RS256, `kid`, `iss`, `aud`, `iat`, `exp` y `nonce`.
- [ ] Usuario local vinculado por `externalKey`.
- [ ] Sesión local server-side correlacionada por `sid`.
- [ ] Eliminada toda lógica de refresh token del cliente.
- [ ] Logout local inmediato y receptor back-channel idempotente.
