# Modulos del backend

El backend se organiza por capacidades funcionales. Cada modulo NestJS agrupa reglas que cambian por la misma razon y expone solo los servicios que otros modulos necesitan.

## Modulos principales

| Modulo               | Responsabilidad                                                                       | No debe hacer                                       |
| -------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `AuthModule`         | Login, sesion, OAuth, tokens y acciones acotadas de password                          | Administrar CRUD general de usuarios o aplicaciones |
| `UsersModule`        | Usuarios centrales, credenciales, busqueda administrativa y directorio interno seguro | Administrar roles internos de clientes              |
| `AccessModule`       | Aplicaciones cliente, secretos, portal de acceso y asignacion usuario-aplicacion      | Autenticar usuarios finales o emitir tokens         |
| `ProvisioningModule` | Orquestar alta/reset de usuarios, aplicaciones y entrega de acciones de password      | Reemplazar reglas internas de Users, Access o Auth  |
| `common`             | DTOs y constantes transversales simples                                               | Acumular logica de dominio                          |

## Dependencias

```text
AppModule
|-- AuthModule
|-- UsersModule
|-- AccessModule
`-- ProvisioningModule
```

`ProvisioningModule` coordina:

```text
ProvisioningModule
|-- UsersModule
|-- AccessModule
`-- AuthModule
```

`UsersModule` importa `AccessModule` para proteger `/internal/users/*` con credenciales de aplicacion. `AccessModule` no importa `UsersModule`, por lo que no hay dependencia circular.

## Responsabilidades sensibles

- `OAuthService` ejecuta el flujo Authorization Code y delega PKCE en `PkceService`.
- `TokenService` emite access tokens y administra refresh tokens rotativos en Redis.
- `AuthService` autentica usuarios, crea sesiones y revoca refresh tokens en logout.
- `PasswordActionService` emite y consume acciones de configuracion/reset en PostgreSQL.
- `MailService` encapsula solamente transporte SMTP y plantillas basicas de password.
- `ApplicationClientAuthService` valida Basic Auth para endpoints internos.
- `UserApplicationsService` sincroniza asignaciones usuario-aplicacion dentro de transacciones de provisioning.
- `UserProvisioningService` coordina usuario, asignaciones y accion en una transaccion; la entrega se intenta despues del commit.

## Reglas de mantenimiento

- Mantener OAuth dentro de `AuthModule` mientras el flujo siga acotado.
- No separar servicios pequenos si solo mueven complejidad sin reducirla.
- No mezclar Basic Auth interno con OAuth de usuarios finales.
- No registrar aplicaciones cliente desde variables de entorno.
- No exponer hashes, passwords, refresh tokens, authorization codes, secretos ni `code_verifier` en logs.
- No persistir ni volver a consultar el codigo real de una accion de password; solo se almacena su SHA-256.
