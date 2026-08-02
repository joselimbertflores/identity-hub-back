# Identity Hub Architecture

Identity Hub es el proveedor interno de autenticacion SSO/OAuth para aplicaciones cliente. Gaceta e Intranet son ejemplos de clientes que pueden integrarse al Hub.

Su responsabilidad es centralizar:

- autenticacion de usuarios centrales;
- sesion global del navegador en el dominio del Hub;
- registro de aplicaciones cliente;
- asignacion de usuarios a aplicaciones;
- flujo OAuth Authorization Code con PKCE S256 obligatorio;
- emision de JWT RS256 y publicacion de JWKS;
- refresh tokens rotativos;
- configuracion inicial y recuperacion de password mediante acciones de un solo uso;
- endpoints internos para sincronizar usuarios asignados.

Identity Hub no administra roles internos de las aplicaciones cliente. Cada cliente mantiene sus usuarios shadow, permisos y reglas locales.

## Documentos

| Documento                                        | Contenido                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| [backend-modules.md](./backend-modules.md)       | Modulos NestJS, responsabilidades y dependencias                              |
| [client-integration.md](./client-integration.md) | Fuente principal del contrato publico para aplicaciones cliente               |
| [sso-flow.md](./sso-flow.md)                     | Arquitectura interna de login, sesion, OAuth, PKCE, tokens y logout           |
| [oauth-errors.md](./oauth-errors.md)             | Donde se devuelven errores y por que no se redirige a callbacks no confiables |
| [client-user-import.md](./client-user-import.md) | Endpoints internos `/internal/*` para clientes                                |
| [provisioning-flow.md](./provisioning-flow.md)   | Alta, reset, recuperacion y acciones de password de un solo uso               |
| [environment.md](./environment.md)               | Variables de entorno, Docker, migraciones, bootstrap y operacion              |
| [testing.md](./testing.md)                       | Cobertura de pruebas y validaciones manuales pendientes                       |

## Lectura recomendada

1. Leer [client-integration.md](./client-integration.md) para implementar Intranet, Gaceta u otro cliente OAuth.
2. Leer [backend-modules.md](./backend-modules.md) para entender limites de responsabilidad interna.
3. Leer [sso-flow.md](./sso-flow.md) para entender la implementacion interna del flujo.
4. Leer [environment.md](./environment.md) antes de levantar staging o produccion.
5. Leer [client-user-import.md](./client-user-import.md) si una aplicacion necesita importar usuarios asignados.
6. Leer [testing.md](./testing.md) para saber que esta cubierto y que debe probarse manualmente.

## Estado operativo

El backend esta preparado para integracion controlada con clientes si se cumplen estos puntos:

- PostgreSQL y Redis estan disponibles.
- Existe una migracion inicial ejecutada en la base si `DB_SYNCHRONIZE=false`.
- Existe al menos un usuario `ADMIN`, creado por bootstrap manual o por otro proceso controlado.
- Las aplicaciones cliente se registran desde el panel administrativo del Hub.
- Cada aplicacion tiene `clientId`, secreto si es confidencial y `redirectUris` exactas.
- Los usuarios estan asignados a las aplicaciones que pueden usar.
- Las llaves RSA existen fuera del repositorio y el `JWT_ISSUER` es estable.
- El transporte SMTP y las rutas publicas de configuracion de password estan configurados.
