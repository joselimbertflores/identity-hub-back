# Pruebas y validaciones

El proyecto conserva pruebas unitarias/de integracion en `src/**/*.spec.ts`.

## Suites actuales

| Archivo                                                      | Enfoque                                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `src/modules/auth/services/oauth.service.spec.ts`            | Casos focalizados de OAuthService, DTOs y PKCE                                      |
| `src/modules/auth/services/identity-hub.integration.spec.ts` | Flujo SSO/OAuth completo con servicios reales, repositorios fake y Redis en memoria |

`npm run test` ejecuta todas las suites.

`npm run test:e2e` ejecuta la suite de integracion del Identity Hub. No levanta una app HTTP completa ni usa Postgres/Redis reales.

## Cobertura conservada

Las pruebas cubren:

- authorize sin sesion crea flujo pendiente;
- login exitoso reanuda el flujo;
- usuario inactivo no inicia sesion;
- usuario sin acceso no recibe authorization code;
- aplicacion inactiva no inicia flujo;
- `redirect_uri` invalida no redirige a URL no registrada;
- `state` ausente falla en validacion;
- `response_type` distinto de `code` falla;
- `client_id` invalido falla;
- `scope` invalido falla porque no hay soporte real de scopes;
- PKCE obligatorio con `S256`;
- `plain` rechazado;
- `code_verifier` faltante o incorrecto falla;
- code valido emite tokens;
- authorization code de un solo uso;
- code expirado;
- code con otro `redirect_uri` o `clientId`;
- access token RS256 con `issuer`, `audience`, `subject`, expiracion y `kid`;
- JWKS con llave publica;
- refresh token rotativo;
- refresh token anterior o invalido falla;
- logout elimina sesion y revoca refresh tokens;
- endpoints internos con Basic Auth;
- respuesta segura de usuarios asignables.

## Lo que no cubren

Las pruebas actuales no validan:

- una app Nest HTTP completa con Supertest;
- `ValidationPipe` global desde requests HTTP reales;
- CORS real;
- cookie transport real en navegador;
- throttling real por IP;
- Redis real y expiraciones reales;
- Postgres real;
- migraciones contra una base real dentro del test runner;
- ServeStaticModule sirviendo Angular.

Estas validaciones deben ejecutarse manualmente o en una suite de infraestructura dedicada.

## Validacion de migraciones

Para validar una base limpia sin usar bootstrap:

1. Crear una base temporal.
2. Exportar variables `DATABASE_*` hacia esa base.
3. Configurar `DB_SYNCHRONIZE=false`.
4. Ejecutar `npm run migration:run`.
5. Confirmar que existen `applications`, `user`, `user_applications` y `migrations`.
6. Eliminar la base temporal.

## Validaciones manuales con Gaceta/Intranet

1. Registrar la aplicacion desde el panel del Hub.
2. Registrar `redirect_uri` exacta.
3. Guardar el `clientSecret` si la app es confidencial.
4. Asignar un usuario activo a la aplicacion.
5. Iniciar `/oauth/authorize` sin sesion y verificar redirect a login.
6. Hacer login y verificar callback con `code` y mismo `state`.
7. Canjear code con `code_verifier` correcto.
8. Validar JWT contra JWKS, `iss`, `aud`, `exp` y firma RS256.
9. Probar `redirect_uri` invalida, `state` ausente, PKCE incorrecto y code reutilizado.
10. Probar refresh rotation: el refresh anterior debe fallar.
11. Probar logout: la sesion se borra y el refresh queda revocado.
12. Probar `/internal/users/assignable` sin Basic Auth, con secreto invalido, app inactiva y app valida.

## Recomendacion futura

Agregar una suite separada de infraestructura con Postgres y Redis reales, idealmente usando contenedores dedicados para tests. Esa suite debe seguir sin ejecutar `bootstrap:run` salvo que el setup de pruebas lo controle explicitamente.
