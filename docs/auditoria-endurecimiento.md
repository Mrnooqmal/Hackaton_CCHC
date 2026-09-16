# Auditoría previa al endurecimiento — Build & Serve

**Alcance:** sección 10 del checklist de endurecimiento, los diez inventarios.
**Fecha:** 2026-09-12
**Rama auditada:** `pruebas`, commit `3c94779` (posterior al cambio de servicio a `BuildAndServe`)
**Método:** lectura del repositorio. Lo que no pude verificar en el código se declara como tal, no se supone.

---

## 0. Hallazgo que condiciona todo el resto

Antes de los inventarios hay que decir esto, porque cambia la severidad de los otros nueve.

**La API no tiene autenticación.** No hay autorizador declarado en `Backend/serverless.yml` — ni JWT, ni Lambda authorizer, ni API key — y ningún handler valida el token, salvo los del propio módulo de autenticación.

Verificado por tres vías independientes:

| Comprobación | Resultado |
|---|---|
| `grep -n "authorizer\|jwtConfiguration" Backend/serverless.yml` | Sin resultados |
| Handlers que leen el header `Authorization` | Solo `Backend/handlers/auth/handler.js` |
| El frontend sí envía el token | `Frontend/src/api/client.ts:45-46` añade `Authorization: Bearer` en cada request |

El frontend se comporta como si hubiera sesión; el backend nunca la comprueba. Cualquiera con la URL del API —que es pública y está en el `.env` del frontend compilado— puede listar, crear, modificar y borrar datos de cualquier empresa sin credencial alguna.

Esto no es un punto del checklist: **el checklist lo da por hecho**. A-2 habla de "contrastar el identificador de empresa con la sesión", pero no hay sesión que contrastar. Mientras esto siga así, el cifrado de campo (C-2), la separación de roles KMS (C-3) y la bitácora de acceso (A-3) protegen contra el operador de infraestructura, no contra internet.

---

## Inventario 1 — El RUT como llave, ruta, parámetro o nombre de archivo

### Es llave

| Ubicación | Uso | Observación |
|---|---|---|
| `Backend/serverless.yml:883-890` | GSI `tenantRut-index` en `PersonasTable`, con `rut` como clave de ordenamiento | Es el índice de unicidad y búsqueda. `ProjectionType: ALL` |
| `Frontend/src/services/offlineStore.ts:92` | `keyPath: 'rut'` del almacén IndexedDB de trabajadores en caché | El RUT es la llave primaria local |
| `Frontend/src/App.tsx:139` | Ruta `/personas/:rut` | El RUT viaja en la barra de direcciones |
| `Frontend/src/App.tsx:144` | Ruta `/workers/:rut` (alias heredado) | Igual |

### Es atributo (correcto)

- `Backend/lib/models/Persona.js:211-216` — las claves reales son `PK: TENANT#{tenantId}` / `SK: PERSONA#{personaId}`. **El identificador primario de la persona ya es un UUID, no el RUT.** D-2 está parcialmente resuelto en el modelo, aunque no con UUID v7.

### Búsqueda por RUT

`Backend/lib/services/PersonaService.js:145-155` (`getByRutGlobal`) y `:163-172` (`getAllByRutGlobal`) hacen **`Scan` de tabla completa, sin filtro de empresa**, comparando `rut` en claro. Es el camino del login multiempresa: cruza tenants por diseño.

**Consecuencia para D-4:** el índice ciego con HMAC es implementable, pero hay que resolver antes que el login necesita buscar por RUT *a través de todas las empresas*. Un HMAC con clave de servidor sirve igual para eso (la comparación es por igualdad), pero el `Scan` hay que reemplazarlo por una consulta al índice, no solo cambiar lo que se guarda.

**El checklist asume que el RUT es clave de partición. No lo es.** El trabajo de D-2/D-3 en Personas es menor de lo previsto; el de D-4 es el que queda entero.

