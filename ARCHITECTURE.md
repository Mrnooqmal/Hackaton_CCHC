# Arquitectura de Datos — SaaS Multi-Tenant SST

Documento de referencia para la infraestructura DynamoDB del sistema de
Seguridad y Salud en el Trabajo (SST) bajo modelo SaaS multi-tenant.

Todas las tablas usan BillingMode PAY_PER_REQUEST.

---

## Principios de diseno

1. Aislamiento por tenant: toda tabla operacional incluye `tenantId` como
   atributo o como parte del Partition Key.  Nunca se usa Scan sin filtro
   de tenant.
2. Fuente del tenantId: se extrae del JWT (Cognito custom attribute), jamas
   del body del request.  Esto previene data leakage entre clientes.
3. Una sola identidad: la entidad Persona unifica lo que antes eran dos
   tablas separadas (Users y Workers).  Un solo ID, un solo PIN hash,
   sin sincronizacion manual.
4. Documentos con doble clasificacion:

   - "obra": obligatorios por fase segun DS 44, accesibles desde zona central.
   - "diario": asignados a personas, con notificacion y firma pendiente.
5. Jerarquia de entidades: Tenant > Obra > (Documentos, Actividades,
   Incidentes).  Tenant > Persona > (Firmas, Asignaciones).

---

## Tabla 1: TenantsTable

Proposito: registro de empresas clientes del SaaS.

### Keys e indices

| Elemento         | Valor                   | Tipo |
| ---------------- | ----------------------- | ---- |
| PK (Partition)   | `TENANT#{tenantId}`   | S    |
| SK (Sort)        | `METADATA#{tenantId}` | S    |
| GSI slug-index   | PK:`slug`             | S    |
| GSI status-index | PK:`estado`           | S    |

### Campos

```
tenantId            S   UUID v4
slug                S   URL-friendly, unico global
nombre              S   Razon social
rutEmpresa          S   RUT de la empresa
email               S   Email de contacto
telefono            S   Telefono corporativo
plan                S   starter | professional | enterprise
tamano              S   micro | pequena | mediana | grande
cantidadTrabajadores N  Determina tamano y comportamiento del backend
estado              S   setup | activo | suspendido
adminPersonaId      S   ID de la persona administradora

settings            M   Configuracion tecnica
  maxWorkers          N
  dataRetentionDays   N
  twoFactorEnabled    BOOL
  modulosActivos      L   [documentos, actividades, encuestas, incidentes, ia]

reglas              M   Reglas de negocio SST
  fasesObligatorias   L   Fases del DS 44 que aplican
  limiteObras         N
  requiereFirmaPin    BOOL

preferencias        M   Personalizacion UI
  timezone            S   America/Santiago
  idioma              S   es
  formatoFecha        S   DD/MM/YYYY
  colorPrimario       S   Hex
  colorSecundario     S   Hex
  logoUrl             S   Ruta en S3

createdAt           S   ISO 8601
updatedAt           S   ISO 8601
```

### Logica

- Al hacer setup, `tamano` se calcula segun `cantidadTrabajadores`.
- El campo `settings.modulosActivos` controla que modulos estan disponibles
  para el tenant (permite venta por modulos).
- `reglas.fasesObligatorias` define que fases de obra aplican para ese
  tenant; al crear una obra se preconfiguran los documentos obligatorios
  de esas fases.
- `slug` se usa en URLs y como identificador legible.  GSI `slug-index`
  garantiza unicidad.
- tenant-0 es reservado para superadmin con acceso cross-tenant.

---

## Tabla 2: ObrasTable

Proposito: obras/proyectos de construccion gestionados por un tenant.

### Keys e indices

| Elemento         | Valor                 | Tipo |
| ---------------- | --------------------- | ---- |
| PK (Partition)   | `TENANT#{tenantId}` | S    |
| SK (Sort)        | `OBRA#{obraId}`     | S    |
| GSI obraId-index | PK:`obraId`         | S    |

### Campos

