# API · Documentos

Endpoints para gestionar documentos de obra y diarios. Todas requieren
`Authorization: Bearer <token>`.

## POST /documents

Crea un documento. El comportamiento depende de `clasificacion`.

**Request**

```json
{
  "obraId": "o-1234-...",
  "clasificacion": "diario",
  "tipoDS44": "ENTREGA_EPP",
  "titulo": "Acta de entrega de EPP - Juan Pérez",
  "descripcion": "Entrega de casco, guantes y calzado de seguridad"
}
```

**Response `201`**

```json
{
  "success": true,
  "data": { "documentoId": "d-5678-...", "estado": "borrador" }
}
```

## GET /documents

Lista documentos. Acepta filtros por query string.

**Query params**

| Param | Ejemplo | Descripción |
| --- | --- | --- |
| `obraId` | `o-1234-...` | Filtra por obra |
| `clasificacion` | `obra` / `diario` | Filtra por tipo |
| `fase` | `excavacion` | Filtra por fase (solo obra) |
| `estado` | `pendiente` | Filtra por estado |

## GET `/documents/{id}`

Devuelve el detalle del documento, incluyendo `asignaciones` y `firmas`.

## PUT `/documents/{id}`

Actualiza metadatos del documento.

## DELETE `/documents/{id}`

Elimina un documento.

## POST `/documents/{id}/assign`

Asigna un documento diario a una o más personas. Emite `document.assigned` (notificación
en bandeja).

**Request**

```json
{
  "personaIds": ["p-001-...", "p-002-..."],
  "fechaLimite": "2026-07-01"
}
```

**Response `200`**

```json
{
  "success": true,
  "data": { "asignaciones": 2 }
}
```

## GET `/documents/{id}/download`

Devuelve una **URL prefirmada (presigned)** de S3 para descargar el archivo.

**Response `200`**

```json
{
  "success": true,
  "data": { "url": "https://...s3.amazonaws.com/...&X-Amz-Signature=..." }
}
```

Ver el módulo [Documentos](/modulos/documentos).
