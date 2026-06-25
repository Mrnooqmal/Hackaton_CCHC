# Roles de Usuario

La plataforma define **5 roles**, cada uno con su propio conjunto de permisos. El rol
determina qué módulos y acciones están disponibles para cada persona dentro de su empresa.

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
| Mi Empresa | ✓ | ✗ | ✗ | ✗ | ✗ |

> Esta tabla refleja el comportamiento de referencia. Algunos accesos pueden ajustarse según
> la configuración de roles de tu empresa (ver [Mi Empresa](/modulos/tenants)).

## Notas sobre los permisos

- **Firmas** es transversal: todo rol puede firmar lo que le corresponde (un trabajador
  firma su recepción de EPP, un supervisor firma como relator, etc.).
- **Tenants** es exclusivo del admin (configuración de la empresa).
- **Asistente IA** suele restringirse a roles técnicos (admin, prevencionista) y al
  plan contratado del tenant.
- El **trabajador** tiene principalmente acceso de lectura y firma sobre lo que se le
  asigna; no gestiona obras ni personas.