```
obraId              S   UUID
tenantId            S   FK
nombre              S   Nombre de la obra
codigo              S   Codigo interno opcional
direccion           S   Direccion fisica
comuna              S   Comuna
region              S   Region
etapaActual         S   excavacion | obra_gruesa | terminaciones | entrega
mandante            S   Empresa mandante
estado              S   activa | pausada | finalizada

fasesConfig         M   Mapa de fases con documentos obligatorios
  excavacion          L   [IRL, POLITICA_SSO, ...]
  obra_gruesa         L   [PROCEDIMIENTO_TRABAJO, ENTREGA_EPP, ...]
  terminaciones       L   [...]
  entrega             L   [...]

createdAt           S
updatedAt           S
```

### Logica

- PK = TENANT#{tenantId} permite listar todas las obras de un tenant con
  Query (sin Scan).
- `fasesConfig` se prellena al crear la obra, basandose en
  `tenant.reglas.fasesObligatorias`.
- Al cambiar `etapaActual`, el sistema puede verificar automaticamente
  si todos los documentos obligatorios de la fase anterior estan firmados.
- Un tenant puede tener multiples obras activas simultaneamente.

---

## Tabla 3: PersonasTable

Proposito: identidad unificada.  Reemplaza las tablas Users y Workers.
Toda persona del sistema (admin, prevencionista, trabajador) es un unico
registro.

### Keys e indices

| Elemento            | Valor                        | Tipo |
| ------------------- | ---------------------------- | ---- |
| PK (Partition)      | `TENANT#{tenantId}`        | S    |
| SK (Sort)           | `PERSONA#{personaId}`      | S    |
| GSI personaId-index | PK:`personaId`             | S    |
| GSI email-index     | PK:`email`                 | S    |
| GSI tenantRut-index | PK:`tenantId`, SK: `rut` | S, S |

### Campos

```
personaId           S   UUID (reemplaza userId y workerId)
tenantId            S   FK al tenant
rut                 S   RUT chileno formateado
nombre              S
apellido            S
email               S   Opcional para trabajadores sin acceso web
telefono            S

rol                 S   admin | prevencionista | supervisor | trabajador
permisos            L   Derivados del rol
cargo               S   Cargo laboral
obraIds             L   Obras asignadas

tieneAccesoWeb      BOOL  Si puede hacer login en la plataforma
passwordHash        S     Solo si tieneAccesoWeb = true
pinHash             S     Hash del PIN para firma digital
pinCreatedAt        S     Timestamp
habilitado          BOOL  true cuando completo enrolamiento
firmaEnrolamiento   M     Datos de la firma de enrolamiento

estado              S   pendiente | activo | inactivo

preferencias        M
  tema                S   dark | light
  notificaciones      BOOL
  idioma              S

createdAt           S
updatedAt           S
ultimoAcceso        S
```

### Logica

- PK = TENANT#{tenantId} aisla personas por tenant.
- `personaId-index` permite lookup directo sin conocer el tenant (para
  verificacion de firmas, login por token, etc).
- `email-index` es cross-tenant (para login); el Lambda verifica que el
  tenantId del JWT coincida.
- `tenantRut-index` permite buscar por RUT dentro de un tenant.
- `pinHash` se hashea con `personaId` (una sola vez, no dos como antes).
- Si `tieneAccesoWeb` es false, la persona no tiene passwordHash pero si
  puede tener pinHash para firma digital en terreno.
- `obraIds` es una lista porque un trabajador puede estar asignado a
  multiples obras.
- Los roles definen permisos:
  - admin: gestion completa del tenant
  - prevencionista: crear actividades, asignar documentos, ver reportes
  - supervisor: firmar como relator, ver trabajadores de su obra
  - trabajador: ver documentos asignados, firmar, registrar asistencia

---

## Tabla 4: DocumentosTable

Proposito: todos los documentos del sistema, clasificados en dos tipos.

### Keys e indices

| Elemento                    | Valor                                 | Tipo |
| --------------------------- | ------------------------------------- | ---- |
| PK (Partition)              | `TENANT#{tenantId}`                 | S    |
| SK (Sort)                   | `DOC#{clasificacion}#{documentoId}` | S    |
| GSI documentoId-index       | PK:`documentoId`                    | S    |
| GSI obraClasificacion-index | PK:`obraId`, SK: `clasificacion`  | S, S |

### Campos