---

## Inventario 2 — `Scan` y consultas que no parten por la partición de empresa

39 usos de `ScanCommand` fuera de `node_modules`. Los que están en caminos de usuario final:

| Archivo:línea | Contexto | Filtra por empresa |
|---|---|---|
| `Backend/lib/services/PersonaService.js:148` | `getByRutGlobal` — login | **No, es global** |
| `Backend/lib/services/PersonaService.js:166` | `getAllByRutGlobal` — login multiempresa | **No, es global** |
| `Backend/handlers/auth/handler.js:328` | Login | Por verificar en detalle |
| `Backend/handlers/auth/handler.js:511`, `:569` | Sesión y validación de token | Sobre `SessionsTable` |
| `Backend/handlers/signatures/handler.js:431` | Listado de firmas | Por verificar |
| `Backend/handlers/signature-requests/handler.js:329` | Listado de solicitudes | Por verificar |
| `Backend/handlers/incidents-module/incidents.repository.js:290`, `:597`, `:759` | Incidentes | Por verificar |
| `Backend/handlers/documents/handler.js` | Importa `ScanCommand` (línea 2) | Uso por rastrear |
| `Backend/lib/services/TenantService.js:213`, `:243` | Listado de empresas | Global por definición |
| `Backend/lib/services/EppService.js:204` | EPP | Por verificar |

Fuera de camino caliente (cron y scripts, aceptable pero cuentan para el inventario):

- `Backend/handlers/scheduler/handler.js:62`
- `Backend/handlers/scheduler/revision-documental.js:95` — `Scan` de `DOCUMENTS_TABLE` completa
- `Backend/handlers/scheduler/estructura-alertas.js:107` — `Scan` de la tabla de estructura completa
- `Backend/lib/services/RegistroService.js:138`, `:158`, `:185`
- `Backend/scripts/*` — migraciones y copia de tablas

**Aislamiento por empresa:** `Backend/handlers/documents/handler.js:170` toma `tenantId` del cuerpo o del query string del cliente. No hay contraste con sesión en ese handler (búsqueda de `session` sin resultados). Dado el hallazgo 0, el `tenantId` es simplemente un parámetro que el llamante elige.

---

## Inventario 3 — Campos sensibles por tabla y estado de cifrado

**Estado de cifrado: ninguno.** No hay `SSESpecification` en ninguna de las 15 tablas declaradas ni cifrado a nivel de campo en el código. Todo se guarda en claro.

### `PersonasTable` — la tabla con más dato sensible

| Campo | Línea en `Backend/lib/models/Persona.js` | Naturaleza |
|---|---|---|
| `rut` | 55 | Identificatorio |
| `fechaNacimiento` | 56 | Personal |
| `email` | 57 | Contacto |
| `telefono` | 58 | Contacto |
| `contactoEmergencia` | 92 | Personal de tercero |
| `vigilanciaSalud` | 116-122 | **Salud**: protocolos, fecha del último examen, aptitud laboral, restricciones |
| `restriccionLaboral` | 125 | **Salud**: restricción o traslado por enfermedad profesional |
| `passwordHash` | 100 | Credencial |
| `pinHash` | 101 | Credencial |

**Hallazgo grave en la serialización:** `toSafeFormat()` (`Persona.js:277-317`) excluye correctamente los hashes, pero **incluye `vigilanciaSalud` y `restriccionLaboral`** (líneas 308-309). Todo endpoint que devuelve una persona devuelve su información de salud.

Esto contradice lo que documentamos en `docs/gobernanza-y-seguridad-de-datos.md`: el resguardo que construimos en `Backend/lib/documentos-salud.js` protege los **documentos** de salud del repositorio, no los **campos** de salud de la ficha. Son dos superficies distintas y solo una está cubierta.

### Otras tablas

