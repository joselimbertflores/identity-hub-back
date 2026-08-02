# Pruebas y validaciones

El repositorio no contiene actualmente archivos `*.spec.ts`. Esta ausencia es conocida y no se corrige creando pruebas durante el cierre documental de las fases OAuth y password.

## Comandos actuales

- `npm run test` invoca Jest y termina con `No tests found` mientras no existan suites.
- `npm run test:e2e` apunta a `identity-hub.integration.spec.ts`, que no existe actualmente.
- Build, type-check, ESLint, Prettier y `git diff --check` son las verificaciones automatizadas disponibles en el estado actual.

No debe describirse ninguna suite como integracion real: actualmente no hay pruebas que levanten HTTP, PostgreSQL o Redis, ni suites con dobles en memoria.

## Validaciones de integracion pendientes

Antes de produccion conviene automatizar, sin cambiar el contrato funcional:

- authorize sin sesion, login y callback con el mismo `state`;
- PKCE S256 obligatorio, verifier incorrecto y code reutilizado o vencido;
- canje y refresh mediante formulario URL-encoded y HTTP Basic;
- un solo ganador al canjear un code o rotar un refresh concurrentemente;
- usuario inactivo, `mustChangePassword`, aplicacion inactiva y asignacion revocada;
- invalidacion de refresh por cambio de `credentialVersion`;
- sesion central, reanudacion de authorize y logout;
- JWKS, firma RS256, `iss`, `aud`, `exp` y `kid`;
- configuracion inicial, reset, recuperacion y consumo unico de acciones de password;
- rate limiting de login, token, recuperacion, consumo de acciones y `/internal/*`;
- transacciones y restricciones contra PostgreSQL real;
- TTL y scripts atomicos contra Redis real.

## Validaciones manuales para Intranet y Gaceta

1. Registrar la aplicacion, su callback exacto y un usuario asignado.
2. Implementar el contrato de [client-integration.md](./client-integration.md).
3. Verificar callback valido, `state`, PKCE y canje server-to-server.
4. Validar el JWT contra JWKS y la audiencia propia.
5. Rotar el refresh y comprobar que el anterior ya no funciona.
6. Probar code/refresh vencido, consumido e invalidado por cambio de credencial.
7. Separar `invalid_grant` de fallos transitorios 500/503.
8. Verificar logout local y, si corresponde, logout de la sesion central.

## Validacion del esquema

La fase actual no agrega migraciones. En desarrollo se recrea la base con `DB_SYNCHRONIZE=true` y se limpia Redis para descartar refresh tokens sin `credentialVersion`.

Antes de usar `DB_SYNCHRONIZE=false` sobre una base persistente debe generarse y validarse la migracion de `password_action_tokens`, `User.credentialVersion` y los demas cambios de entidad posteriores a la migracion inicial.
