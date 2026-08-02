# Integracion de aplicaciones cliente

Esta guia describe como una aplicacion cliente debe integrarse con Identity Hub usando OAuth Authorization Code con PKCE S256.

Aplica especialmente a clientes con backend propio y secreto confidencial. Gaceta o Intranet son ejemplos de este tipo de cliente, pero el contrato es general para cualquier aplicacion registrada.

## Requisitos del cliente

La aplicacion cliente necesita:

- `client_id` registrado en Identity Hub;
- `client_secret` si es cliente confidencial;
- una o mas `redirectUris` registradas exactamente;
- acceso al JWKS publico del Hub;
- almacenamiento temporal server-side para `state` y `code_verifier`;
- logica para rotar refresh tokens.

## Redirect URIs

Recomendado:

- usar HTTPS;
- registrar callbacks exactos, por ejemplo `https://cliente.example.com/auth/callback`;
- separar callbacks por ambiente si aplica.

En intranet:

- HTTP o IP privada puede permitirse dentro de la red institucional;
- debe estar registrado exactamente en Identity Hub;
- no usar comodines;
- no usar comparacion por prefijo;
- no confiar en URLs construidas desde parametros del usuario.

Ejemplos validos si estan registrados exactamente:

```text
https://cliente.institucion.local/auth/callback
http://10.10.20.15/auth/callback
```

## Flujo para cliente con backend confidencial

1. El usuario entra a una ruta protegida del cliente.
2. El backend cliente genera `state`.
3. El backend cliente genera `code_verifier`.
4. El backend cliente calcula `code_challenge = base64url(sha256(code_verifier))`.
5. El backend cliente guarda `state` y `code_verifier` en sesion server-side o storage temporal seguro.
6. El backend cliente redirige el navegador a `/oauth/authorize`.
7. Identity Hub autentica al usuario si no tiene sesion global. Si una cuenta con credenciales validas tiene `mustChangePassword=true`, crea una sesion restringida y pausa el flujo hasta que el usuario cambie la password.
8. Identity Hub conserva internamente el authorize validado durante esa pausa; el cliente no recibe callback ni code todavia.
9. Identity Hub valida acceso y devuelve `code` y `state` al callback registrado cuando `mustChangePassword=false`.
10. El backend cliente valida que el `state` recibido coincida con el guardado.
11. El backend cliente canjea el `code` en `/oauth/token` usando HTTP Basic si es confidencial y enviando `code_verifier`.
12. El backend cliente valida el access token con JWKS.
13. El cliente crea o actualiza su sesion local.

## Generacion y guardado de state

`state` debe ser aleatorio, impredecible y unico por intento de login.

Uso:

- correlacionar la respuesta del callback;
- reducir riesgo de CSRF en el flujo OAuth;
- evitar aceptar callbacks iniciados por otro contexto.

Regla:

- guardar `state` antes de redirigir a Identity Hub;
- validar igualdad exacta al recibir el callback;
- eliminarlo despues de usarlo.

## Generacion y guardado de code_verifier

`code_verifier` debe ser aleatorio y cumplir formato PKCE.

El cliente envia solo:

```text
code_challenge = base64url(sha256(code_verifier))
code_challenge_method = S256
```

El `code_verifier` no se envia en `/oauth/authorize`. Se guarda temporalmente del lado del cliente backend y se envia solo en `/oauth/token`.

## Authorize request

Ejemplo:

```http
GET https://identity.example.com/oauth/authorize?client_id=cliente-oauth&redirect_uri=https%3A%2F%2Fcliente.example.com%2Fauth%2Fcallback&response_type=code&state=...&code_challenge=...&code_challenge_method=S256
```

Parametros:

| Parametro               | Regla                      |
| ----------------------- | -------------------------- |
| `client_id`             | Identificador registrado   |
| `redirect_uri`          | Callback exacto registrado |
| `response_type`         | Siempre `code`             |
| `state`                 | Obligatorio                |
| `code_challenge`        | PKCE S256                  |
| `code_challenge_method` | Siempre `S256`             |

No enviar `scope` mientras Identity Hub no tenga soporte real de scopes.

## Callback

Identity Hub redirige al callback con:

```text
redirect_uri?code=...&state=...
```

El backend cliente debe:

1. leer `state`;
2. compararlo contra el valor guardado;
3. rechazar si no coincide;
4. leer `code`;
5. continuar con el canje server-to-server.

Si llega `error=access_denied`, el usuario esta autenticado pero no tiene acceso a esa aplicacion.

`mustChangePassword` no produce `access_denied` durante el authorize interactivo: el navegador permanece dentro de las rutas internas del Hub hasta completar la accion. El callback registrado solo recibe una respuesta despues de reanudar y revalidar el flujo.

## Canje del code

El backend cliente llama:

```http
POST /oauth/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Authorization: Basic Y2xpZW50ZS1vYXV0aDppZGhfc2tfLi4u

grant_type=authorization_code&code=...&redirect_uri=https%3A%2F%2Fcliente.example.com%2Fauth%2Fcallback&code_verifier=...
```

Reglas:

