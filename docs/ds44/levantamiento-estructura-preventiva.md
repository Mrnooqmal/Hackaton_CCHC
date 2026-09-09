# Levantamiento previo — Estructura Preventiva (DS 44)

Fecha: 2026-09-08 · Commit base: 465f845 · Rama: pruebas

Notas exigidas por la regla 0.1 del encargo. Recogen lo que EXISTE hoy, no lo que
debería existir. Donde el encargo asume algo que el codigo no tiene, queda
marcado como BRECHA.

## 1. Entidades base

| Concepto | Dónde vive | Claves | Notas |
|---|---|---|---|
| Empresa | `lib/models/Tenant.js`, tabla `TENANTS_TABLE` | `PK TENANT#{id}` / `SK METADATA#{id}` | Tiene `cantidadTrabajadores` (contador declarado), `tamano` derivado, y `reglas.representanteLegal` (nuevo, Art. 8) |
| Obra / Faena | `lib/models/Obra.js`, tabla `OBRAS_TABLE` | `tenantId` + `obraId` | **NO tiene dotación.** Sí tiene `faenaCompartida`, `tieneMaquinaria`, `agentesFQB`, `faseDeming` |
| Persona | `lib/models/Persona.js`, tabla `PERSONAS_TABLE` | `personaId` | `asignaciones[] = { obraId, cargos[], fechaIngreso, estado }` es la fuente del vínculo laboral. `historialAsignaciones[]` append-only |
| Documento | `handlers/documents/handler.js`, tabla `DOCUMENTS_TABLE` | `documentId` | Catálogo `DOCUMENT_TYPES` con 46 tipos. `clasificacion: obra|diario`, `asignaciones[]`, `firmas[]`, `versiones[]` |

**Dotación por ámbito**: no existe como campo en Obra. Se puede DERIVAR contando
`Persona.asignaciones` activas por `obraId`. A nivel empresa existe
`Tenant.cantidadTrabajadores`, que es un contador declarado/ajustado por delta
(`TenantService.ajustarCantidadTrabajadores`).

## 2. Roles y permisos

`lib/permissions.js`: catálogo plano de permisos (`obras.ver`, `empresa.roles`…)
y `DEFAULT_ROLE_PRESETS` por tipo de rol.
`Tenant.TIPOS_PROTEGIDOS = ['admin','jefe_obra','prevencionista','supervisor','trabajador']`.
Los roles son configurables por empresa (`tenant.roles[]`), con los protegidos
garantizados. `personaPuede(persona, tenant, permiso)` resuelve el efectivo.

Quien administra empresa/obra: `admin` y `jefe_obra` (permisos `OBRAS_*`,
`EMPRESA_*`). Ese es el perfil que constituirá órganos.

**No existen** roles normativos (miembro CPHS, delegado, experto, encargado), y
según el encargo (5.10) NO deben crearse como roles del sistema: la investidura
es una asignación documental, no un permiso.

## 3. Firmas

- `lib/services/FirmaService.js`: `crear()` valida PIN/OFFLINE/PRESENCIAL, es
  idempotente por (persona, referencia), y escribe en `SIGNATURES_TABLE`.
- `handlers/signature-requests/`: solicitudes con `tipo`, `titulo`,
  `documentos[]`, `trabajadoresIds[]`, `estado: pendiente|en_proceso|completada|cancelada|vencida`.
- `documents.assign` + firma embebida en `documento.firmas[]`.
- `utils/versionarDocumento.ts` (frontend) encapsula el doble llamado
  nueva-version + signatureRequest. **Reutilizar esto, no duplicarlo.**

## 4. Notificaciones

`lib/events/EventBus.js` con 7 eventos registrados, todos aterrizando en el
Inbox (`INBOX_TABLE`, con `read`/`readAt` como acuse):
`document.assigned`, `activity.created`, `survey.assigned`,
`signature.requested`, `incident.reported`, `epp.validado`,
`document.version.updated`.

Un único Lambda programado: `scheduler.checkActivityAlerts`, `rate(30 minutes)`,
que hoy solo revisa actividades del día.

## 5. Fechas

