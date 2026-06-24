# API · Actividades

Endpoints para charlas, capacitaciones e inspecciones. Todas requieren
`Authorization: Bearer <token>`.

## POST /activities

Crea una actividad.

**Request**

```json
{
  "obraId": "o-1234-...",
  "tipo": "CAPACITACION",
  "titulo": "Capacitación trabajo en altura",
  "descripcion": "Capacitación Art. 16 - 8 horas",
  "fecha": "2026-06-25",
  "relatorId": "p-007-..."
}
```

**Response `201`**

```json
{
  "success": true,
  "data": { "activityId": "act-7890-...", "estado": "programada" }
}
```

## GET /activities

Lista actividades del tenant (GSI por `tenantId`). Acepta filtros por `obraId`, `tipo`
y `estado`.

## POST /activities/{id}/attendance

Registra la asistencia de trabajadores a la actividad.

**Request**

```json
{
  "asistentes": [
    { "personaId": "p-001-...", "nombre": "Juan Pérez", "rut": "12.345.678-9", "cargo": "Maestro albañil" }
  ]
}
```

## POST /activities/{id}/sign

Firma de la actividad. Sirve tanto para la firma de un **asistente** como para la **firma
cruzada del relator**.

**Request (asistente)**

```json
{
  "personaId": "p-001-...",
  "tipoFirma": "trabajador",
  "pin": "1234"
}
```

**Request (relator)**

```json
{
  "personaId": "p-007-...",
  "tipoFirma": "relator",
  "pin": "5678"
}
```

**Response `200`**

```json
{
  "success": true,
  "data": { "estado": "completada" }
}
```

Ver el módulo [Actividades](/modulos/actividades) y
[Capacitaciones (Art.16)](/ds44/capacitaciones).
