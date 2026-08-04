# Documentación de Identity Hub

Lectura recomendada:

1. [Visión general](architecture/overview.md): propósito, límites, componentes y decisiones que forman parte del contrato.
2. [Flujo SSO y OAuth](architecture/sso-flow.md): sesión central, autorización, tokens, reutilización de sesión y logout.
3. [Integración de clientes](architecture/client-integration.md): registro de una aplicación y responsabilidades de su backend.

La configuración completa vive en [`.env.template`](../.env.template). Los endpoints y DTO actuales deben consultarse en [`src/modules`](../src/modules); esta documentación explica solo el comportamiento que los clientes y mantenedores necesitan conservar.
