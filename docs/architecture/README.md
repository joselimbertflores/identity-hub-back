# Architecture Docs

Documentación funcional del backend Identity Hub orientada a mantenimiento, soporte y evolución del flujo SSO/OAuth.

| Documento                                      | Enfoque                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| [backend-modules.md](./backend-modules.md)     | Límites, responsabilidades y reglas de dependencia de los módulos del backend    |
| [provisioning-flow.md](./provisioning-flow.md) | Flujo compuesto para crear usuarios, asignar aplicaciones y generar credenciales |
| [sso-flow.md](./sso-flow.md)                   | Flujo completo SSO/Auth, pasos, endpoints y continuidad del proceso              |
| [oauth-errors.md](./oauth-errors.md)           | Clasificación de errores y canal correcto de salida                              |
| [environment.md](./environment.md)             | Variables de entorno, ejemplos y reemplazo de variables antiguas                 |

Orden recomendado de lectura:

1. `backend-modules.md`
2. `provisioning-flow.md`
3. `sso-flow.md`
4. `oauth-errors.md`
5. `environment.md`
