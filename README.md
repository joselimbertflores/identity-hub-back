# Identity Hub Backend

Identity Hub centraliza la autenticación de usuarios y entrega credenciales OAuth a aplicaciones cliente. Mantiene la sesión SSO, controla qué usuarios pueden acceder a cada cliente y publica las claves necesarias para validar sus tokens.

La documentación se mantiene breve y separada del detalle de endpoints:

- [Índice de documentación](docs/README.md)
- [Configuración de entorno](.env.template)
- [Validación de configuración](src/config/env.validation.ts)

Los scripts disponibles para build, migraciones, bootstrap y pruebas están definidos en [package.json](package.json).
