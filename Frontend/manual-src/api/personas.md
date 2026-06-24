# API · Personas

Endpoints para gestionar la identidad unificada de personas. Todas requieren
`Authorization: Bearer <token>`.

## POST /personas

Crea una persona (usuario o trabajador).

**Request**

```json
{
  "rut": "12.345.678-9",
  "nombre": "Juan",
  "apellido": "Pérez",
  "email": "juan.perez@constructora.cl",
  "telefono": "+56912345678",
  "rol": "trabajador",
  "cargo": "Maestro albañil",
  "obraIds": ["o-1234-..."],
  "tieneAccesoWeb": false
}
```

**Response `201`**

```json
{
  "success": true,
  "data": { "personaId": "p-001-...", "estado": "pendiente", "habilitado": false }
}
```

## GET /personas

Lista las personas del tenant (Query por `PK = TENANT#{tenantId}`).

**Query params**

| Param | Ejemplo | Descripción |
| --- | --- | --- |
| `rol` | `trabajador` | Filtra por rol |
| `obraId` | `o-1234-...` | Filtra por obra asignada |
| `estado` | `activo` | Filtra por estado |

## GET `/personas/{id}`

Detalle de una persona.

## PUT `/personas/{id}`

Actualiza datos, rol o asignación de obras.

**Request**

```json
{
  "cargo": "Capataz",
  "obraIds": ["o-1234-...", "o-5678-..."]
}
```

## POST `/personas/{id}/change-password`

Cambia la contraseña de una persona con acceso web.

**Request**

```json
{
  "newPassword": "********"
}
```

## Notas

- El `personaId` reemplaza a los antiguos `userId` y `workerId`.
- Una persona sin acceso web (`tieneAccesoWeb: false`) no tiene `passwordHash`, pero
  puede tener `pinHash` para firmar en terreno.
- El `pinHash` se genera una sola vez por persona.

Ver el módulo [Personas](/modulos/personas).
