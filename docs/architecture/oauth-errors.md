# Manejo de errores OAuth

La regla principal es no redirigir nunca a una `redirect_uri` que no haya sido validada contra la aplicacion registrada.

## Matriz

| Escenario                     | Endpoint               | Salida                                                           |
| ----------------------------- | ---------------------- | ---------------------------------------------------------------- |
| `client_id` invalido          | `GET /oauth/authorize` | Redirect a error UI del Hub                                      |
| Aplicacion inactiva           | `GET /oauth/authorize` | Redirect a error UI del Hub                                      |
| `redirect_uri` no registrada  | `GET /oauth/authorize` | Redirect a error UI del Hub                                      |
| Request malformado            | `GET /oauth/authorize` | Error HTTP por validation pipe o error UI segun etapa            |
| Usuario sin acceso            | `GET /oauth/authorize` | Redirect a callback validado con `error=access_denied` y `state` |
| Login invalido                | `POST /oauth/login`    | Redirect a `/login?error=...`                                    |
| `mustChangePassword=true`     | `GET /oauth/authorize` | Redirect a ruta interna de cambio; no devuelve error al cliente  |
| Request de token invalido     | `POST /oauth/token`    | JSON 400 `invalid_request`                                       |
| Grant no soportado            | `POST /oauth/token`    | JSON 400 `unsupported_grant_type`                                |
| Cliente de token invalido     | `POST /oauth/token`    | JSON 401 `invalid_client` y `WWW-Authenticate: Basic`            |
| Code, PKCE o refresh invalido | `POST /oauth/token`    | JSON 400 `invalid_grant`                                         |
| Basic Auth interno invalido   | `/internal/*`          | JSON 401                                                         |

## Authorize

Errores tempranos quedan dentro del Hub:

- cliente inexistente;
- aplicacion inactiva;
- callback no registrado;
- `redirect_uri` no confiable.

Despues de validar `client_id` y `redirect_uri`, el Hub puede devolver al cliente errores seguros como:

```text
redirect_uri?error=access_denied&state=...
```

`state` debe preservarse para que el cliente pueda correlacionar la respuesta.

## Login

`POST /oauth/login` devuelve redirects de navegador porque lo consume la UI del Hub.

Ejemplos:

```text
/login?error=invalid_credentials
/login?error=user_disabled&auth_request_id=...
```

Si existe `auth_request_id`, se conserva para que la UI no pierda el flujo pendiente.

Con credenciales validas y `mustChangePassword=true`, el login crea la sesion central, conserva el pending sin extender sus cinco minutos de TTL y redirige a la ruta interna configurada. No se usa el callback OAuth como destino de esta navegacion.

## Token

`POST /oauth/token` es backend-to-backend, recibe `application/x-www-form-urlencoded` y nunca usa redirects. Sus errores OAuth tienen exclusivamente este shape:

```json
{
  "error": "invalid_grant",
  "error_description": "The authorization grant is invalid or expired."
}
```

No se agregan `message`, `statusCode` ni el nombre de una excepcion NestJS.

| Codigo                   | HTTP | Descripcion segura                                                   | Uso actual                                                                                                                                                              |
| ------------------------ | ---- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_request`        | 400  | `The token request is invalid.`                                      | Content-Type incorrect, parametros ausentes o repetidos, valores invalidos, grants mezclados, Basic junto con `client_secret` o estructura invalida                     |
| `invalid_client`         | 401  | `Client authentication failed.`                                      | Cliente inexistente/inactivo, Basic mal formado, identificadores distintos, secreto ausente/incorrecto, `client_secret` solo en body o mecanismo no valido para el tipo |
| `invalid_grant`          | 400  | `The authorization grant is invalid or expired.`                     | Code, callback, PKCE o refresh invalido; cliente del grant incorrecto; usuario, aplicacion, asignacion o `mustChangePassword` ya no elegible                            |
| `unauthorized_client`    | 400  | `The authenticated client is not authorized to use this grant type.` | Reservado para una politica real que impida a un cliente valido usar un grant. La implementacion actual no tiene esa politica y no lo devuelve                          |
| `unsupported_grant_type` | 400  | `The authorization grant type is not supported.`                     | Cualquier `grant_type` distinto de `authorization_code` y `refresh_token`                                                                                               |

Toda respuesta `invalid_client` incluye:

```http
WWW-Authenticate: Basic
```

`invalid_grant` agrupa deliberadamente code inexistente, vencido o consumido; redirect incorrecto; PKCE invalido; refresh inexistente, revocado, consumido o de otro cliente; usuario inactivo o inexistente; perdida de asignacion; aplicacion ya no valida y `mustChangePassword=true`. El cliente no puede distinguir la causa interna.

El code o refresh se lee y valida antes de consumirse. La operacion final compara atomicamente el valor exacto leido. Si dos requests usan la misma credencial, solo uno completa el grant; el otro recibe `invalid_grant`. Un callback, PKCE, cliente o estado de acceso invalido no consume prematuramente la credencial.

Los parametros de formulario desconocidos se ignoran en este endpoint. Esta regla local no cambia el `ValidationPipe` ni el tratamiento de otros endpoints.

`access_denied` no corresponde al token endpoint. Se utiliza unicamente durante authorize, despues de validar el callback, cuando el usuario no tiene acceso a la aplicacion.

Los errores OAuth anteriores son rechazos definitivos del request presentado. Fallos inesperados de Redis, PostgreSQL, bcrypt, firma JWT u otra infraestructura no se convierten a `invalid_grant`: conservan una respuesta segura 500 o 503 para que la operacion pueda tratarse como transitoria. Si Redis aplica el script final pero la conexion falla antes de confirmar su resultado al backend, la respuesta queda necesariamente ambigua; no se agrega estado de idempotencia para resolver esa ventana en esta fase.

## Endpoints internos

`/internal/*` exige Basic Auth con `clientId:clientSecret` de una aplicacion activa. No usa cookie `session_id`.

Las respuestas de error no deben exponer si el `clientId` o el secreto fue el campo incorrecto.
