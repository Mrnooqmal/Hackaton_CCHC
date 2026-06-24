# API · Obras

Endpoints para gestionar obras de construcción. Todas requieren
`Authorization: Bearer <token>`.

## POST /obras

Crea una obra. Precrea automáticamente los documentos obligatorios según
`tenant.reglas.fasesObligatorias`.

**Request**

```json
{
  "nombre": "Edificio Las Condes 1234",
  "codigo": "EC-2026-01",
  "direccion": "Av. Apoquindo 1234",
  "comuna": "Las Condes",
  "region": "Metropolitana",
  "mandante": "Inmobiliaria XYZ",
  "etapaActual": "excavacion"
}
```

**Response `201`**

```json
{
  "success": true,
  "data": {
    "obraId": "o-1234-...",
    "tenantId": "t-9876-...",
    "estado": "activa",
    "fasesConfig": {
      "excavacion": ["IRL", "POLITICA_SSO", "REGLAMENTO_INTERNO"],
      "obra_gruesa": ["PROCEDIMIENTO_TRABAJO", "ENTREGA_EPP"]
    }
  }
}
```

## GET /obras

Lista las obras del tenant (Query por `PK = TENANT#{tenantId}`).

**Response `200`**

```json
{
  "success": true,
  "data": [
    { "obraId": "o-1234-...", "nombre": "Edificio Las Condes 1234", "etapaActual": "excavacion", "estado": "activa" }
  ]
}
```

## GET `/obras/{id}`

Devuelve el detalle de una obra, incluyendo `fasesConfig` y el cumplimiento por fase.

## PUT `/obras/{id}`

Actualiza los datos de una obra.

**Request**

```json
{ "estado": "pausada" }
```

## POST `/obras/{id}/phase-advance`

Avanza la `etapaActual` de la obra. Verifica que los documentos obligatorios de la fase
anterior estén completos.

**Request**

```json
{ "nuevaEtapa": "obra_gruesa" }
```

**Response `200`**

```json
{
  "success": true,
  "data": { "etapaActual": "obra_gruesa" }
}
```

**Response `400`** (si la fase anterior no está completa)

```json
{
  "success": false,
  "error": "Documentos obligatorios pendientes en la fase 'excavacion'",
  "code": "PHASE_INCOMPLETE"
}
```

Ver el módulo [Obras](/modulos/obras).