No las recorrí campo por campo. `IncidentsTable`, `SurveysTable` (encuestas de salud) y `EppTable` requieren el mismo ejercicio antes de definir qué se cifra en C-2. **Lo declaro como pendiente en vez de suponerlo.**

---

## Inventario 4 — Esquema real de claves de S3

**Un solo esquema, en `Backend/handlers/uploads/handler.js:67-74`:**

```
tenants/{tenantId}/{categoria}/{timestamp}-{uuid8}-{nombreOriginalSaneado}
```

Con `prefix = 'general'` cuando no viene `tenantId` (línea 71).

| Punto | Estado |
|---|---|
| Jerárquico por empresa | Sí |
| Sin datos personales | **No.** El nombre original del archivo forma parte de la clave (línea 70: solo reemplaza caracteres no alfanuméricos por `_`) |
| Identificador opaco | Parcial: hay UUID de 8 caracteres, pero convive con el nombre original |
| Separación por obra / dominio / entidad | No existe |
| Versión en la clave | No existe |

Un archivo llamado `examen_ocupacional_Juan_Perez_12345678-9.pdf` queda con el nombre y el RUT en la clave de S3, visible en los registros de acceso, en la URL prefirmada y en cualquier listado del bucket.

El nombre original sí se guarda además como metadato (`Metadata: original-name`, línea 82), que es donde S-2 dice que debe ir — pero no se quitó de la clave.

**No hay bucket separado para contenido sensible** (S-3): `DOCUMENTS_BUCKET` recibe todo. El segundo bucket (`INCIDENT_EVIDENCE_BUCKET`) es por módulo, no por sensibilidad.

### Autorización sobre los objetos

| Endpoint | Archivo:línea | Control de acceso |
|---|---|---|
| `POST /uploads/download-url` | `handler.js:111-126` | **Ninguno.** Recibe `fileKey` y devuelve URL prefirmada de lectura, válida 1 hora. No comprueba sesión, empresa ni propiedad del documento |
| `DELETE /uploads/{fileKey}` | `handler.js:204-220` | **Ninguno.** Borra cualquier objeto del bucket |
| `POST /uploads/presigned-url` | `handler.js:44-96` | `tenantId` viene del cuerpo, sin contraste. Se puede escribir en el prefijo de otra empresa |

Con los buckets sin versionado (verificado por ti en AWS), el borrado del segundo endpoint es **irreversible**.

**S-10 no está parcialmente implementado: está ausente.** El checklist dice "la URL prefirmada se emite solo tras validar el permiso sobre ese documento". Hoy no se valida nada.

### Validación de archivo (S-11)

- Tipo MIME: se valida contra `ALLOWED_MIME_TYPES` (línea 58) pero usando el `fileType` **declarado por el cliente**, no el número mágico del binario. Renombrar un ejecutable a `.pdf` y declarar `application/pdf` pasa.
- Tamaño: se valida `fileSize` del cuerpo (línea 63), pero la URL prefirmada se emite sin `ContentLengthRange`, así que el límite no se aplica en la subida real.

---

## Inventario 5 — Roles IAM y permisos efectivos

**Hay un solo rol compartido por las 70 funciones.** `Backend/serverless.yml:80-161` define `provider.iam.role.statements`, que Serverless aplica a todas las Lambda por igual. No hay roles por función.

| Permiso | Línea | Alcance | Comodín |
|---|---|---|---|
| `dynamodb:Query/Scan/GetItem/PutItem/UpdateItem/DeleteItem` | 85-90 | Las 15 tablas y **todos** sus índices (`/index/*`) | En los índices |
| `ses:SendEmail`, `ses:SendRawEmail` | 124-126 | `Resource: "*"` | **Sí** |
| `s3:PutObject/GetObject/DeleteObject` | 129-140 | Los dos buckets, con `/*` | Acotado al bucket |
| `sqs:*` (cuatro acciones) | 143-148 | Solo `DocumentStampQueue` | No |
| `sns:Publish` | 151-153 | Solo el topic de incidentes | No |
| `sns:Publish`, `sns:SetSMSAttributes` | 158-161 | `Resource: "*"` | **Sí**, con comentario que lo justifica |

