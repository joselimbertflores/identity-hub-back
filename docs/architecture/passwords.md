# Contraseñas

SIAU usa un único concepto temporal para el alta y la recuperación: el usuario tiene, como máximo, un enlace vigente para establecer una nueva contraseña. No distingue entre configuración inicial y restablecimiento.

## Enlaces temporales

`password_action_tokens` contiene únicamente `id`, `userId`, `tokenHash`, `expiresAt` y `createdAt`. `userId` y `tokenHash` son únicos. Emitir un enlace elimina el anterior del mismo usuario; la tabla no es un historial ni almacena el código en claro.

La vigencia se configura con `PASSWORD_ACTION_TTL_SECONDS`. El enlace solo puede consumirse si el token no venció y el usuario continúa activo.

## Alta de usuario

El alta administrativa crea la cuenta con una contraseña aleatoria desconocida que no se entrega ni puede usarse como contraseña temporal. En la misma transacción emite el enlace y, después del commit, intenta enviarlo al correo registrado. Hasta establecer una contraseña mediante ese enlace, el usuario no conoce una credencial con la que pueda autenticarse.

Si el enlace vence o el correo no se entrega, el usuario puede solicitar otro mediante el flujo público “No puedo acceder”. No existe un estado `mustChangePassword` ni una pausa especial del flujo OIDC.

## “No puedo acceder”

`POST /auth/forgot-password` acepta el identificador soportado —login o correo—, tiene rate limiting y siempre devuelve una respuesta genérica. Solo las cuentas activas con correo válido reciben el mensaje. La solicitud reemplaza cualquier enlace anterior, pero no modifica la contraseña, no incrementa `credentialVersion` y no cierra sesiones.

`POST /auth/password-actions/complete` valida el código y su expiración. Al completarlo correctamente:

- guarda la nueva contraseña;
- incrementa `credentialVersion`;
- elimina el enlace temporal;
- revoca todas las sesiones centrales y ejecuta Back-Channel Logout para sus clientes participantes;
- intenta enviar una notificación informativa del cambio.

El fallo de esa notificación no revierte el cambio de contraseña.

## Cambio voluntario

`PATCH /auth/change-password` se mantiene para usuarios autenticados. Exige la contraseña actual, la nueva contraseña y su confirmación. El cambio incrementa `credentialVersion`, elimina cualquier enlace pendiente, revoca las sesiones anteriores, ejecuta Back-Channel Logout y crea una nueva sesión para la solicitud autenticada. La notificación por correo también es de mejor esfuerzo.

## Desactivación, correo y administración

Cuando `isActive` pasa a `false`, SIAU incrementa `credentialVersion`, elimina cualquier enlace pendiente y revoca sesiones con Back-Channel Logout. Reactivar la cuenta no restaura enlaces ni sesiones anteriores. Cambiar el correo también elimina el enlace pendiente porque fue emitido para la dirección anterior.

No existen endpoints administrativos para forzar un restablecimiento o reenviar enlaces, ni se expone el estado del enlace en el listado de usuarios. El usuario obtiene un enlace nuevo mediante “No puedo acceder”. El antiguo bootstrap del primer administrador fue retirado; una instalación futura debe usar un seed o comando explícito diseñado para ese propósito.