```
documentoId         S   UUID
tenantId            S   FK
obraId              S   FK a la obra

clasificacion       S   obra | diario
fase                S   Solo si clasificacion=obra (excavacion, obra_gruesa, etc)
tipoDS44            S   IRL | POLITICA_SSO | REGLAMENTO_INTERNO | PROCEDIMIENTO_TRABAJO |
                        ENTREGA_EPP | ENCUESTA_SALUD | CAPACITACION | MAPA_RIESGOS | etc
obligatorio         BOOL  Si lo exige el DS 44 para esa fase

titulo              S
descripcion         S
contenido           S   Texto, HTML, o referencia

s3Key               S   tenants/{tenantId}/obras/{obraId}/docs/{key}
archivoNombre       S   Nombre original del archivo

asignaciones        L   Lista de asignaciones a personas
  personaId           S
  nombre              S   Denormalizado para performance
  estado              S   pendiente | firmado | rechazado
  fechaAsignacion     S
  fechaLimite         S
  fechaFirma          S

firmas              L   Firmas recolectadas
  token               S
  personaId           S
  nombre              S
  rut                 S
  tipoFirma           S   trabajador | relator | supervisor
  fecha               S
  horario             S
  timestamp           S
  ipAddress           S

estado              S   borrador | activo | completado | vencido
createdBy           S   personaId del creador
createdAt           S
updatedAt           S
```

### Logica de clasificacion

Documentos de obra (clasificacion = "obra"):

- Son los obligatorios por cada fase del DS 44.
- Se precrean al crear una obra, basandose en fasesConfig.
- Accesibles desde una seccion central de documentos de la obra.
- Su estado de cumplimiento se agrega por fase (% completado).
- No se asignan individualmente; son documentos de referencia que
  deben existir y estar firmados para cumplir normativa.

Documentos de uso diario (clasificacion = "diario"):

- Se crean y asignan a personas especificas.
- Al asignar, el EventBus emite "document.assigned" que genera una
  notificacion en el inbox de cada persona asignada.
- Aparecen como pendientes en el dashboard del trabajador.
- Requieren firma individual (PIN o presencial).
- Tienen fecha limite opcional; si vencen, estado pasa a "vencido".

### Queries tipicas

- Documentos de obra por fase: Query PK=TENANT#{tid}, SK begins_with DOC#obra
  + FilterExpression fase = X
- Documentos diarios pendientes de una persona: Scan con filter
  contains(asignaciones, personaId) AND estado=pendiente
  (alternativa: tabla de asignaciones separada con GSI por personaId)
- Todos los documentos de una obra: GSI obraClasificacion-index, PK=obraId

---

## Tabla 5: ActivitiesTable

Proposito: charlas, capacitaciones, inspecciones, ART.

### Keys e indices

| Elemento           | Valor           | Tipo |
| ------------------ | --------------- | ---- |
| PK (Partition)     | `activityId`  | S    |
| GSI tenantId-index | PK:`tenantId` | S    |

### Campos 

```
+ tenantId           S   FK (antes empresaId)
+ obraId             S   FK a la obra donde se realiza
  activityId         S   UUID
  tipo               S   CHARLA_5MIN | ART | CAPACITACION | INDUCCION | etc
  titulo             S
  descripcion        S
  fecha              S
  relatorId          S   personaId del relator (antes podria ser workerId o userId)
  asistentes         L   [{ personaId, nombre, rut, cargo, firma }]
  firmaRelator       M
  estado             S   programada | en_curso | completada | cancelada
  createdAt          S
  updatedAt          S
```

---

## Tabla 6: IncidentsTable

Proposito: reportes de accidentes, incidentes y condiciones subestandar.

### Keys e indices 

| Elemento                 | Valor                          | Tipo |
| ------------------------ | ------------------------------ | ---- |
| PK (Partition)           | `incidentId`                 | S    |
| GSI tenantId-fecha-index | PK:`tenantId`, SK: `fecha` | S, S |

### Campos (cambios)

```
- empresaId  -->  tenantId
+ obraId             S   FK
  trabajador.id      ahora es personaId (antes podria no tener ID)
  reportadoPor       ahora es personaId
```

---

## Tabla 7: SignaturesTable

Proposito: registro inmutable de todas las firmas digitales del sistema.

### Keys e indices

| Elemento            | Valor            | Tipo |
| ------------------- | ---------------- | ---- |
| PK (Partition)      | `signatureId`  | S    |
| GSI requestId-index | PK:`requestId` | S    |
| GSI tenantId-index  | PK:`tenantId`  | S    |
| GSI personaId-index | PK:`personaId` | S    |

