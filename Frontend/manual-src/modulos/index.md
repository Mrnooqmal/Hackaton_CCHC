# Resumen de módulos

Build & Serve se organiza en **11 módulos** que cubren el ciclo completo de gestión de
SST en una obra. Cada módulo es accesible según el [rol](/roles/) de la persona y los
módulos activos del [tenant](/modulos/tenants).

| Módulo | Para qué sirve | Documentación |
| --- | --- | --- |
| 📊 Dashboard | KPIs y métricas de seguridad de la obra | [Ver](/modulos/dashboard) |
| 🏗️ Obras | Gestión de proyectos y ciclo de fases | [Ver](/modulos/obras) |
| 📄 Documentos | Documentos DS 44 (obra y diarios) | [Ver](/modulos/documentos) |
| ✍️ Firmas Digitales | Firma PIN, offline y presencial | [Ver](/modulos/firmas) |
| ⚠️ Incidentes | Reporte y análisis de incidentes y accidentes | [Ver](/modulos/incidentes) |
| 🎓 Actividades | Charlas, capacitaciones, auditorías | [Ver](/modulos/actividades) |
| 📋 Encuestas | Formularios y evaluaciones | [Ver](/modulos/encuestas) |
| 🤖 Asistente IA | Matrices de riesgo y consultas normativas | [Ver](/modulos/asistente-ia) |
| 👤 Personas | Identidad unificada de usuarios y trabajadores | [Ver](/modulos/personas) |
| 📨 Bandeja de Entrada | Mensajería y notificaciones internas | [Ver](/modulos/bandeja-entrada) |
| 🏢 Tenants | Configuración multi-tenant y planes | [Ver](/modulos/tenants) |

## Cómo se relacionan

```
Tenant (empresa cliente)
  └── Obra
        ├── Documentos  ── firmados con ──▶ Firmas
        ├── Actividades ── firmadas con ──▶ Firmas
        ├── Incidentes  ── notifican vía ─▶ Bandeja de Entrada
        └── Encuestas
  └── Personas (admin, prevencionista, supervisor, jefe de obra, trabajador)
        └── Asignaciones y firmas
```

## Venta por módulos

El campo `settings.modulosActivos` del tenant controla qué módulos están disponibles,
permitiendo comercializar la plataforma por paquetes. Un tenant del plan *starter*
puede no tener habilitado el Asistente IA, por ejemplo. Ver [Tenants](/modulos/tenants).
