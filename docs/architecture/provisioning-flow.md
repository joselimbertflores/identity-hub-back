# Provisioning y acciones de password

Identity Hub nunca genera una password para entregarla a un usuario o administrador. El alta inicial y los resets administrativos guardan una password interna aleatoria no utilizable y entregan una accion de un solo uso para que el usuario establezca la password definitiva.

Las acciones viven en PostgreSQL, no en Redis. La tabla `password_action_tokens` representa solamente el estado pendiente y conserva un unico registro por usuario:

- `purpose`: `INITIAL_SETUP` o `PASSWORD_RESET`;
- `tokenHash`: SHA-256 del codigo normalizado; el codigo real no se persiste;
- `expiresAt` y `createdAt`;
- relacion con el usuario, eliminada en cascada.

Una accion nueva reemplaza la anterior sin importar su proposito. No existe historial, estado de consumo ni auditoria en esta tabla.

## Cuatro flujos distintos

### 1. Configuracion inicial

`POST /api/users` recibe los datos del usuario, el `email` opcional y `applicationIds`.

Antes de abrir la transaccion se genera la password interna aleatoria y se calcula su hash bcrypt. Dentro de una transaccion corta:

1. `UsersService` crea el usuario con el hash ya preparado; la password interna nunca se devuelve.
2. Se establece `mustChangePassword=true`.
3. Se sincronizan las asignaciones usuario-aplicacion.
4. Se crea una accion `INITIAL_SETUP` que vence en 24 horas por defecto.
5. Se confirma la transaccion.

La entrega por correo o manual ocurre despues del commit. Ya no se genera PDF ni QR.

### 2. Reset administrativo

`POST /api/users/:id/password-reset` prepara fuera de la transaccion una nueva password interna aleatoria y su hash bcrypt. Bajo bloqueo solo reemplaza el hash, establece `mustChangePassword=true`, incrementa `credentialVersion` y reemplaza cualquier accion pendiente por una accion `PASSWORD_RESET`.

Despues del commit se intenta limpiar los refresh tokens vigentes y se entrega la accion. La limpieza Redis es best effort: si falla, no revierte ni marca como fallido el reset, porque la version almacenada en esos tokens ya no coincide con PostgreSQL. Los access tokens JWT existentes continuan hasta su expiracion; nuevos authorization codes, canjes y refresh quedan bloqueados por `mustChangePassword`.

### 3. Recuperacion publica

`POST /api/auth/forgot-password` acepta:

```json
{
  "identifier": "login-o-correo@institucion.example"
}
```

Siempre responde `200` con el mismo mensaje:

```json
{
  "message": "If the account is eligible, password recovery instructions will be sent."
}
```

Solo un usuario existente, activo y con correo recibe una accion `PASSWORD_RESET`. La solicitud no modifica la password actual, no cambia `mustChangePassword`, no incrementa `credentialVersion`, no cierra la sesion y no revoca tokens. La accion se confirma primero y el envio SMTP se inicia despues como best effort sin retrasar la respuesta publica; su resultado no se expone. Un usuario sin correo debe usar el procedimiento administrativo.

### 4. Cambio autenticado

`PATCH /api/auth/change-password` permanece separado de `PasswordActionToken` y requiere una sesion central:

```json
{
  "currentPassword": "password-actual",
  "newPassword": "password-nueva",
  "passwordConfirmation": "password-nueva"
}
```

El backend carga el hash y `credentialVersion`, verifica la password actual y calcula el hash nuevo antes de abrir la transaccion. Bajo bloqueo vuelve a comparar el hash y la version leidos; si otro cambio concurrente modifico cualquiera, rechaza sin sobrescribirlo. Solo entonces guarda el hash preparado, establece `mustChangePassword=false` e incrementa la version. Despues del commit intenta limpiar refresh tokens y conserva la sesion central. Si existe correo, intenta enviar una notificacion; una falla Redis o SMTP no revierte el cambio.

Este endpoint conserva la reanudacion OAuth de la fase anterior mediante su `redirectUrl`. La configuracion o recuperacion por codigo no inicia sesion ni reanuda OAuth: finaliza dirigiendo al usuario al login normal.

## Consumo de una accion

`POST /api/auth/password-actions/complete` es publico, tiene rate limiting y recibe:

```json
{
  "code": "ABCDE-FGHJK-MNPQR-STVWX-YZ234-56789",
  "newPassword": "password-nueva",
  "passwordConfirmation": "password-nueva"
}
```

El codigo se normaliza y se consulta preliminarmente por SHA-256. Si existe y no esta evidentemente vencido, el hash bcrypt de la nueva password se calcula antes de abrir la transaccion. Bajo bloqueo se vuelven a validar existencia, hash, expiracion, proposito y usuario activo; la lectura previa no sustituye esta comprobacion. Luego se guarda el hash preparado, se limpia `mustChangePassword`, se incrementa `credentialVersion` una sola vez y se elimina la accion.

