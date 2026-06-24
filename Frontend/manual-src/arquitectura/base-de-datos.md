# Base de datos (DynamoDB)

El sistema usa **AWS DynamoDB** con 11 tablas, todas en `BillingMode PAY_PER_REQUEST`.
El diseño prioriza el aislamiento por tenant y las consultas por Query (nunca Scan sin
filtro de tenant).

## Jerarquía de entidades

```
Tenant
  ├── Obra
  │     ├── Documentos
  │     ├── Actividades
  │     └── Incidentes
  └── Persona
        ├── Firmas
        └── Asignaciones
```

## Las 11 tablas

### 1. TenantsTable
Registro de empresas clientes del SaaS.

| Elemento | Valor |
| --- | --- |
| PK | `TENANT#{tenantId}` |
| SK | `METADATA#{tenantId}` |
| GSI slug-index | PK: `slug` |
| GSI status-index | PK: `estado` |

### 2. ObrasTable
Obras / proyectos de construcción de un tenant.

| Elemento | Valor |
| --- | --- |
| PK | `TENANT#{tenantId}` |
| SK | `OBRA#{obraId}` |
| GSI obraId-index | PK: `obraId` |

### 3. PersonasTable
Identidad unificada (reemplaza Users y Workers).

| Elemento | Valor |
| --- | --- |
| PK | `TENANT#{tenantId}` |
| SK | `PERSONA#{personaId}` |
| GSI personaId-index | PK: `personaId` |
| GSI email-index | PK: `email` |
| GSI tenantRut-index | PK: `tenantId`, SK: `rut` |

### 4. DocumentosTable
Documentos del sistema, clasificados en obra / diario.

| Elemento | Valor |
| --- | --- |
| PK | `TENANT#{tenantId}` |
| SK | `DOC#{clasificacion}#{documentoId}` |
| GSI documentoId-index | PK: `documentoId` |
| GSI obraClasificacion-index | PK: `obraId`, SK: `clasificacion` |

### 5. ActivitiesTable
Charlas, capacitaciones, inspecciones, ART.

| Elemento | Valor |
| --- | --- |
| PK | `activityId` |
| GSI tenantId-index | PK: `tenantId` |

### 6. IncidentsTable
Reportes de accidentes, incidentes y condiciones subestándar.

| Elemento | Valor |
| --- | --- |
| PK | `incidentId` |
| GSI tenantId-fecha-index | PK: `tenantId`, SK: `fecha` |

### 7. SignaturesTable
Registro inmutable de todas las firmas digitales.

| Elemento | Valor |
| --- | --- |
| PK | `signatureId` |
| GSI requestId-index | PK: `requestId` |
| GSI tenantId-index | PK: `tenantId` |
| GSI personaId-index | PK: `personaId` |

### 8. SignatureRequestsTable
Solicitudes de firma enviadas a personas.

| Elemento | Valor |
| --- | --- |
| PK | `requestId` |
| GSI tenantId-index | PK: `tenantId` |

### 9. SurveysTable
Encuestas de seguridad y salud.

| Elemento | Valor |
| --- | --- |
| PK | `surveyId` |
| GSI tenantId-index | PK: `tenantId` |

### 10. InboxTable
Mensajería interna y notificaciones.

| Elemento | Valor |
| --- | --- |
| PK | `recipientId` (personaId) |
| SK | `messageId` |
| GSI senderId-createdAt-index | PK: `senderId`, SK: `createdAt` |

### 11. SessionsTable
Sesiones de autenticación.

| Elemento | Valor |
| --- | --- |
| PK | `sessionId` |
| TTL | `ttl` (Unix timestamp, expiración automática) |

## Estructura de almacenamiento S3

Un solo bucket compartido con aislamiento por prefijo de tenant:

```
hackaton-documents-{stage}/
  tenants/
    {tenantId}/
      config/
        logo.webp
      obras/
        {obraId}/
          fase-excavacion/
            documento.pdf
          fase-obra-gruesa/
            procedimiento.pdf
      personas/
        {personaId}/
          firma-enrolamiento.png
      evidencias/
        {incidentId}/
          foto1.jpg
```

La descarga de archivos se hace mediante **URLs prefirmadas (presigned)** de S3, con
acceso temporal y seguro.

## Principios de diseño

1. **Aislamiento por tenant**: toda tabla operacional incluye `tenantId`. Nunca se usa
   Scan sin filtro de tenant.
2. **Fuente del tenantId**: se extrae del JWT, jamás del body del request.
3. **Una sola identidad**: `Persona` unifica Users y Workers — un ID, un PIN hash.
4. **Documentos con doble clasificación**: `obra` (obligatorios por fase) y `diario`
   (asignados a personas).

Ver [Multi-tenant](/arquitectura/multi-tenant) para el detalle del aislamiento.
