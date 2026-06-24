# Módulo: Incidentes

**Ubicación:** `Frontend/src/pages/Incidents.tsx` · `Backend/handlers/incidents-module/`

Sistema completo para la gestión de eventos de seguridad laboral: hallazgos, incidentes,
accidentes y condiciones subestándar, con reporte, seguimiento y análisis estadístico.

## Tipos y clasificación

| Clasificación | Tipo | Descripción |
| --- | --- | --- |
| Hallazgo | Acción | Acto subestándar observado (conducta insegura) |
| Hallazgo | Condición | Condición subestándar del entorno |
| Incidente | — | Evento que pudo causar daño (cuasi-accidente) |
| Accidente | — | Evento con lesión o daño efectivo |

**Niveles de gravedad:** `leve`, `grave`, `fatal`.

## Reporte de incidentes

El formulario captura:

- **Clasificación y tipo** (hallazgo/incidente/accidente).
- **Trabajador afectado**: nombre, RUT, cargo, género.
- **Etapa constructiva** en que ocurrió el evento.
- **Fecha, hora y centro de trabajo**.
- **Gravedad** y **días perdidos**.
- **Evidencias fotográficas** (múltiples archivos a S3).
- **Confirmación de veracidad** del reporte.

## Flujo de notificación automática

```
1. Una persona reporta un incidente (POST /incidents)
        ↓
2. Se guarda en IncidentsTable con autoría y timestamp
        ↓
3. EventBus emite "incident.created"
        ↓
4. Notificación automática al prevencionista vía InboxTable
        ↓
5. (Opcional) Publicación en tópico SNS para integraciones externas
```

## Visualización y análisis

### Vista listado
Tabla con filtros avanzados por tipo, estado y rango de fechas.

### Vista estadísticas (dashboard analítico)

| KPI | Qué mide |
| --- | --- |
| Tasa de accidentabilidad | Accidentes por cada 100 trabajadores |
| Días perdidos | Total de días de ausencia por accidentes |
| Siniestralidad | Severidad acumulada en el período |

Incluye además:

- Gráfico de **evolución temporal** (líneas).
- Distribución por **clasificación** (barras horizontales).
- Distribución por **gravedad** (barras horizontales).
- **Calendario heatmap** mensual con severidad por día.
- Exportación de reportes en **CSV y PDF**.

## Detalle de un incidente

Modal con información completa: galería de evidencias con lightbox, datos del trabajador
y del reportante, estado y seguimiento del evento.

## Estados

```
reportado → en_investigacion → cerrado
```

El ciclo de investigación se alinea con la exigencia del DS 44 de **investigar
incidentes con análisis de causa raíz**.

## Endpoints relacionados

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/incidents` | Crear incidente |
| `GET` | `/incidents` | Listar con filtros |
| `GET` | `/incidents/{id}` | Detalle |
| `PUT` | `/incidents/{id}` | Actualizar |
| `GET` | `/incidents/stats` | Estadísticas |
| `GET` | `/incidents/analytics` | Datos del dashboard |
| `POST` | `/incidents/quick-report` | Reporte rápido vía QR |

Ver detalle en [API · Incidentes](/api/incidentes).
