# Catálogo interno para importación de usuarios

## Objetivo

Los backends de aplicaciones cliente pueden consultar un catálogo mínimo de usuarios de Identity Hub antes del primer login. El catálogo permite crear usuarios shadow locales sin trasladar reglas internas del sistema cliente al Hub.

El catálogo pertenece a `UsersModule` porque expone un directorio de usuarios centrales. Usa `AccessModule` para autenticar al backend cliente y resolver la aplicación que limita los resultados.

## Autenticación de aplicación

Las rutas internas usan HTTP Basic Authentication:

```http
Authorization: Basic base64(clientId:clientSecret)
```

Identity Hub busca una aplicación activa por `clientId` y compara el secreto recibido contra `clientSecretHash`. La aplicación se obtiene exclusivamente de estas credenciales: la API no acepta un `clientId` como parámetro para decidir qué usuarios devolver.

Estas rutas no son públicas y no usan la cookie de sesión del navegador.

## Endpoints

| Método | Ruta                                      | Propósito                                                |
| ------ | ----------------------------------------- | -------------------------------------------------------- |
| `GET`  | `/internal/users/assignable?term=`        | Buscar hasta 20 usuarios asignados a la aplicación       |
| `GET`  | `/internal/users/assignable/:externalKey` | Obtener un usuario asignado por su identificador externo |

La búsqueda parcial aplica sobre `fullName`, `email` y `login`. Los resultados incluyen únicamente usuarios activos con acceso a la aplicación autenticada y se ordenan por `fullName` e `id`.

Si el usuario solicitado por `externalKey` no existe, está inactivo o no tiene acceso a la aplicación autenticada, la API devuelve `404 Not Found`.

## Respuesta mínima

```ts
{
  id: string;
  fullName: string;
  email: string | null;
  login: string;
}
```

No se exponen contraseñas, hashes, roles de Identity Hub, estado de cambio de contraseña ni secretos de aplicaciones.

## Límite de responsabilidad

Identity Hub no devuelve roles, permisos ni valores como `defaultRole` para sistemas cliente. Cada aplicación crea su usuario shadow y administra localmente sus propios roles.

Este catálogo no cambia OAuth, SSO, login, tokens ni cookies.
