# Arquitectura modular del backend

## Criterio de organización

El backend se organiza por dominios y capacidades funcionales. Un módulo NestJS debe agrupar reglas que cambian por la misma razón y exponer servicios claros cuando otro módulo necesita utilizarlas.

No se crea un módulo por cada entidad. Por ejemplo, los roles propios de Identity Hub pueden vivir dentro de `UsersModule` si forman parte del dominio de usuarios centrales.

Identity Hub conoce usuarios centrales, aplicaciones cliente y asignaciones usuario-aplicación. No administra los roles internos de los sistemas cliente. Cada sistema cliente mantiene sus usuarios shadow y sus roles locales.

## Responsabilidades

| Componente           | Responsabilidad                                                            | No debe hacer                                                                    | Contenido esperado                                                            |
| -------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `UsersModule`        | Administrar usuarios centrales y sus reglas propias                        | Orquestar asignaciones, documentos o roles internos de clientes                  | Entidad `User`, consultas, CRUD y reglas de credenciales                      |
| `AccessModule`       | Administrar aplicaciones cliente y asignaciones usuario-aplicación         | Administrar el ciclo de vida del usuario central o sus roles locales en clientes | Aplicaciones, portal de acceso y `UserApplicationsService`                    |
| `ProvisioningModule` | Coordinar casos de uso que cruzan Users, Access y Printer                  | Convertirse en propietario de las reglas internas de esos módulos                | Controller y servicios de orquestación de provisionamiento                    |
| `AuthModule`         | Autenticar usuarios, administrar sesiones y ejecutar el flujo OAuth actual | Absorber CRUD de usuarios o lógica de provisionamiento                           | Login, logout, cambio de contraseña, tokens, JWKS, guards y controllers OAuth |
| `PrinterModule`      | Generar documentos PDF a partir de una definición recibida                 | Conocer reglas de usuarios, acceso o autenticación                               | `PrinterService` y configuración de PDF                                       |
| `common`             | Compartir DTO y utilidades transversales simples                           | Acumular reglas de dominio o actuar como contenedor genérico de servicios        | DTO de paginación y utilidades reutilizables                                  |

Actualmente OAuth no es un módulo NestJS separado: sus controllers y servicios pertenecen a `AuthModule`. La carpeta `common` tampoco declara un `CommonModule`, porque todavía no expone providers que requieran inyección de dependencias.

## Motivo de ProvisioningModule

Crear un usuario administrativo no es un CRUD simple. El flujo crea o actualiza un usuario central, sincroniza sus aplicaciones y puede generar un PDF con credenciales temporales.

`ProvisioningModule` existe para:

- coordinar `UsersModule`, `AccessModule` y `PrinterModule`;
- mantener `UsersModule` enfocado en el dominio de usuarios;
- permitir futuras integraciones de correo, auditoría o reportes sin acoplarlas al CRUD;
- evitar dependencias circulares entre módulos de dominio.

## Reglas de dependencia

- Cada módulo de dominio expone solo los servicios que otros módulos necesitan.
- Un módulo consumidor importa el módulo propietario del servicio; no registra nuevamente sus providers.
- Los módulos de dominio no deben depender entre sí en ambas direcciones.
- Si un caso de uso coordina varios dominios, debe evaluarse un módulo orquestador como `ProvisioningModule`.
- Las relaciones de persistencia entre entidades no transfieren la propiedad funcional de un dominio a otro.

La dependencia principal del provisionamiento es:

```text
ProvisioningModule
├── UsersModule
├── AccessModule
└── PrinterModule
```