**A-1 está violado en su forma más simple:** la función que transcribe audio con Gemini tiene los mismos permisos sobre la tabla de personas que el handler de personas. `kms:Decrypt` (C-3) no existe todavía, pero si se añade a este rol lo tendrán las 70 funciones, que es exactamente lo que C-3 quiere evitar.

No hay `dynamodb:*` ni `s3:*` literales — el checklist pregunta por eso y la respuesta es no. Pero el efecto práctico del rol único es equivalente.

---

## Inventario 6 — Endpoints que devuelven más campos de los que la pantalla consume

No hay serializadores por endpoint. El patrón general es devolver la entidad completa vía `toSafeFormat()`.

Casos concretos identificados:

| Caso | Ubicación | Exceso |
|---|---|---|
| Cualquier endpoint de persona | `Persona.js:277-317` | Devuelve `vigilanciaSalud` y `restriccionLaboral` a toda pantalla que pida una persona, incluidos listados donde solo se muestra nombre y cargo |
| Listado de personas | `Persona.js:277-317` | Devuelve además `asignaciones`, `historialAsignaciones`, `evidencias`, `cursos`, `contactoEmergencia` |
| Índices de DynamoDB | `serverless.yml:872-890` | Los tres GSI de `PersonasTable` usan `ProjectionType: ALL`, así que arrastran `pinHash`, `passwordHash` y los campos de salud a índices completos. Es el punto N-5, y aplica también acá |

**No hice el recorrido pantalla por pantalla** que exige el criterio de aceptación de C-10 ("ningún endpoint devuelve un campo que la pantalla no usa"). Lo que está verificado es que no existe el mecanismo: no hay lista de campos permitidos en ninguna parte.

---

## Inventario 7 — Datos personales en registros de aplicación

### Datos personales escritos explícitamente

| Archivo:línea | Qué registra |
|---|---|
| `Backend/handlers/signature-requests/handler.js:627` | **RUT en claro**: `` `[Offline Sync] Buscando persona con RUT: ${rut} en tenant ${tenantId}` `` |
| `Backend/handlers/notifications/handler.js:199` | Correo del destinatario |
| `Backend/handlers/notifications/handler.js:201` | Correo del destinatario |
| `Backend/handlers/notifications/handler.js:333` | Correo del destinatario, en recuperación de contraseña |
| `Backend/handlers/notifications/handler.js:335` | Correo del destinatario |
| `Backend/handlers/incidents-module/incidents.repository.js:152` | Nombre y apellido del prevencionista |
| `Backend/handlers/tenants-module/handler.js:144` | `JSON.stringify` del resultado del envío, que incluye el correo |
| `Backend/handlers/suggestions/handler.js:123` | Correo del destinatario |

### Volcado de excepciones (L-11)

El patrón `console.error('mensaje:', err)` aparece en todos los handlers. Solo en `signatures/handler.js` hay 8 apariciones (líneas 218, 312, 341, 375, 414, 465, 531, 599, 636).

**Matiz honesto:** ese patrón registra el objeto `Error`, no la entidad de negocio. El riesgo real aparece cuando el error viene del SDK de AWS, porque `ConditionalCheckFailedException` y similares incluyen el `Item` en `$response`. No verifiqué caso por caso si alguno de esos errores arrastra datos personales. **Lo declaro como riesgo probable, no como hecho confirmado.**

### Retención

**No hay `logRetentionInDays` en `Backend/serverless.yml`.** Todos los grupos de CloudWatch quedan con la retención por defecto de AWS, que es **infinita**. El RUT de la línea 627 lleva ahí desde que existe el módulo offline.

---

## Inventario 8 — Destinos de log y retención efectiva