- el canje debe hacerse desde backend;
- clientes confidenciales: HTTP Basic es el unico mecanismo admitido y el secreto no debe exponerse al navegador;
- construir Basic codificando primero el identificador y el secreto por separado como componentes `application/x-www-form-urlencoded`, unirlos con `:` y codificar el resultado UTF-8 en Base64;
- en clientes confidenciales, `client_id` no es obligatorio en el formulario; si se envia, debe coincidir con Basic;
- clientes publicos: enviar `client_id` en el formulario, sin Basic ni secreto;
- `client_secret` no se admite en el body; por si solo falla con `invalid_client` y junto con Basic falla con `invalid_request`;
- los parametros desconocidos se ignoran; parametros conocidos repetidos o valores invalidos producen `invalid_request`;
- `redirect_uri` debe ser la misma usada en authorize;
- `code_verifier` debe ser el valor original;
- el code solo sirve una vez.

Ejemplo equivalente para un cliente publico:

```http
POST /oauth/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=...&redirect_uri=https%3A%2F%2Fcliente.example.com%2Fauth%2Fcallback&code_verifier=...&client_id=cliente-publico
```

Respuesta:

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

`refresh_token_expires_in` es una extension de Identity Hub. No se devuelven los nombres camelCase anteriores ni `scope`.

## Validacion de JWT

El cliente debe validar el access token antes de confiar en el usuario.

Validar:

- firma RS256 con `/.well-known/jwks.json`;
- `kid` presente en JWKS;
- `iss` igual a `JWT_ISSUER` esperado;
- `aud` igual al `clientId`;
- `exp` no vencido.

Claims utiles:

| Claim         | Uso                                       |
| ------------- | ----------------------------------------- |
| `sub`         | Id interno del usuario en Identity Hub    |
| `externalKey` | Identificador estable para usuario shadow |
| `name`        | Nombre completo                           |
| `aud`         | Cliente OAuth receptor                    |
| `iss`         | Emisor                                    |

Usar `externalKey` como identificador estable de integracion. No usar `sub` como clave externa principal del sistema cliente salvo que se haya decidido explicitamente.

## Refresh rotation

El refresh token es rotativo:

1. El cliente envia el refresh actual a `/oauth/token`.
2. Identity Hub lo lee y valida cliente, usuario, aplicacion, asignacion y cambio obligatorio de password sin consumirlo.
3. Identity Hub prepara el nuevo par.
4. Una operacion Redis atomica compara y consume el refresh anterior, guarda el nuevo y actualiza el indice del usuario.
5. Identity Hub devuelve el par solamente al request que completo esa operacion.
6. El cliente reemplaza el refresh anterior inmediatamente.

Si el refresh anterior se reutiliza, debe tratarse como invalido. Si hay concurrencia entre varias pestanas o procesos, el cliente debe serializar el refresh o manejar que una peticion falle con `invalid_grant` porque otra ya roto el token. La peticion perdedora no modifica el refresh nuevo del ganador.

Un rechazo por cliente incorrecto, usuario inactivo, cambio obligatorio de password, aplicacion inactiva o asignacion revocada ocurre antes de consumir el refresh. Los fallos transitorios de base de datos, firma o Redis tampoco se presentan como `invalid_grant`.

Request de refresh para un cliente confidencial:

```http
POST /oauth/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Authorization: Basic Y2xpZW50ZS1vYXV0aDppZGhfc2tfLi4u

grant_type=refresh_token&refresh_token=...
```

Un cliente publico agrega `client_id=cliente-publico` al formulario y no envia Authorization.

## Logout

`POST /api/auth/logout` cierra la sesion global del Hub y revoca refresh tokens indexados para el usuario.

La aplicacion cliente tambien debe cerrar su propia sesion local.

Identity Hub no implementa logout federado hacia todos los clientes. Si el usuario cierra sesion en un cliente, ese cliente debe limpiar su sesion local y decidir si tambien llama al logout del Hub.

## Errores comunes

| Error                       | Causa frecuente                                           | Accion                              |
| --------------------------- | --------------------------------------------------------- | ----------------------------------- |
| `invalid_redirect_uri`      | Callback no registrado exactamente                        | Corregir `redirectUris` en el Hub   |
| Validacion de `state` falla | Sesion local perdida o intento no iniciado por el cliente | Rechazar callback y reiniciar login |
| `invalid_request`           | Formulario incompleto, invalido o ambiguo                 | Corregir el request                 |
| `invalid_grant`             | Code, PKCE o refresh invalido; acceso ya no elegible      | Reiniciar authorize                 |
| `invalid_client`            | `client_id` o secreto incorrecto/inactivo                 | Revisar registro y secreto          |
| `unsupported_grant_type`    | `grant_type` no soportado                                 | Usar code o refresh                 |
| `access_denied`             | Usuario sin asignacion a la aplicacion                    | Asignar usuario desde el panel      |
| Refresh invalido            | Token vencido, rotado o revocado por logout               | Reiniciar login                     |
| Grant rechazado tras reset  | El usuario debe completar el reset y volver al login      | Reiniciar authorize en el navegador |
| JWT con `aud` incorrecto    | Token emitido para otro cliente                           | Rechazar token                      |

## Checklist de integracion

1. Registrar aplicacion cliente en Identity Hub.
2. Registrar callback exacto.
3. Guardar secreto de cliente confidencial.
4. Asignar usuario de prueba a la aplicacion.
5. Implementar `state`.
6. Implementar PKCE S256.
7. Implementar callback y validacion de `state`.
8. Canjear code desde backend.
9. Validar JWT con JWKS.
10. Crear usuario shadow usando `externalKey`.
11. Implementar refresh rotation.
12. Implementar logout local y, si aplica, logout del Hub.
