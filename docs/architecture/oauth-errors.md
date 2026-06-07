# Manejo de errores OAuth

La regla principal es no redirigir nunca a una `redirect_uri` que no haya sido validada contra la aplicacion registrada.

## Matriz

| Escenario                             | Endpoint               | Salida                                                           |
| ------------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| `client_id` invalido                  | `GET /oauth/authorize` | Redirect a error UI del Hub                                      |
| Aplicacion inactiva                   | `GET /oauth/authorize` | Redirect a error UI del Hub                                      |
| `redirect_uri` no registrada          | `GET /oauth/authorize` | Redirect a error UI del Hub                                      |
| Request malformado                    | `GET /oauth/authorize` | Error HTTP por validation pipe o error UI segun etapa            |
| Usuario sin acceso                    | `GET /oauth/authorize` | Redirect a callback validado con `error=access_denied` y `state` |
| Login invalido                        | `POST /oauth/login`    | Redirect a `/login?error=...`                                    |
| Code invalido/expirado/reutilizado    | `POST /oauth/token`    | JSON 401                                                         |
| PKCE invalido                         | `POST /oauth/token`    | JSON 401                                                         |
| Refresh invalido/expirado/reutilizado | `POST /oauth/token`    | JSON 401                                                         |
| Basic Auth interno invalido           | `/internal/*`          | JSON 401                                                         |

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

## Token

`POST /oauth/token` es backend-to-backend. Nunca usa redirects.

Los errores se responden como JSON con estado HTTP 4xx. Los clientes deben tratar como fallos recuperables:

- code expirado;
- code ya usado;
- refresh token expirado;
- refresh token ya rotado;
- usuario o aplicacion sin acceso.

## Endpoints internos

`/internal/*` exige Basic Auth con `clientId:clientSecret` de una aplicacion activa. No usa cookie `session_id`.

Las respuestas de error no deben exponer si el `clientId` o el secreto fue el campo incorrecto.
