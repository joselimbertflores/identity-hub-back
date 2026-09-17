# Integración de una aplicación cliente

El backend cliente debe controlar OAuth y mantener la sesión local. El frontend solo inicia la navegación, sigue redirects y usa la sesión creada por su backend.

## 1. Registrar la aplicación

Un administrador crea la aplicación en SIAU mediante el panel administrativo. La implementación expone esta operación en `POST /api/applications` y exige sesión central con rol `ADMIN`.

Se debe acordar por ambiente:

- `clientId` único;
- `launchUrl` del cliente;
- una o más `redirectUris` completas;
- tipo confidencial o público;
- `backchannelLogoutUri` del backend cliente, si implementará Single Logout;
- issuer esperado, igual a `IDENTITY_HUB_PUBLIC_URL`;
- URL del JWKS: `/.well-known/jwks.json` sobre el origen público de SIAU.

SIAU normaliza `clientId` a minúsculas al crearlo y luego no permite editarlo. El backend cliente debe conservar el valor devuelto por SIAU.

La comparación de `redirect_uri` es exacta. No hay comodines, prefijos ni normalización. HTTP funciona si la URI registrada lo usa, pero HTTPS es la opción recomendada.

Para una aplicación confidencial, el administrador debe guardar el `clientSecret` mostrado al crearla. SIAU solo persiste su hash. Regenerarlo invalida inmediatamente el secreto anterior para nuevas llamadas autenticadas.

El administrador también asigna usuarios a la aplicación. Sin una asignación activa el usuario no puede autorizar, canjear o refrescar tokens para ese cliente.

## 2. Implementar el inicio de sesión

Por cada intento, el backend cliente debe:

1. Generar un `state` aleatorio, impredecible y de un solo uso.
2. Generar un `code_verifier` PKCE aleatorio de 43 a 128 caracteres no reservados: letras, dígitos, `.`, `_`, `~` o `-`.
3. Calcular `code_challenge = base64url(sha256(code_verifier))`, sin padding.
4. Guardar `state` y `code_verifier` del lado servidor, vinculados al navegador.
5. Redirigir a SIAU.

```http
GET /oauth/authorize?response_type=code&client_id=client-app&redirect_uri=https%3A%2F%2Fclient.example%2Fauth%2Fcallback&state=<state>&code_challenge=<challenge>&code_challenge_method=S256
```

No se debe enviar `scope`. SIAU pedirá credenciales solo si no existe una sesión SSO reutilizable.

## 3. Procesar el callback

El backend cliente recibe uno de estos resultados:

```text
https://client.example/auth/callback?code=<code>&state=<state>
https://client.example/auth/callback?error=access_denied&state=<state>
```

Debe comparar `state` con igualdad exacta, consumirlo y rechazar callbacks ausentes, vencidos o distintos. Ante `access_denied`, debe informar que el usuario no tiene acceso; no debe repetir el flujo en un ciclo.

## 4. Canjear el code

El canje se hace desde el backend con formulario URL-encoded. Un cliente confidencial usa HTTP Basic y nunca envía el secreto al navegador ni en el body:

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>

grant_type=authorization_code&code=<code>&redirect_uri=https%3A%2F%2Fclient.example%2Fauth%2Fcallback&code_verifier=<code-verifier>
```

La codificación de Basic sigue OAuth: `client_id` y secreto se codifican como componentes de formulario antes de unirlos con `:` y aplicar Base64. Un cliente público omite `Authorization` y agrega `client_id` al formulario.

Respuesta exitosa:

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<opaque-token>",
  "token_type": "Bearer",
  "expires_in": 600,
  "refresh_token_expires_in": 36000
}
```

El backend guarda los tokens y crea su propia sesión. Debe obtener el claim `sid` del access token y conservarlo en esa sesión local. El refresh se rota enviando `grant_type=refresh_token&refresh_token=<valor-actual>`; cada respuesta exitosa reemplaza el valor anterior. La actualización debe ser atómica y el cliente debe evitar refresh concurrentes para una misma sesión.

`refresh_token_expires_in` expresa la vida restante que permite la sesión SIAU. No representa necesariamente 10 horas nuevas después de cada refresh y nunca supera la expiración absoluta de esa sesión.

Los errores de `/oauth/token` usan `error` y `error_description`. `invalid_grant` es definitivo para el code o refresh presentado: se descarta y se inicia una autorización nueva. Un `500` o `503` es un fallo transitorio de infraestructura y no demuestra por sí solo que la credencial sea inválida.

