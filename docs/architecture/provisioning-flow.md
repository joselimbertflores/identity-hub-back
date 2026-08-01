# Provisioning de usuarios

El provisioning administra usuarios centrales del Identity Hub desde el panel administrativo.

No forma parte del flujo OAuth publico. Es un caso de uso administrativo que coordina usuarios, asignacion de aplicaciones y credenciales temporales.

## Responsabilidades

| Componente                | Responsabilidad                                         |
| ------------------------- | ------------------------------------------------------- |
| `UserProvisioningService` | Orquestar alta/actualizacion y transacciones            |
| `UsersService`            | Crear usuarios, actualizar datos y administrar password |
| `UserApplicationsService` | Sincronizar asignaciones usuario-aplicacion             |
| `PrinterService`          | Generar PDF de credenciales temporales                  |

## Alta de usuario

1. El administrador envia datos del usuario y `applicationIds`.
2. `UsersService` crea el usuario central con password temporal y `mustChangePassword=true`.
3. `UserApplicationsService` valida aplicaciones activas y sincroniza asignaciones.
4. La transaccion confirma usuario y relaciones.
5. Se genera un PDF con credenciales temporales.
6. La respuesta devuelve usuario con aplicaciones y `credentialsPdfBase64`.

## Actualizacion

`PATCH /api/users/:id` actualiza datos del usuario. Si se envia `applicationIds`, se sincronizan asignaciones. Si no se envia, se conservan las actuales.

## Reset de credenciales

`POST /api/users/:id/reset-credentials` genera una nueva password temporal, marca `mustChangePassword=true` y devuelve un PDF nuevo.

Desde ese reset no se emiten nuevos authorization codes ni pares de tokens para el usuario hasta que este cambie correctamente la password. Los codes presentados y los refresh tokens existentes son rechazados por la validacion central de OAuth. Los access tokens JWT ya emitidos conservan su expiracion normal.

Solo `PATCH /api/auth/change-password`, ejecutado por el usuario dentro de su sesion central, establece `mustChangePassword=false`. Provisioning y administracion no limpian el flag al entregar una credencial temporal.

## Rutas administrativas

Con el prefijo global `/api`:

| Metodo  | Ruta                                      | Uso                                             |
| ------- | ----------------------------------------- | ----------------------------------------------- |
| `POST`  | `/api/users`                              | Crear usuario y asignar aplicaciones            |
| `PATCH` | `/api/users/:id`                          | Actualizar usuario y opcionalmente aplicaciones |
| `POST`  | `/api/users/:id/reset-credentials`        | Regenerar credenciales temporales               |
| `GET`   | `/api/users`                              | Listar usuarios para administracion             |
| `POST`  | `/api/applications`                       | Crear aplicacion cliente                        |
| `PATCH` | `/api/applications/:id`                   | Actualizar aplicacion cliente                   |
| `POST`  | `/api/applications/:id/regenerate-secret` | Regenerar secreto                               |

Todas requieren sesion del Hub y rol `ADMIN`.

## Bootstrap vs provisioning

El bootstrap manual (`npm run bootstrap:run`) solo crea el primer usuario `ADMIN` si no existe ningun admin.

No crea aplicaciones cliente, no asigna usuarios y no reemplaza el panel administrativo.

El usuario bootstrap se crea con `mustChangePassword=true`, igual que cualquier otra credencial inicial administrada.

## Datos sensibles

- La password temporal se devuelve en PDF base64 solo como resultado del alta/reset.
- El secreto de aplicacion se devuelve solo al crear o regenerar.
- No se deben loguear passwords, secretos ni PDFs de credenciales.

## Limites

Identity Hub no administra roles internos de las aplicaciones cliente. Solo decide si el usuario central puede acceder a la aplicacion cliente.