| Destino | Declarado en el repositorio | Retención |
|---|---|---|
| CloudWatch de las 70 Lambda | No (`logRetentionInDays` ausente) | Infinita por defecto |
| Registros de acceso de API Gateway | No (`accessLogSettings` ausente) | No activos, o activos por fuera del repositorio |
| Trazas X-Ray | No (`tracing` ausente) | No activas |
| Eventos de SES | No declarados | Por verificar en la consola |
| Eventos de SNS / entrega de SMS | No declarados | Por verificar en la consola |
| Bitácora de auditoría de acceso (A-3) | **No existe** | — |

Los tres últimos **no los puedo determinar desde el repositorio**. Requieren inspección en AWS, igual que el inventario de grupos de CloudWatch de L-1, que incluye los de `hackatonbackendv2-dev` y `hackatonbackendv2-testeo-dev`.

**L-10 no aplica todavía:** no hay bitácora de auditoría que separar del log de aplicación, porque no existe.

---

## Inventario 9 — Residuos que sobreviven a destruir el stack

| Residuo | Situación verificable en el código |
|---|---|
| **Buckets de S3** | **No están declarados en CloudFormation.** Confirmado: `grep "AWS::S3::Bucket" Backend/serverless.yml` no devuelve nada. Coincide con lo que verificaste en AWS. Destruir el stack **no los toca**: sobreviven enteros, con todo su contenido |
| Versiones anteriores y marcadores de borrado | No aplica: verificaste que ningún bucket tiene versionado. El contenido es la única capa, pero también es la única oportunidad de recuperación, y no existe |
| `DocumentStampQueue` y su DLQ | Declaradas (`serverless.yml:760`, `:767`). La DLQ retiene **14 días** (`MessageRetentionPeriod: 1209600`, línea 764) y `maxReceiveCount: 3` (línea 775). Un mensaje fallido contiene el `documentId` a estampar |
| Grupos de CloudWatch | Sobreviven si se crearon fuera del stack o con retención propia. Hay que inventariarlos en AWS |
| Tablas de DynamoDB | `DeletionPolicy: ${self:custom.deletionPolicy}`, que es `Retain` en prod y `Delete` en el resto (`serverless.yml:17-19`). **En `prod` las tablas sobreviven a `sls remove`** |
| Snapshots y exportaciones | No determinable desde el repositorio |

### Discrepancia que hay que resolver antes de destruir

**El repositorio declara 15 tablas. Tú verificaste 17 en AWS por stack.** Las declaradas son: Tenants, Obras, Personas, Documents, Suggestions, Activities, Ausencias, Epp, EstructuraPreventiva, Incidents, Signatures, SignatureRequests, Surveys, Inbox, Sessions.

Faltan dos por identificar. Pueden ser residuo de un esquema anterior o recursos creados a mano — el mismo problema que los buckets. **No las nombro porque no las puedo ver desde el código.** Entran en B-2 antes de ejecutar cualquier destrucción.

---

## Inventario 10 — Recursos a destruir y verificación del respaldo

Lo que puedo aportar desde el repositorio:

- **15 tablas por stack**, nombradas `BuildAndServe-{recurso}-{stage}` vía `${self:service}-...-${self:provider.stage}` (`serverless.yml:28-43`).
- **2 colas** (`DocumentStampQueue` y `DocumentStampDLQ`), FIFO, nombradas `${self:service}-document-stamp[-dlq]-${stage}.fifo`.
- **1 topic SNS** de incidentes.
- **2 buckets** referenciados por variable de entorno y **no gestionados**: `buildandserve-repository-${stage}` y `buildandserve-evidence-${stage}` (`serverless.yml:15-16`).
- **70 funciones Lambda**, cada una con su grupo de CloudWatch.

