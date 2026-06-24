# Rol: Supervisor

El **supervisor** lidera a un equipo de trabajadores en terreno. Es un rol operativo
clave en la captura de firmas y el registro de actividades.

## Responsabilidades

- Supervisar a los trabajadores de su equipo en la obra.
- Dictar y firmar charlas y capacitaciones como **relator**.
- Verificar y firmar la entrega de EPP.
- Reportar incidentes y condiciones subestándar.

## Permisos

| Módulo | Acceso |
| --- | --- |
| Dashboard | ✓ Estado de su equipo y firmas pendientes |
| Obras | 👁 Solo lectura |
| Documentos | 👁 Solo lectura |
| Firmas | ✓ Firma propia y como relator |
| Incidentes | ✓ Reportar y dar seguimiento |
| Actividades | ✓ Dictar y firmar como relator |
| Encuestas | 👁 Solo lectura |
| Asistente IA | ✗ Sin acceso |
| Personas | 👁 Solo lectura (su equipo) |
| Bandeja de Entrada | ✓ Completo |
| Tenants | ✗ Sin acceso |

## Firma como relator

El supervisor es uno de los roles que puede actuar como **relator** en actividades
(`CAPACITACION_SST`, `CHARLA_5MIN`). Su firma cruzada (`tipoFirma: relator`) certifica
que la actividad se impartió, complementando las firmas de asistencia de los
trabajadores. Ver [Capacitaciones](/ds44/capacitaciones) y [Firmas](/modulos/firmas).

## Verificación de EPP

Firma como `supervisor` la entrega de EPP, validando que el trabajador recibió el equipo
adecuado a su cargo. Ver [Entrega de EPP](/ds44/epp).
