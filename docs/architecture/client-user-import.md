# Endpoints internos para clientes

Las aplicaciones cliente pueden consultar usuarios asignados a su aplicacion para crear o actualizar usuarios shadow locales.

Estos endpoints son internos, no forman parte del flujo OAuth del navegador y no usan `session_id`.

## Autenticacion

Usan HTTP Basic Auth:

```http
Authorization: Basic base64(clientId:clientSecret)
```

Identity Hub:

1. busca una aplicacion activa por `clientId`;
2. compara el secreto contra `clientSecretHash`;
3. elimina el hash de la entidad antes de entregarla al controller;
4. usa la aplicacion autenticada para filtrar usuarios.

El cliente no puede enviar un `clientId` en query/body para consultar usuarios de otra aplicacion.

## Rate limiting

Los endpoints internos tienen throttling basico por IP. En produccion multi-instancia se recomienda usar almacenamiento compartido o rate limiting en el proxy.

## Endpoints

| Metodo | Ruta                                      | Uso                                                                   |
| ------ | ----------------------------------------- | --------------------------------------------------------------------- |
| `GET`  | `/internal/users/assignable?term=`        | Lista hasta 20 usuarios activos asignados a la aplicacion autenticada |
| `GET`  | `/internal/users/assignable/:externalKey` | Devuelve un usuario asignado por `externalKey`                        |

La busqueda parcial aplica sobre:

- `fullName`;
- `email`;
- `login`.

Solo se devuelven usuarios:

- activos;
- con `externalKey`;
- asignados a la aplicacion autenticada.

## Respuesta segura

```ts
{
  externalKey: string;
  fullName: string;
  email: string | null;
  login: string;
}
```

No se exponen:

- password;
- hashes;
- roles internos de Identity Hub;
- `mustChangePassword`;
- estado interno innecesario;
- secretos de aplicaciones.

## Uso de `externalKey`

`externalKey` es el identificador estable de integracion para clientes. Los sistemas cliente deben guardarlo en sus usuarios shadow.

No usar el `id` interno UUID de Identity Hub como identificador de integracion.

## Registro de aplicaciones cliente

Las aplicaciones se crean desde el panel administrativo del Identity Hub.

Datos minimos:

- `clientId`;
- nombre;
- `launchUrl`;
- una o mas `redirectUris` exactas;
- si es confidencial, guardar el `clientSecret` mostrado al crear o regenerar.

El secreto solo se muestra en la respuesta de creacion/regeneracion. No se guarda en claro.

## Asignacion de usuarios

Un usuario debe estar asignado a una aplicacion para:

- recibir authorization code para esa aplicacion;
- aparecer en `/internal/users/assignable`;
- poder refrescar tokens de esa aplicacion.

La asignacion se administra desde el panel del Hub mediante el flujo de provisioning o edicion de usuario.
