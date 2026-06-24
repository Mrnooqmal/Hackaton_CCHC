# Módulo: Documentos

**Ubicación:** `Frontend/src/pages/Documents.tsx` · `Backend/handlers/documents/`

Gestión centralizada de todos los documentos del sistema. Cada documento se clasifica
en uno de dos tipos según su comportamiento: **de obra** o **diario**.

## Clasificación

### Documentos de obra (`clasificacion: "obra"`)

- Obligatorios por fase según el DS 44.
- Se precrean al crear la obra (según `fasesConfig`).
- Accesibles desde la zona central de documentos de la obra.
- Cumplimiento agregado por fase (% completado).
- No se asignan individualmente; son documentos de referencia que deben existir y estar
  firmados para cumplir normativa.

### Documentos de uso diario (`clasificacion: "diario"`)

- Se crean y asignan a personas específicas.
- Al asignarse, el `EventBus` emite `document.assigned`, que genera una notificación en
  la bandeja de entrada de cada persona asignada.
- Aparecen como pendientes en el dashboard del trabajador.
- Requieren firma individual (PIN o presencial).
- Tienen fecha límite opcional; si vencen, el estado pasa a `vencido`.

## Flujo de documento de obra

```
1. Al crear la obra, se precrean los documentos obligatorios por fase
        ↓
2. El prevencionista sube el archivo (PDF) a cada documento
        ↓
3. Desde la zona central se ve el % de cumplimiento por fase
        ↓
4. Al avanzar de fase, se verifica que los obligatorios estén firmados
```

## Flujo de documento diario

```
1. Prevencionista crea un documento con clasificacion "diario"
        ↓
2. Lo asigna a una o más personas (POST /documents/{id}/assign)
        ↓
3. EventBus emite "document.assigned" → mensaje en InboxTable por persona
        ↓
4. El trabajador ve la notificación en su bandeja de entrada
        ↓
5. El trabajador firma el documento (PIN o presencial)
        ↓
6. El estado de la asignación cambia a "firmado"
```

## Estructura de un documento

```
documentoId    UUID
tenantId       FK
obraId         FK a la obra
clasificacion  obra | diario
fase           Solo si clasificacion=obra
tipoDS44       IRL | POLITICA_SSO | ENTREGA_EPP | MIPPER | ...
obligatorio    BOOL
titulo / descripcion / contenido
s3Key          tenants/{tenantId}/obras/{obraId}/docs/{key}
asignaciones   Lista de personas con estado de firma
firmas         Firmas recolectadas
estado         borrador | activo | completado | vencido
```

## Almacenamiento

Los archivos se guardan en S3 con aislamiento por prefijo de tenant:

```
hackaton-documents-{stage}/tenants/{tenantId}/obras/{obraId}/fase-{fase}/archivo.pdf
```

La descarga se realiza mediante **URLs prefirmadas (presigned)** de S3, garantizando
acceso seguro y temporal. Ver [Arquitectura · Base de datos](/arquitectura/base-de-datos).

## Endpoints relacionados

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/documents` | Crear / subir documento |
| `GET` | `/documents` | Listar documentos |
| `GET` | `/documents/{id}` | Obtener documento |
| `PUT` | `/documents/{id}` | Actualizar metadatos |
| `DELETE` | `/documents/{id}` | Eliminar documento |
| `POST` | `/documents/{id}/assign` | Asignar a personas |
| `GET` | `/documents/{id}/download` | URL de descarga prefirmada |

Ver detalle en [API · Documentos](/api/documentos).
