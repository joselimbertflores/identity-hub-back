# Documentación de SIAU

SIAU (Sistema de Identidad y Acceso Unificado) centraliza la identidad y el acceso de las aplicaciones cliente.

Lectura recomendada:

1. [Visión general](architecture/overview.md): propósito, límites, componentes, identidad y modelo de contraseñas.
2. [Flujo SSO y OIDC](architecture/sso-flow.md): protocolo, sesión central, autorización, tokens y Single Logout.
3. [Integración de clientes](architecture/client-integration.md): guía autocontenida para registrar e integrar una aplicación.

La configuración completa vive en [`.env.template`](../.env.template). Los endpoints y DTO actuales deben consultarse en [`src/modules`](../src/modules); esta documentación explica solo el comportamiento que los clientes y mantenedores necesitan conservar.