## 5. Validar el access token

Antes de aceptar el token, el backend cliente debe:

1. Seleccionar en JWKS la clave cuyo `kid` coincide con el header.
2. Permitir únicamente `RS256` y validar la firma.
3. Comparar `iss` exactamente con el issuer configurado para ese ambiente.
4. Comparar `aud` con su propio `clientId`.
5. Validar `exp` con el reloj actual.
6. Obtener un `sid` válido y guardarlo con la sesión local.

No basta con decodificar el JWT. El claim `clientId` tampoco sustituye la validación de `aud`.

Para vincular un usuario local se debe guardar `externalKey`: identifica de forma estable la cuenta de SIAU y también aparece en el directorio interno. `relationKey`, cuando existe, vincula la cuenta con el funcionario de RRHH y puede usarse para reconciliación. `login` sirve para autenticarse, no como clave de integración. `name` es solo un dato visible y puede cambiar; email y roles no están incluidos en el token. `sub` es el UUID interno de la instancia de SIAU y no debe sustituir a `externalKey` en sincronizaciones entre sistemas.

## 6. Directorio interno opcional

Un backend cliente puede consultar los usuarios activos que SIAU le ha asignado:

| Método | Ruta                                      | Resultado                                          |
| ------ | ----------------------------------------- | -------------------------------------------------- |
| `GET`  | `/internal/users/assignable?term=`        | Hasta 20 coincidencias por nombre, correo o login. |
| `GET`  | `/internal/users/assignable/:externalKey` | Un usuario asignado por su clave estable.          |

Estas rutas son servidor a servidor, no usan la cookie SSO y siempre requieren HTTP Basic con las credenciales de la aplicación, independientemente de su tipo OAuth. La aplicación autenticada determina el filtro; no se puede consultar la asignación de otro cliente.

La consulta individual expone solo:

```json
{
  "externalKey": "IDH-U-...",
  "fullName": "Client User",
  "email": "user@example.org",
  "login": "client.user",
  "relationKey": "53535-1K"
}
```

La consulta individual por `externalKey` incluye `relationKey`; el listado no lo expone. El cliente puede usar este contrato para crear o actualizar su usuario local. Sus roles y permisos siguen siendo responsabilidad propia.

## 7. Logout del cliente

El frontend llama únicamente a su propio backend. El backend obtiene el `sid` guardado en la sesión local e inicia el cierre central:

```http
POST /internal/sessions/logout
Authorization: Basic <base64(clientId:clientSecret)>
Content-Type: application/json

{ "sid": "<uuid>" }
```

SIAU autentica la aplicación, comprueba que participó en ese `sid`, cierra únicamente esa sesión central y notifica a todos sus participantes. Para recibir la notificación, el cliente debe registrar un `backchannelLogoutUri` que acepte:

```text
Content-Type: application/x-www-form-urlencoded

logout_token=<JWT>
```

El endpoint debe validar:

- algoritmo RS256 y firma con la clave publicada en JWKS;
- header `typ=logout+jwt`;
- `iss` esperado, `aud` igual a su `clientId` y `exp` vigente;
- `sid`;
- el evento `http://schemas.openid.net/event/backchannel-logout` dentro de `events`.

Después elimina todas sus sesiones locales asociadas al `sid`. El endpoint back-channel debe ser idempotente: si ya no existe ninguna, responde éxito igualmente.

El cliente que inició el logout elimina también su propia sesión, cookie y tokens locales. No debe depender exclusivamente de recibir después su propia notificación back-channel y decide por sí mismo el redirect del navegador.

## Checklist

- Registrar callbacks exactos por ambiente.
- Mantener el secreto, `state`, `code_verifier` y tokens en el backend.
- Implementar PKCE S256 y consumir `state` una sola vez.
- Canjear y refrescar con formulario URL-encoded.
- Reemplazar el refresh token después de cada rotación.
- Validar JWKS, RS256, `kid`, `iss`, `aud` y `exp`.
- Guardar el `sid` en la sesión local e implementar el logout backend-to-backend.
- Exponer un `backchannelLogoutUri` idempotente y validar el Logout Token.
- Usar `externalKey`, no `login`, para el vínculo estable del usuario.
- Mantener sesión, roles y logout propios.
