# Rol: Admin

El **administrador** tiene la gestión completa de su tenant. Es el rol con mayor alcance
dentro de una empresa cliente (no confundir con el superadmin del `tenant-0`, que tiene
acceso cross-tenant).

## Responsabilidades

- Configurar la empresa (datos, plan, personalización, módulos activos).
- Crear y gestionar obras.
- Gestionar personas y asignar roles.
- Supervisar el cumplimiento documental de todas las obras.
- Acceder a toda la reportería y KPIs del tenant.

## Permisos

| Módulo | Acceso |
| --- | --- |
| Dashboard | ✓ Completo (KPIs agregados de todas las obras) |
| Obras | ✓ Crear, editar, avanzar fase |
| Documentos | ✓ Completo |
| Firmas | ✓ Completo |
| Incidentes | ✓ Completo |
| Actividades | ✓ Completo |
| Encuestas | ✓ Completo |
| Asistente IA | ✓ Completo |
| Personas | ✓ Crear, editar, asignar roles |
| Bandeja de Entrada | ✓ Completo |
| Tenants | ✓ Configuración de la empresa |

## Configuración exclusiva

El admin es el único rol que accede a la sección [Mi Empresa](/modulos/tenants), donde puede:

- Definir los datos y la **identidad** de la empresa (logo y color).
- Gestionar los **roles** y sus permisos.
- Mantener el catálogo de **cargos**.

El admin se crea automáticamente durante el [onboarding del tenant](/guia-inicio/onboarding).
