# Modulos del backend

El backend se organiza por capacidades funcionales. Cada modulo NestJS agrupa reglas que cambian por la misma razon y expone solo los servicios que otros modulos necesitan.

## Modulos principales

| Modulo               | Responsabilidad                                                                       | No debe hacer                                       |
| -------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `AuthModule`         | Login, sesion global, guards, OAuth, PKCE, JWT, JWKS, refresh tokens y logout         | Administrar CRUD general de usuarios o aplicaciones |
| `UsersModule`        | Usuarios centrales, credenciales, busqueda administrativa y directorio interno seguro | Administrar roles internos de clientes              |
| `AccessModule`       | Aplicaciones cliente, secretos, portal de acceso y asignacion usuario-aplicacion      | Autenticar usuarios finales o emitir tokens         |
| `ProvisioningModule` | Orquestar alta/actualizacion de usuarios con aplicaciones y credenciales temporales   | Reemplazar reglas internas de Users o Access        |
| `PrinterModule`      | Generar PDF desde definiciones recibidas                                              | Conocer reglas de OAuth, usuarios o aplicaciones    |
| `common`             | DTOs y constantes transversales simples                                               | Acumular logica de dominio                          |

## Dependencias

```text
AppModule
|-- AuthModule
|-- UsersModule
|-- AccessModule
|-- ProvisioningModule
`-- PrinterModule
```

`ProvisioningModule` coordina:

```text
ProvisioningModule
|-- UsersModule
|-- AccessModule
`-- PrinterModule
```

`UsersModule` importa `AccessModule` para proteger `/internal/users/*` con credenciales de aplicacion. `AccessModule` no importa `UsersModule`, por lo que no hay dependencia circular.

## Responsabilidades sensibles

- `OAuthService` ejecuta el flujo Authorization Code y delega PKCE en `PkceService`.
- `TokenService` emite access tokens y administra refresh tokens rotativos en Redis.
- `AuthService` autentica usuarios, crea sesiones y revoca refresh tokens en logout.
- `ApplicationClientAuthService` valida Basic Auth para endpoints internos.
- `UserApplicationsService` sincroniza asignaciones usuario-aplicacion dentro de transacciones de provisioning.

## Reglas de mantenimiento

- Mantener OAuth dentro de `AuthModule` mientras el flujo siga acotado.
- No separar servicios pequenos si solo mueven complejidad sin reducirla.
- No mezclar Basic Auth interno con OAuth de usuarios finales.
- No registrar aplicaciones cliente desde variables de entorno.
- No exponer hashes, passwords, refresh tokens, authorization codes, secretos ni `code_verifier` en logs.