`lib/utils/fechaChile.js` solo tiene `fechaHoraChile()` y `horaChileHHMM()` (zona
America/Santiago). **BRECHA: no hay cálculo de días hábiles ni calendario de
feriados.** El único precedente de días laborales es
`activities/handler.js:generarFechasRecurrencia`, que excluye sábado y domingo y
declara explícitamente que "los feriados se ignoran a propósito".

## 6. Completitud / cumplimiento

**BRECHA mayor.** No existe un motor de completitud como el que asume la sección 8
del encargo. Lo que hay:
- Catálogos declarativos en `Frontend/src/utils/ds44.ts` (678 líneas):
  `DS44_PLAN_DOCS`, `DS44_DO_PROCEDIMIENTOS`, `DS44_DO_CAPACITACIONES`,
  `DS44_CHECK_DOCS`, `DS44_ACT_DOCS`, más `evalAplicabilidad()`.
- El cálculo se hace INLINE en `Frontend/src/pages/ObraDetalle.tsx` (4.780 líneas)
  como booleanos y porcentajes por fase Deming.
- **No existen** los estados `Cumplido | Parcial | Pendiente | Vencido | NoAplica |
  FueraDeAlcance`, ni denominador con exclusiones, ni vista por bloque del FUF.
- **No existe** mapeo requisito-FUF → evidencia, ni export del FUF.

## 7. Umbrales de dotación hoy

`Tenant.TAMANOS` corta en 1-9 / 10-49 / 50-199 / 200+. **Ninguno de esos cortes
corresponde al DS 44**, que corta en 9, 25 y 100.
`Frontend/src/utils/ds44.ts:evalAplicabilidad` sí tiene cortes cercanos
(`cphs >= 26`, `delegado 10-25`, `depto_prevencion > 100`) pero
`encargado_oa <= 9` contradice el Art. 65 (aplica hasta 100) y toda esa lógica
vive SOLO en frontend, sin contraparte en backend.

## 8. Offline

`services/offlineStore.ts` + `hooks/useOfflineSync.ts` + `useOfflineSignature.ts`.
**El alcance offline actual es solo la FIRMA** (cola de solicitudes de firma que
se sincroniza al recuperar conexión). La carga de archivos a S3 y la creación de
documentos NO son offline.

## 9. Patrones de la casa a respetar

- **Módulo de dominio DS 44**: `lib/ptp.js` es el ejemplo canónico. Lógica pura,
  espejo en `Frontend/src/utils/*.ts`, tests con `node --test`, estado DERIVADO
  de los datos existentes en vez de campos declarados.
- **Entidad/tabla nueva**: `lib/services/EppCatalogoService.js` + `EppTable` en
  `serverless.yml`. Clave simple `tenantId` (PK) + `{entidad}Id` (SK), servicio
  con `list/getById/create/update/remove`, rutas colgando de un módulo existente
  (`tenants-module` expone `/tenants/{id}/epp`).
- Tests: `node --test tests/*.test.js`. Se mockea `docClient.send`.

## 10. Estado del suite al iniciar

100 pass / 9 fail. Las 9 fallas están todas en
`tests/documents-integridad.test.js`, archivo SIN TRACKEAR que quedó de una
sesión anterior y prueba una implementación que fue descartada. No es parte de
este encargo.

---

# Bitácora de fases

Actualizado: 2026-09-09

## Cerradas

| Fase | Qué quedó |
|---|---|
| 1. Levantamiento | Este documento |
| 2. Servicio de dominio | `lib/estructura-preventiva.js` — umbrales, dotación, mandato, validaciones §10. Puro y determinista: corre igual en el cliente sin conexión |
| 3. Modelo de datos | `EstructuraPreventivaService.js` + `EstructuraPreventivaTable` + 13 tipos de documento |
| 4. API | `handlers/estructura-module/` — 10 rutas |
| 5. Paso de estructura | `EstructuraPreventivaPanel.tsx` en MiEmpresa y ObraDetalle · espejo `utils/estructuraPreventiva.ts` |
| 6. Asistente | `EstructuraConstituir.tsx` — un flujo para las 4 figuras |
| 7. Reuniones y actas | `EstructuraOrgano.tsx` — integrantes, acreditaciones, documentos, reuniones, comunicación de acuerdos |
| 8. Documentos por período | Programa de trabajo (ítem 38) y registros e indicadores (46/47, excluyentes) |

