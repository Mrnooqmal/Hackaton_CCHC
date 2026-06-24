# Módulo: Dashboard

**Ubicación:** `Frontend/src/pages/Dashboard.tsx`

El Dashboard es el panel principal de la plataforma. Ofrece una vista de un vistazo del
estado de seguridad de la obra activa, con indicadores clave (KPIs) y accesos directos
a las acciones más frecuentes.

## Indicadores clave

| Indicador | Qué mide |
| --- | --- |
| Días sin accidentes | Días transcurridos desde el último accidente registrado |
| Trabajadores activos | Personas activas asignadas a la obra |
| Total de documentos | Documentos de la obra y su estado de cumplimiento |
| Actividades completadas | Charlas, capacitaciones y auditorías cerradas |

## Vistas y accesos rápidos

- **Resumen de cumplimiento por fase**: porcentaje de documentos obligatorios firmados
  en la fase actual de la obra.
- **Pendientes**: documentos asignados sin firmar y actividades programadas próximas.
- **Últimos incidentes**: acceso directo al detalle de los eventos más recientes.
- **Selector de obra**: cuando una persona pertenece a varias obras, puede cambiar el
  contexto activo (ver `ObraContext`).

## Contexto de obra

El Dashboard depende de la **obra activa** seleccionada en `ObraContext`. Los KPIs y
listados se filtran por esa obra y por el `tenantId` de la sesión, garantizando el
[aislamiento multi-tenant](/arquitectura/multi-tenant).

## Acceso por rol

El Dashboard es accesible para todos los roles, pero el contenido se adapta:

| Rol | Qué ve |
| --- | --- |
| Admin / Jefe de Obra | Visión completa de la obra y KPIs agregados |
| Prevencionista | Cumplimiento documental, incidentes, actividades |
| Supervisor | Estado de su equipo y firmas pendientes |
| Trabajador | Sus documentos pendientes y actividades asignadas |

Ver detalle de permisos en [Roles de Usuario](/roles/).