**Sobre B-1 (respaldo verificado):** el checklist lo da por cerrado. No puedo confirmarlo desde el código y tampoco es necesario — lo verificaste tú. Sí señalo algo que el checklist no contempla: dijiste que **`BuildAndServe-prod` es un clon de los datos del pilotaje, no un despliegue limpio.** Eso significa que los datos de EBCO están hoy en **cuatro** lugares, no en dos: los dos stacks de `hackatonbackendv2` y los dos de `BuildAndServe`. G-7 fija la destrucción del respaldo `hackatonbackend`, pero `BuildAndServe-prod` también contiene esos datos y el checklist lo trata como si fuera a nacer vacío.

---

## C-7 — Modo sin conexión: qué se guarda en el dispositivo

Pediste atención especial a esto. La conclusión tiene dos partes y una es peor de lo que el checklist supone.

### El secreto del servidor NO viaja al cliente

Confirmado. La validación del PIN ocurre siempre en el servidor:

- `Backend/handlers/signature-requests/handler.js:647` — `verifyPin(pin, persona._pinHash, persona.personaId)` en el endpoint de lote offline.
- `Backend/lib/utils/validation.js:62-71` — `PIN_SALT` se lee de variable de entorno y solo se usa en el servidor.
- `Backend/lib/models/Persona.js:277-317` — `toSafeFormat()` no expone `pinHash`; solo publica `pinConfigurado`, un booleano (línea 302).

**El checklist pregunta si el secreto del servidor viaja al cliente. No viaja.**

### Pero lo que se guarda no es una huella: es el PIN en claro

El checklist dice *"hoy el PIN se guarda en el navegador como huella"*. **Eso no es lo que hace el código.**

`Frontend/src/hooks/useOfflineSignature.ts:108` guarda el PIN tal como lo tecleó la persona, sin transformación, dentro del objeto de firma pendiente. Ese objeto se persiste en **`localStorage`**, no en IndexedDB:

- `Frontend/src/hooks/useOfflineSignature.ts:24` — clave `pendingOfflineSignatures`
- `Frontend/src/hooks/useOfflineSignature.ts:39` — `localStorage.setItem(OFFLINE_SIGNATURES_KEY, JSON.stringify(pending))`

De modo que en un dispositivo de terreno queda, en texto plano y legible desde la consola del navegador, un arreglo JSON con el PIN de cada persona que firmó sin conexión.

**Hay un comentario que afirma lo contrario y es falso.** `Frontend/src/services/offlineStore.ts:17` declara:

```ts
pin: string; // Se guarda hasheado
```

No se hashea en ninguna parte. Ese comentario es probablemente el origen de la suposición del checklist.

### Cuándo se borra

Solo al sincronizar con éxito (`useOfflineSignature.ts:270`, `removePendingSignature`). En consecuencia:

- Si la sincronización falla de forma permanente —persona desvinculada, documento cancelado— el PIN **permanece indefinidamente**.
- **El cierre de sesión no lo borra.** `Frontend/src/context/AuthContext.tsx:204-207` elimina `auth_token`, `session_id`, `tenant_id` y `persona_id`, pero no `pendingOfflineSignatures`.
- Un cambio de persona en el mismo dispositivo tampoco lo borra. Es justo el escenario de L-9.

### El almacén con `pinHash` existe pero está muerto

`Frontend/src/services/offlineStore.ts:44` define `CachedWorker.pinHash` y `:216` define `cacheWorkers()`. **Nadie llama a `cacheWorkers`** — verificado por búsqueda en todo `Frontend/src`. El almacén `cachedWorkers` nunca se puebla.

`Frontend/src/api/workers.api.ts:31` declara `pinHash?: string` en el tipo `Worker`, herencia del modelo anterior a `Persona`. El servidor no lo envía, así que es un tipo que miente sobre la respuesta, no una filtración.

### Modelo de confianza real

No hay validación local del PIN. El modo sin conexión **no valida nada**: acumula credenciales en claro y las reenvía al servidor cuando hay red, que es quien decide. Funcionalmente es correcto y evita el problema de tener el verificador en el cliente. El precio es que el dispositivo almacena el secreto en vez de una prueba de conocimiento.

