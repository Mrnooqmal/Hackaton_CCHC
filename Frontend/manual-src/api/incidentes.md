# API · Incidentes

Endpoints para reporte y análisis de incidentes. Todas requieren
`Authorization: Bearer <token>`.

## POST /incidents

Crea un incidente. Emite `incident.created` (notifica al prevencionista).

**Request**

```json
{
  "obraId": "o-1234-...",
  "clasificacion": "incidente",
  "tipo": "incidente",
  "gravedad": "leve",
  "etapaConstructiva": "obra_gruesa",
  "centroTrabajo": "Edificio Las Condes 1234",
  "trabajador": {
    "nombre": "Juan Pérez",
    "rut": "12.345.678-9",
    "cargo": "Maestro albañil",
    "genero": "masculino"
  },
  "fecha": "2026-06-23",
  "hora": "10:15",
  "descripcion": "Cuasi-accidente por material mal estibado",
  "diasPerdidos": 0,
  "evidencias": ["foto1.jpg"]
}
```

**Response `201`**

```json
{
  "success": true,
  "data": { "incidentId": "i-3456-...", "estado": "reportado" }
}
```

## GET /incidents

Lista incidentes con filtros.

**Query params**

| Param | Ejemplo | Descripción |
| --- | --- | --- |
| `obraId` | `o-1234-...` | Filtra por obra |
| `tipo` | `accidente` | Filtra por tipo |
| `estado` | `reportado` | Filtra por estado |
| `desde` / `hasta` | `2026-01-01` | Rango de fechas |

## GET `/incidents/{id}`

Detalle completo del incidente, con galería de evidencias.

## PUT `/incidents/{id}`

Actualiza el incidente (por ejemplo, cambiar estado a `en_investigacion` o `cerrado`).

## GET /incidents/stats

KPIs de seguridad.

**Response `200`**

```json
{
  "success": true,
  "data": {
    "diasSinAccidentes": 45,
    "tasaAccidentabilidad": 2.1,
    "diasPerdidos": 12,
    "siniestralidad": 0.8
  }
}
```

## GET /incidents/analytics

Datos para el dashboard analítico (series temporales, distribución por clasificación y
gravedad, heatmap mensual).

## POST /incidents/quick-report

Reporte rápido vía QR (para reportar condiciones inseguras desde terreno).

Ver el módulo [Incidentes](/modulos/incidentes).
