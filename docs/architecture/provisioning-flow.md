# Flujo de provisionamiento de usuarios

## Objetivo

El provisionamiento administra el alta y mantenimiento administrativo de usuarios centrales de Identity Hub. Es un caso de uso compuesto: coordina reglas de usuarios, asignaciones de acceso y generación de documentos.

```text
ProvisioningModule
├── UsersModule
├── AccessModule
└── PrinterModule
```

## Responsabilidades

| Servicio                  | Responsabilidad                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `UserProvisioningService` | Orquestar el flujo completo y delimitar la transacción cuando corresponde                      |
| `UsersService`            | Aplicar reglas propias del usuario central, como alta, actualización y credenciales temporales |
| `UserApplicationsService` | Sincronizar la relación usuario-aplicación desde `AccessModule`                                |
| `PrinterService`          | Convertir una definición de documento en un PDF                                                |

`UserProvisioningService` pertenece a `ProvisioningModule` porque no representa un CRUD simple ni una regla exclusiva del usuario.

## Alta de usuario

1. Recibir los datos del usuario y las aplicaciones asignadas.
2. Crear el usuario central mediante `UsersService`.
3. Sincronizar aplicaciones mediante `UserApplicationsService`.
4. Confirmar la transacción de persistencia.
5. Generar el PDF con las credenciales temporales.
6. Devolver el usuario con sus aplicaciones y el PDF codificado en Base64.
7. Futuro: enviar las credenciales por correo.
8. Futuro: registrar auditoría del proceso.

## Actualización y reinicio de credenciales

La actualización de usuario y aplicaciones se ejecuta dentro de una misma transacción. Si no se reciben aplicaciones, las asignaciones actuales se conservan.

El reinicio de credenciales genera una nueva contraseña temporal, marca el cambio obligatorio en el siguiente ingreso y devuelve un nuevo PDF.

## Rutas preservadas

Con el prefijo global `/api`, las rutas administrativas actuales son:

| Método  | Ruta                               | Propósito                                                   |
| ------- | ---------------------------------- | ----------------------------------------------------------- |
| `POST`  | `/api/users`                       | Crear usuario, asignar aplicaciones y generar PDF           |
| `PATCH` | `/api/users/:id`                   | Actualizar usuario y opcionalmente sincronizar aplicaciones |
| `POST`  | `/api/users/:id/reset-credentials` | Regenerar credenciales temporales y PDF                     |

## Alcance

Este flujo no modifica OAuth, SSO, login, tokens, cookies ni guards. Tampoco importa usuarios desde aplicaciones cliente ni administra roles internos de esos sistemas.