**Para C-7 el trabajo no es documentar el modelo: es rediseñarlo.** Firmar sin conexión sin guardar el PIN exige otra construcción —por ejemplo, un token de firma de un solo uso emitido cuando hay red— y eso es diseño, no endurecimiento.

---

## Dónde el checklist supone algo que el código no tiene

Ordenado por cuánto cambia el plan.

| Supuesto del checklist | Realidad |
|---|---|
| A-2 da por existente una sesión contra la cual contrastar el `tenantId` | **No hay autenticación en la API.** No existe la sesión |
| C-7: "el PIN se guarda en el navegador como huella" | Se guarda el **PIN en claro** en `localStorage`. El comentario que dice "hasheado" es falso |
| D-1/D-2 suponen el RUT como identificador técnico a migrar | El identificador primario ya es UUID (`PERSONA#{personaId}`). El RUT es llave solo en un GSI y en rutas del frontend |
| S-10: "enlaces temporales con alcance mínimo" como mejora | No hay **ninguna** validación de permiso al emitir URL de descarga o al borrar objetos |
| B-5: "destruir el stack y volver a desplegarlo" como vaciado limpio | Los buckets **no están en CloudFormation**, así que sobreviven intactos. En `prod` las tablas también (`DeletionPolicy: Retain`) |
| G-7 trata el respaldo `hackatonbackend` como el único lugar con datos del pilotaje | `BuildAndServe-prod` también los tiene, por ser un clon |
| L-10: separar la bitácora de auditoría del log de aplicación | La bitácora no existe todavía; no hay nada que separar |
| El inventario de tablas | El repositorio declara 15; en AWS hay 17. Dos sin identificar |

---

## Qué recomiendo antes de seguir el orden de la sección 11

El checklist plantea auditar, definir en frío, endurecer, vaciar. Con el hallazgo 0 encima, sugiero una corrección al orden:

1. **La autenticación va primero, y va antes del vaciado.** No es parte del endurecimiento de datos, pero mientras no exista, ninguno de los controles de las secciones 3 y 4 protege contra el acceso externo. Un autorizador JWT en `httpApi` más la validación de empresa contra el token es la pieza que falta.
2. **Declarar los buckets en CloudFormation antes de destruir nada.** Object Lock (S-8), cifrado con CMK (S-6) y versionado (S-7) solo se pueden fijar al crear el bucket. Como hoy están fuera del stack, el vaciado no los recrea: hay que crearlos nuevos ya endurecidos y apuntar las variables de entorno allí.
3. **Los dos endpoints de `uploads` sin autorización son explotables hoy**, con datos reales de pilotaje en `BuildAndServe-prod` y sin versionado que permita recuperar lo borrado.

El resto del orden de la sección 11 me parece correcto.

---

## Reproducibilidad

```bash
# Hallazgo 0
grep -n "authorizer\|jwtConfiguration" Backend/serverless.yml          # vacío
grep -rln "authorization" Backend/handlers                              # solo auth/handler.js
grep -n "Authorization" Frontend/src/api/client.ts                      # el cliente sí lo envía

# C-7
grep -n "OFFLINE_SIGNATURES_KEY\|localStorage.setItem" Frontend/src/hooks/useOfflineSignature.ts
grep -n "pin: string" Frontend/src/services/offlineStore.ts             # el comentario falso
grep -rn "cacheWorkers" Frontend/src                                    # solo su definición

# Infraestructura
grep -n "AWS::S3::Bucket" Backend/serverless.yml                        # vacío
grep -n "PointInTimeRecovery\|SSESpecification" Backend/serverless.yml  # vacío
grep -n "logRetentionInDays" Backend/serverless.yml                     # vacío
grep -c "AWS::DynamoDB::Table" Backend/serverless.yml                   # 15
```