Solo una de dos solicitudes concurrentes puede confirmar. La perdedora y los codigos inexistentes, vencidos, consumidos o asociados a usuarios no elegibles reciben el mismo `400`:

```json
{
  "message": "The password action code is invalid or expired.",
  "error": "Bad Request",
  "statusCode": 400
}
```

Tras el commit se intenta limpiar los refresh tokens como best effort. La seguridad no depende de que Redis elimine fisicamente esas claves: el refresh conserva la version anterior y falla contra PostgreSQL. No se inicia sesion ni se emiten tokens OAuth.

Respuesta exitosa `200`:

```json
{
  "message": "Password updated successfully. Sign in with your new password."
}
```

## Entrega

Crear, resetear y regenerar devuelven el mismo contrato discriminado bajo `passwordAction`.

Correo enviado:

```json
{
  "method": "EMAIL",
  "status": "SENT",
  "expiresAt": "2026-08-02T12:00:00.000Z"
}
```

Sin correo registrado:

```json
{
  "method": "MANUAL",
  "code": "ABCDE-FGHJK-MNPQR-STVWX-YZ234-56789",
  "actionUrl": "https://hub.example/set-password?code=ABCDE-FGHJK-MNPQR-STVWX-YZ234-56789",
  "expiresAt": "2026-08-02T12:00:00.000Z"
}
```

Fallo SMTP despues del commit:

```json
{
  "method": "EMAIL",
  "status": "FAILED",
  "expiresAt": "2026-08-02T12:00:00.000Z",
  "fallback": {
    "code": "ABCDE-FGHJK-MNPQR-STVWX-YZ234-56789",
    "actionUrl": "https://hub.example/set-password?code=ABCDE-FGHJK-MNPQR-STVWX-YZ234-56789"
  }
}
```

El fallo de correo no revierte el usuario, reset o accion. No se exponen detalles SMTP. El administrador debe entregar el fallback por un canal institucional apropiado.

Si existe correo y el envio funciona, ni el codigo ni la URL aparecen en la respuesta administrativa. El correo registrado debe ser correcto; su calidad es responsabilidad de la administracion.

## Regeneracion

`POST /api/users/:id/password-action/regenerate` requiere rol `ADMIN`. Solo regenera una accion pendiente: crea un codigo nuevo, invalida el anterior, conserva el proposito y reinicia su expiracion. No intenta recuperar el codigo anterior ni incrementa `credentialVersion`.

La emision, el reset, la recuperacion y la regeneracion bloquean pesimisticamente al usuario antes de reemplazar la accion. Todas las rutas de escritura siguen el orden usuario-accion, por lo que dos solicitudes concurrentes se serializan y la restriccion unica no se usa como control de flujo ni produce un `500` esperado.

## Rutas administrativas

| Metodo  | Ruta                                        | Uso                                             |
| ------- | ------------------------------------------- | ----------------------------------------------- |
| `POST`  | `/api/users`                                | Crear usuario, asignaciones y configuracion     |
| `PATCH` | `/api/users/:id`                            | Actualizar usuario y opcionalmente aplicaciones |
| `POST`  | `/api/users/:id/password-reset`             | Crear reset administrativo                      |
| `POST`  | `/api/users/:id/password-action/regenerate` | Reemplazar la accion pendiente                  |
| `GET`   | `/api/users`                                | Listar usuarios para administracion             |

Usuario inexistente produce `404`; login o correo duplicado produce `409`. Todas las rutas administrativas requieren sesion del Hub y rol `ADMIN`.

## Responsabilidades

| Componente                | Responsabilidad                                                   |
| ------------------------- | ----------------------------------------------------------------- |
| `UserProvisioningService` | Orquestar alta/reset, transacciones y entrega posterior al commit |
| `UsersService`            | Persistir usuario, password bcrypt y reglas propias del usuario   |
| `UserApplicationsService` | Sincronizar asignaciones usuario-aplicacion                       |
| `PasswordActionService`   | Emitir, reemplazar, consumir y construir URL de acciones          |
| `MailService`             | Transporte SMTP y plantillas basicas de password                  |

La UI debe mostrar el codigo manual y puede generar un QR usando `actionUrl`; el backend no genera imagenes. La ruta `PASSWORD_ACTION_UI_PATH` es interna del Hub y no es un callback OAuth registrado.

## Bootstrap

El bootstrap manual conserva su contrato operativo existente para crear el primer `ADMIN` y no imprime passwords ni secretos. No reemplaza provisioning ni crea aplicaciones o asignaciones.
