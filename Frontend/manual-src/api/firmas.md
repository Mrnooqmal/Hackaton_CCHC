# API · Firmas

Endpoints de firma digital y sincronización offline. Todas requieren
`Authorization: Bearer <token>`.

::: warning Consulta legal pendiente
La validez del PIN como firma electrónica ante el DS 44 está en evaluación. No usar como
única prueba legal hasta tener respuesta oficial. Ver
[Firmas digitales y DS44](/ds44/firmas-digitales).
:::

## POST /signatures

Registra una firma sobre un documento o actividad.

**Request**

```json
{
  "referenciaId": "d-5678-...",
  "referenciaTipo": "documento",
  "tipoFirma": "trabajador",
  "pin": "1234",
  "metodoValidacion": "PIN"
}
```

**Response `201`**

```json
{
  "success": true,
  "data": {
    "signatureId": "s-9012-...",
    "personaId": "p-001-...",
    "timestamp": "2026-06-23T14:32:00Z",
    "ipAddress": "190.x.x.x",
    "estado": "valida"
  }
}
```

## GET `/signatures/{id}`

Obtiene el registro inmutable de una firma.

## POST /signatures/offline-buffer

Registra una firma capturada **sin conexión** (cola local que luego se sincroniza).

**Request**

```json
{
  "referenciaId": "d-5678-...",
  "tipoFirma": "trabajador",
  "firmaCifrada": "<blob AES base64>",
  "timestampLocal": "2026-06-23T14:30:00Z"
}
```

## GET /signatures/offline-queue

Consulta la cola de firmas pendientes de sincronizar.

## POST /signatures/offline-sync

Sincroniza un lote de firmas offline. Aplica reintentos exponenciales y resolución de
conflictos por timestamp del servidor.

**Request**

```json
{
  "firmas": [
    { "referenciaId": "d-5678-...", "firmaCifrada": "...", "timestampLocal": "..." }
  ]
}
```

**Response `200`**

```json
{
  "success": true,
  "data": { "sincronizadas": 1, "conflictos": 0 }
}
```

## DELETE `/signatures/offline-queue/{id}`

Limpia un elemento ya procesado de la cola local.

Ver el módulo [Firmas Digitales](/modulos/firmas).
