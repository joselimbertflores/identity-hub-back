# Architecture Docs

Documentación funcional del backend Identity Hub orientada a mantenimiento, soporte y evolución del flujo SSO/OAuth.

| Documento                                        | Enfoque                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| [backend-modules.md](./backend-modules.md)       | Límites, responsabilidades y reglas de dependencia de los módulos del backend    |
| [client-user-import.md](./client-user-import.md) | Catálogo interno para importar usuarios en aplicaciones cliente                  |
| [provisioning-flow.md](./provisioning-flow.md)   | Flujo compuesto para crear usuarios, asignar aplicaciones y generar credenciales |
| [sso-flow.md](./sso-flow.md)                     | Flujo completo SSO/Auth, pasos, endpoints y continuidad del proceso              |
| [oauth-errors.md](./oauth-errors.md)             | Clasificación de errores y canal correcto de salida                              |
| [environment.md](./environment.md)               | Variables de entorno, ejemplos y reemplazo de variables antiguas                 |

Orden recomendado de lectura:

1. `backend-modules.md`
2. `client-user-import.md`
3. `provisioning-flow.md`
4. `sso-flow.md`
5. `oauth-errors.md`
6. `environment.md`
