# Rol: Prevencionista

El **prevencionista de riesgos** es el rol técnico responsable de la gestión preventiva.
Es quien opera el día a día del cumplimiento del DS 44 en la obra.

## Responsabilidades

- Elaborar y mantener las matrices de riesgo (MIPER / MIPPER).
- Crear y asignar documentos de seguridad.
- Programar y registrar capacitaciones y charlas.
- Investigar incidentes y accidentes.
- Hacer seguimiento del cumplimiento documental por fase.

## Permisos

| Módulo | Acceso |
| --- | --- |
| Dashboard | ✓ Cumplimiento, incidentes, actividades |
| Obras | 👁 Solo lectura |
| Documentos | ✓ Crear, asignar, gestionar |
| Firmas | ✓ Completo |
| Incidentes | ✓ Crear, investigar, cerrar |
| Actividades | ✓ Programar, registrar |
| Encuestas | ✓ Crear, distribuir, analizar |
| Asistente IA | ✓ Generar matrices de riesgo |
| Personas | 👁 Solo lectura |
| Bandeja de Entrada | ✓ Completo |
| Tenants | ✗ Sin acceso |

## Tareas clave en la plataforma

- **MIPPER asistida por IA**: usa el [Asistente IA](/modulos/asistente-ia) para generar
  matrices por cargo, que revisa y firma.
- **Asignación de documentos diarios**: asigna documentos a personas, generando
  notificaciones automáticas en su bandeja.
- **Destino de alertas de incidentes**: recibe notificación automática cuando se reporta
  un incidente (`incident.created`).

Es el principal receptor de las notificaciones automáticas del sistema. Ver
[Incidentes](/modulos/incidentes) y [Documentos](/modulos/documentos).