### Campos (cambios)

```
- workerId   -->  personaId
- userId     -->  (eliminado, redundante)
+ tenantId           S
  signatureId        S
  token              S
  personaId          S
  workerRut          S   (renombrar a personaRut)
  workerNombre       S   (renombrar a personaNombre)
  tipoFirma          S
  referenciaId       S
  referenciaTipo     S
  fecha / horario / timestamp   S
  ipAddress          S
  metodoValidacion   S
  estado             S   valida | disputada | anulada
  createdAt          S
```

---

## Tabla 8: SignatureRequestsTable

Proposito: solicitudes de firma enviadas a personas.

### Keys e indices

| Elemento           | Valor           | Tipo |
| ------------------ | --------------- | ---- |
| PK (Partition)     | `requestId`   | S    |
| GSI tenantId-index | PK:`tenantId` | S    |

### Campos (cambios)

```
+ tenantId           S
+ obraId             S
- solicitanteId (workerId/userId) --> solicitanteId (personaId)
  trabajadores[].workerId --> trabajadores[].personaId
```

---

## Tabla 9: SurveysTable

Proposito: encuestas de seguridad y salud.

### Keys e indices

| Elemento           | Valor           | Tipo |
| ------------------ | --------------- | ---- |
| PK (Partition)     | `surveyId`    | S    |
| GSI tenantId-index | PK:`tenantId` | S    |

### Campos (cambios)

```
+ tenantId           S
+ obraId             S
  asignaciones[].workerId --> asignaciones[].personaId
```

---

## Tabla 10: InboxTable

Proposito: mensajeria interna y notificaciones.

### Keys e indices (sin cambios en keys)

| Elemento                     | Valor                              | Tipo |
| ---------------------------- | ---------------------------------- | ---- |
| PK (Partition)               | `recipientId` (personaId)        | S    |
| SK (Sort)                    | `messageId`                      | S    |
| GSI senderId-createdAt-index | PK:`senderId`, SK: `createdAt` | S, S |

### Campos (cambios)

```
+ tenantId           S
  recipientId        ahora es personaId
  senderId           ahora es personaId
```

---

## Tabla 11: SessionsTable

Proposito: sesiones de autenticacion.

### Keys e indices

| Elemento       | Valor         | Tipo |
| -------------- | ------------- | ---- |
| PK (Partition) | `sessionId` | S    |

### Campos (cambios)

```
+ tenantId           S
- userId     -->  personaId
+ ttl               N   Unix timestamp para TTL automatico de DynamoDB
```

---

## Estructura S3

Un solo bucket compartido con aislamiento por prefijo:

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

---

## Flujo de onboarding de un tenant

1. POST /tenants/setup recibe: nombre, rutEmpresa, cantidadTrabajadores,
   email del admin, nombre del admin.
2. Se crea el registro en TenantsTable con estado "setup".
3. Se calcula tamano segun cantidadTrabajadores.
4. Se crea la Persona admin en PersonasTable con rol "admin",
   tieneAccesoWeb=true, password temporal.
5. Se actualiza tenantId.adminPersonaId.
6. Se cambia estado del tenant a "activo".
7. Se notifica al admin con credenciales (email o respuesta directa).

---

## Flujo de documentos de obra

1. Admin/prevencionista crea una obra (POST /obras).
2. El sistema precrea documentos de tipo "obra" para cada fase segun
   fasesConfig del tenant.
3. El prevencionista sube los archivos (PDF) a cada documento.
4. Desde la zona central de documentos se ve el estado de cumplimiento
   por fase (cuantos documentos de esa fase estan completos).
5. Al avanzar de fase, el sistema verifica si la fase anterior tiene
   todos sus documentos obligatorios firmados.

## Flujo de documentos de uso diario

1. Prevencionista crea un documento con clasificacion "diario".
2. Asigna el documento a una o mas personas (POST /documents/{id}/assign).
3. El EventBus emite "document.assigned" y se crea un mensaje en InboxTable
   para cada persona asignada.
4. El trabajador ve la notificacion en su bandeja de entrada.
5. El trabajador firma el documento (PIN o presencial).
6. El estado de la asignacion cambia a "firmado".