## Pendientes

| Fase | Alcance |
|---|---|
| 9. Completitud y recordatorios | **Motor transversal** (decisión del usuario): los 6 estados y el registro requisito-FUF → evidencia, migrando el cálculo inline de `ObraDetalle.tsx`. Más los 8 recordatorios de la §8 sobre `scheduler` + EventBus |
| 10. Verificación | Pasada contra §10 y §12 con reporte de contradicciones |

## Decisiones tomadas y por qué

- **Una tabla, no tres.** Prefijos en la sort key (`ORG#` / `MIE#` / `REU#`). Integrantes y reuniones no existen sin su órgano; listar órganos no arrastra las ~24 reuniones de cada mandato.
- **Módulo propio** (`estructura-module`) en vez de repartir entre `tenants` y `obras`: los órganos viven en ambos ámbitos.
- **La dotación se recalcula en el servidor** al constituir. Fija si el órgano nace obligatorio o voluntario, y ese dato no puede venir del navegador.
- **Días hábiles sin feriados** (decisión del usuario, 2026-09-08). El error cae del lado seguro: los feriados solo alargan el plazo real, así que el recordatorio avisa temprano. La UI debe rotular la fecha como referencial.
- **Programa de trabajo y registros e indicadores son Documentos con `periodo`**, no entidades nuevas. Su contenido es del usuario.
- **Las funciones del Art. 47 se listan como texto, no como checklist.** Marcarlas daría falsa sensación de validación sobre algo que nadie comprobó.

## Supuestos que afectan cumplimiento normativo (marcados, no resueltos)

1. **Feriados excluidos del cálculo de días hábiles** (ítem 32). Conservador, pero la fecha límite es referencial.
2. **Offline**: hoy solo cubre firmas (`offlineStore` + `useOfflineSync`). La carga de actas y el registro de reuniones NO funcionan sin conexión. El cálculo de obligaciones sí es local.
3. **No hay export del FUF**: la §10.4 pide que panel y export lean lo mismo. El export no existe todavía; el registro requisito→evidencia se construye en la fase 9.

## Fase 9 (2026-09-09)

**Motor de completitud** — `lib/completitud.js` + `lib/completitud-estructura.js`.

- Seis estados. `NoAplica` y `FueraDeAlcance` salen del denominador: un porcentaje
  que castiga por no tener lo que no corresponde miente y el usuario deja de creerle.
- `Parcial` cuenta como medio punto. Un documento cargado sin firmar no es lo mismo
  que no tenerlo, pero tampoco es cumplimiento.
- `NoAplica` siempre lleva justificación normativa: ocultar lo excluido es tan opaco
  como castigar de más.
- Un requisito NO está `Cumplido` si su documento tiene firma pendiente; el estado se
  deriva de las asignaciones del documento, no de un campo duplicado.
- Un requisito que lanza excepción se reporta como `Pendiente` con el motivo: no
  tumba el panel ni se da por cumplido.
- `completitud-estructura.js` es el único lugar que vincula ítem del FUF con
  evidencia (§10.4). Cubre 19 ítems (30 a 48), incluidos los declarados fuera de
  alcance (33, 42-45), que se muestran en vez de omitirse.

**Recordatorios** — `handlers/scheduler/estructura-alertas.js`, Lambda diaria
`cron(0 13 * * ? *)`. Escriben en el Inbox con `senderRol: 'system'` (sin SMS).
Idempotentes por clave con período en `alertas` del propio órgano o reunión.

Bug encontrado por los tests: el hito de "0 días" del término de mandato tenía borde
inferior, así que solo avisaba el día exacto del vencimiento. Si el scheduler no
corría ese día, el aviso se perdía para siempre. Corregido con ventanas explícitas
y test de regresión.

**Pendiente de la fase 9**: `revisarEstructuraFaltante` (aviso semanal de estructura
obligatoria no constituida) quedó como stub. Necesita recorrer tenants y obras, que
es exactamente lo que hace `completitudAmbito`; se cierra cuando ese recorrido exista
a nivel de job.
