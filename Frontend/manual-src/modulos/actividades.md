# Módulo: Actividades

**Ubicación:** `Frontend/src/pages/Activities.tsx` · `Backend/handlers/activities/`

Registro de actividades preventivas: charlas, capacitaciones, inducciones, análisis de
riesgo (ART) e inspecciones. Cubre la obligación de informar y capacitar del Art. 16 del
DS 44.

## Tipos de actividad

| Tipo | Código | Frecuencia | Descripción |
| --- | --- | --- | --- |
| Charla de 5 minutos | `CHARLA_5MIN` | Diaria | Charla preventiva breve antes de la jornada |
| Inducción | `INDUCCION` | Al ingreso | Inducción de seguridad para nuevos trabajadores |
| Capacitación SST | `CAPACITACION` | 8 horas (Art. 16) | Capacitación formal obligatoria |
| Análisis de Riesgo del Trabajo | `ART` | Por tarea crítica | Identificación de riesgos antes de una actividad |

## Estructura de una actividad

```
activityId    UUID
tenantId      FK
obraId        FK a la obra donde se realiza
tipo          CHARLA_5MIN | ART | CAPACITACION | INDUCCION
titulo / descripcion / fecha
relatorId     personaId del relator
asistentes    [{ personaId, nombre, rut, cargo, firma }]
firmaRelator  Firma del responsable
estado        programada | en_curso | completada | cancelada
```

## Flujo de registro

```
1. Prevencionista programa la actividad (estado: programada)
        ↓
2. Se realiza la actividad (estado: en_curso)
        ↓
3. Cada asistente firma su asistencia (PIN o presencial)
        ↓
4. El relator firma como responsable (firma cruzada)
        ↓
5. La actividad queda completada con registro inmutable
```

## Charlas de seguridad

- Programación de charlas diarias (`CHARLA_5MIN`).
- Registro de asistencia con firma individual.
- Temario tratado.

## Capacitaciones

- Calendario de capacitaciones e inscripción de participantes.
- Capacitación formal de **8 horas** según Art. 16 (`CAPACITACION`).
- Generación de certificados de asistencia a partir del registro firmado.
- Material didáctico y evaluaciones asociadas.

## Inspecciones y auditorías

- Checklist de inspección.
- Registro fotográfico.
- Hallazgos y observaciones.
- Acciones correctivas con seguimiento de cierre.

## Firma cruzada del relator

Las capacitaciones y charlas requieren la **firma del relator** además de la de los
asistentes, certificando que la actividad se impartió. Ver
[Capacitaciones (Art.16)](/ds44/capacitaciones) y [Firmas](/modulos/firmas).

## Endpoints relacionados

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/activities` | Crear actividad |
| `GET` | `/activities` | Listar actividades |
| `POST` | `/activities/{id}/sign` | Firmar (asistente o relator) |
| `POST` | `/activities/{id}/attendance` | Registrar asistencia |

Ver detalle en [API · Actividades](/api/actividades).
