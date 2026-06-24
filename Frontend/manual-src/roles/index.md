# Roles de Usuario

Build & Serve define **5 roles**, cada uno con un conjunto de permisos derivados
(`persona.permisos`). El rol determina qué módulos y acciones están disponibles para
cada persona dentro de su tenant.

| Rol | Resumen |
| --- | --- |
| [Admin](/roles/admin) | Gestión completa del tenant |
| [Prevencionista](/roles/prevencionista) | Gestión preventiva: documentos, actividades, reportes |
| [Jefe de Obra](/roles/jefe-obra) | Gestión operativa de la obra |
| [Supervisor](/roles/supervisor) | Supervisión de equipo y firma como relator |
| [Trabajador](/roles/trabajador) | Firma de documentos y registro de asistencia |

## Tabla comparativa de permisos

Leyenda: ✓ acceso completo · 👁 solo lectura · ✗ sin acceso

| Módulo | Admin | Prevencionista | Jefe de Obra | Supervisor | Trabajador |
| --- | :---: | :---: | :---: | :---: | :---: |
| Dashboard | ✓ | ✓ | ✓ | ✓ | 👁 |
| Obras | ✓ | 👁 | ✓ | 👁 | ✗ |
| Documentos | ✓ | ✓ | 👁 | 👁 | 👁 |
| Firmas | ✓ | ✓ | ✓ | ✓ | ✓ |
| Incidentes | ✓ | ✓ | ✓ | ✓ | 👁 |
| Actividades | ✓ | ✓ | 👁 | ✓ | 👁 |
| Encuestas | ✓ | ✓ | 👁 | 👁 | 👁 |
| Asistente IA | ✓ | ✓ | 👁 | ✗ | ✗ |
| Personas | ✓ | 👁 | 👁 | 👁 | ✗ |
| Bandeja de Entrada | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tenants | ✓ | ✗ | ✗ | ✗ | ✗ |

> La matriz refleja el comportamiento de referencia. Los permisos efectivos se
> derivan del rol en `persona.permisos` y se validan en el backend
> (`lib/permissions.js`). Algunos accesos pueden ajustarse por configuración del tenant.

## Notas sobre los permisos

- **Firmas** es transversal: todo rol puede firmar lo que le corresponde (un trabajador
  firma su recepción de EPP, un supervisor firma como relator, etc.).
- **Tenants** es exclusivo del admin (configuración de la empresa).
- **Asistente IA** suele restringirse a roles técnicos (admin, prevencionista) y al
  plan contratado del tenant.
- El **trabajador** tiene principalmente acceso de lectura y firma sobre lo que se le
  asigna; no gestiona obras ni personas.
