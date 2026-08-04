# Integración de una aplicación cliente

El backend cliente debe controlar OAuth y mantener la sesión local. El frontend solo inicia la navegación, sigue redirects y usa la sesión creada por su backend.

## 1. Registrar la aplicación

Un administrador crea la aplicación en Identity Hub mediante el panel administrativo. La implementación expone esta operación en `POST /api/applications` y exige sesión central con rol `ADMIN`.

Se debe acordar por ambiente:

- `clientId` único;
- `launchUrl` del cliente;
- una o más `redirectUris` completas;
- tipo confidencial o público;
- issuer esperado, igual a `IDENTITY_HUB_PUBLIC_URL`;
- URL del JWKS: `/.well-known/jwks.json` sobre el origen público del Hub.

Identity Hub normaliza `clientId` a minúsculas al crearlo y luego no permite editarlo. El backend cliente debe conservar el valor devuelto por el Hub.

La comparación de `redirect_uri` es exacta. No hay comodines, prefijos ni normalización. HTTP funciona si la URI registrada lo usa, pero HTTPS es la opción recomendada.

Para una aplicación confidencial, el administrador debe guardar el `clientSecret` mostrado al crearla. Identity Hub solo persiste su hash. Regenerarlo invalida inmediatamente el secreto anterior para nuevas llamadas autenticadas.

El administrador también asigna usuarios a la aplicación. Sin una asignación activa el usuario no puede autorizar, canjear o refrescar tokens para ese cliente.

## 2. Implementar el inicio de sesión

Por cada intento, el backend cliente debe:

1. Generar un `state` aleatorio, impredecible y de un solo uso.
2. Generar un `code_verifier` PKCE aleatorio de 43 a 128 caracteres no reservados: letras, dígitos, `.`, `_`, `~` o `-`.
3. Calcular `code_challenge = base64url(sha256(code_verifier))`, sin padding.
4. Guardar `state` y `code_verifier` del lado servidor, vinculados al navegador.
5. Redirigir a Identity Hub.

```http
GET /oauth/authorize?response_type=code&client_id=client-app&redirect_uri=https%3A%2F%2Fclient.example%2Fauth%2Fcallback&state=<state>&code_challenge=<challenge>&code_challenge_method=S256
```

No se debe enviar `scope`. Identity Hub pedirá credenciales solo si no existe una sesión SSO reutilizable.

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

El backend guarda los tokens y crea su propia sesión. El refresh se rota enviando `grant_type=refresh_token&refresh_token=<valor-actual>`; cada respuesta exitosa reemplaza el valor anterior. La actualización debe ser atómica y el cliente debe evitar refresh concurrentes para una misma sesión.

Los errores de `/oauth/token` usan `error` y `error_description`. `invalid_grant` es definitivo para el code o refresh presentado: se descarta y se inicia una autorización nueva. Un `500` o `503` es un fallo transitorio de infraestructura y no demuestra por sí solo que la credencial sea inválida.

## 5. Validar el access token

Antes de aceptar el token, el backend cliente debe:

1. Seleccionar en JWKS la clave cuyo `kid` coincide con el header.
2. Permitir únicamente `RS256` y validar la firma.
3. Comparar `iss` exactamente con el issuer configurado para ese ambiente.
4. Comparar `aud` con su propio `clientId`.
5. Validar `exp` con el reloj actual.

No basta con decodificar el JWT. El claim `clientId` tampoco sustituye la validación de `aud`.

Para vincular un usuario local, se recomienda guardar `externalKey`. Es estable para la integración y también aparece en el directorio interno. `name` es solo un dato visible y puede cambiar; email y roles no están incluidos en el token. `sub` es el UUID interno de la instancia del Hub y no debe sustituir a `externalKey` en sincronizaciones entre sistemas.

## 6. Directorio interno opcional

Un backend cliente puede consultar los usuarios activos que Identity Hub le ha asignado:

| Método | Ruta                                      | Resultado                                          |
| ------ | ----------------------------------------- | -------------------------------------------------- |
| `GET`  | `/internal/users/assignable?term=`        | Hasta 20 coincidencias por nombre, correo o login. |
| `GET`  | `/internal/users/assignable/:externalKey` | Un usuario asignado por su clave estable.          |

Estas rutas son servidor a servidor, no usan la cookie SSO y siempre requieren HTTP Basic con las credenciales de la aplicación, independientemente de su tipo OAuth. La aplicación autenticada determina el filtro; no se puede consultar la asignación de otro cliente.

La respuesta expone solo:

```json
{
  "externalKey": "IDH-U-...",
  "fullName": "Client User",
  "email": "user@example.org",
  "login": "client.user"
}
```

El cliente puede usar este contrato para crear o actualizar su usuario local. Sus roles y permisos siguen siendo responsabilidad propia.

## 7. Logout del cliente

El cliente siempre debe eliminar su sesión y sus tokens locales. El logout central se realiza en Identity Hub y no recibe callbacks ni notifica a otros clientes. Cerrar la sesión local no cierra SSO; cerrar SSO no borra la sesión local.

## Checklist

- Registrar callbacks exactos por ambiente.
- Mantener el secreto, `state`, `code_verifier` y tokens en el backend.
- Implementar PKCE S256 y consumir `state` una sola vez.
- Canjear y refrescar con formulario URL-encoded.
- Reemplazar el refresh token después de cada rotación.
- Validar JWKS, RS256, `kid`, `iss`, `aud` y `exp`.
- Usar `externalKey` para el vínculo estable del usuario.
- Mantener sesión, roles y logout propios.
