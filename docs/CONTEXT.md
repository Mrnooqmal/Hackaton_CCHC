# Contexto del Proyecto — Build & Serve (Gestión SST / DS 44)

> **Propósito de este documento:** dar a otro modelo (o desarrollador) todo el
> contexto necesario para trabajar en este repositorio sin tener que re-explorar
> todo el código. Refleja el **estado real del código** (rama `pruebas`,
> julio 2026), que ha evolucionado más allá de lo descrito en `README.md` y
> `ARCHITECTURE.md`. **Ante discrepancias, este documento y el código mandan
> sobre el README.**

---

## 1. Qué es el proyecto

**Build & Serve** es una plataforma **SaaS multi-tenant** para digitalizar la
**Seguridad y Salud en el Trabajo (SST)** en obras de construcción chilenas,
eliminando el papeleo físico y automatizando el cumplimiento del **Supremo
Decreto 44 (DS 44)**.

- **Cliente / dominio:** Cámara Chilena de la Construcción (CCHC). PoC modelado
  sobre los procedimientos de la constructora **EBCO** (códigos `PR-PO-*`,
  `PR-FR-*`, `RI 76`, etc.).
- **Equipo:** "The Code Cookers" (Hackathon CChC 2025).
- **Objetivo central:** que una obra pueda demostrar cumplimiento DS 44
  (documentos obligatorios firmados por fase/cargo) con trazabilidad digital
  inmutable, reemplazando carpetas físicas de firmas.

### El DS 44 en una frase
Reglamento chileno sobre gestión preventiva de riesgos laborales que obliga a
las empresas a identificar riesgos por cargo, informar al trabajador (IRL),
capacitar (Art. 16), entregar EPP con evidencia (Art. 13), mantener
procedimientos de trabajo seguro y reglamento interno, y documentar todo. La
plataforma convierte esas obligaciones en **kits de onboarding por cargo** y
documentos firmables con trazabilidad.

---

## 2. Stack tecnológico (real)

### Frontend — `Frontend/`
- **React 19** + **TypeScript ~5.9** + **Vite 7**
- **React Router v7** (`react-router-dom` ^7.11) — rutas en `src/App.tsx`
- **axios** para llamadas API (`src/api/*.api.ts`, cliente en `src/api/client.ts`)
- Estado global vía Context API: `AuthContext`, `BrandContext` (theming por
  tenant), `LayoutContext`, `ObraContext` (obra activa), `ToastContext`
- Firma **offline**: IndexedDB vía `src/services/offlineStore.ts`, PWA/banner
  offline (`OfflineBanner.tsx`)
- CSS modular con variables (no framework de UI pesado)
- Manual de usuario embebido: VitePress en `Frontend/manual-src/`, build a
  `Frontend/public/manual/` (se sirve desde `/manual/` en producción)

### Backend — `Backend/`
- **Serverless Framework v3** sobre **AWS Lambda** (Node.js 18)
- Config única: `Backend/serverless.yml` (~1000 líneas: functions + resources)
- Ruteo interno: los módulos grandes usan **itty-router** con `{proxy+}` (un
  Lambda por módulo); los módulos chicos exponen funciones por endpoint
- **DynamoDB** (todas las tablas `PAY_PER_REQUEST`)
- **S3** para archivos (documentos, evidencias, firmas de enrolamiento)
- **Auth:** JWT + Bcrypt; firma digital por **PIN** (hash con `personaId`)
- **IA:** Google Gemini (`lib/ai/gemini.js`), solo para transcribir audio al
  reportar un incidente
- **Notificaciones:** SMS (`lib/services/SmsService.js`), email, e inbox interno
- **EventBus** interno (`lib/events/EventBus.js`) para notificaciones
  desacopladas (p.ej. `document.assigned` → mensaje en inbox)

### Despliegue
- Ver `Backend/DEPLOY.md`. Stages parametrizados (`dev` / `prod`). En prod las
  tablas usan `DeletionPolicy: Retain`.

---

## 3. Estructura del repositorio

```
Hackaton_CCHC/
├── README.md               # Descripción (parcialmente desactualizada)
├── ARCHITECTURE.md         # Modelo de datos DynamoDB (base, algo desactualizado)
├── DOCS_AGENT_PROMPT.md    # Prompt para generar el manual VitePress
├── SETUP_GUIDE.md / REFACTOR.md
├── docs/
│   ├── CONTEXT.md          # ESTE archivo
│   └── superpowers/        # plans/ y specs/ de rediseño de interfaces
├── Backend/
│   ├── serverless.yml      # Infra + rutas (fuente de verdad de endpoints)
│   ├── handlers/           # 1 carpeta por módulo (ver §5)
│   ├── lib/
│   │   ├── clients/        # dynamodb.js, s3.js
│   │   ├── models/         # Tenant.js, Obra.js, Persona.js
│   │   ├── services/       # Lógica de negocio (ver §6)
│   │   ├── ai/             # gemini.js (transcripción de audio)
│   │   ├── events/         # EventBus.js
│   │   ├── ds44.js         # ★ Catálogo de cargos + kits DS44 (núcleo del dominio)
│   │   ├── permissions.js  # ★ Catálogo de permisos y presets por rol
│   │   └── utils/          # response.js, validation.js
│   └── scripts/
└── Frontend/
    ├── src/
    │   ├── pages/          # ~36 páginas (una por vista)
    │   ├── components/     # UI reutilizable (SignaturePad, PinInput, modales…)
    │   ├── api/            # clientes axios por dominio
    │   ├── context/        # Auth, Brand, Layout, Obra, Toast
    │   ├── utils/ds44.ts   # ★ ESPEJO de Backend/lib/ds44.js (mantener sync)
    │   └── permissions.ts  # ★ ESPEJO de Backend/lib/permissions.js
    └── manual-src/         # Manual VitePress (build → public/manual/)
```

> **⚠️ Archivos espejo críticos:** `Backend/lib/ds44.js` ↔ `Frontend/src/utils/ds44.ts`
> y `Backend/lib/permissions.js` ↔ `Frontend/src/permissions.ts`. Si cambias uno,
> cambia el otro. Están marcados como "ESPEJO — mantener sincronizados".

---

## 4. Modelo de dominio y conceptos clave

### 4.1 Multi-tenant
- Toda tabla operacional lleva `tenantId`. El `tenantId` **se extrae siempre del
  JWT**, nunca del body (previene fuga de datos entre clientes).
- `tenant-0` reservado para superadmin cross-tenant.
- Jerarquía: `Tenant > Obra > (Documentos, Actividades, Incidentes)` y
  `Tenant > Persona > (Firmas, Asignaciones)`.
- Un tenant tiene `reglas.cargos` (catálogo de cargos editable con sus kits DS44),
  `roles` (definiciones de rol con permisos), `settings.modulosActivos`,
  branding (colores, logo).

### 4.2 Persona (identidad unificada)
Una sola entidad `Persona` reemplaza las antiguas tablas `Users` y `Workers`.
Un `personaId`, un solo `pinHash` (hasheado con `personaId`). Campos:
`rol`, `cargo`, `obraIds` (lista — puede estar en varias obras), `tieneAccesoWeb`
(si puede login web → `passwordHash`), `pinHash` (para firmar en terreno aunque
no tenga acceso web), `habilitado` (completó enrolamiento), `estado`.

### 4.3 Roles y permisos (`lib/permissions.js`)
- **5 roles:** `admin`, `jefe_obra`, `supervisor`, `prevencionista`,
  `trabajador`/`colaborador`.
- `admin` siempre tiene **todos** los permisos.
- Los permisos son **granulares** (ej. `obras.crear`, `firmas.crear`,
  `persona.epp`, `incidentes.calificar_accidente`, `empresa.roles`…) y se
  resuelven dinámicamente por tenant vía `resolvePersonaPermisos(persona, tenant)`.
- El tenant puede redefinir los permisos de cada rol (`tenant.roles[].permisos`);
  hay presets por defecto (`DEFAULT_ROLE_PRESETS`). `trabajador`/`colaborador`
  siempre reciben el mínimo (`actividades.ver`) unido a su rol.
- En el frontend, `ProtectedRoute` usa `requiredPermission` (ver rutas en §7).

### 4.4 DS 44: cargos, kits y alcances (`lib/ds44.js` — núcleo)
Este es el corazón del dominio. Conceptos:

- **Catálogo de cargos** (`DS44_CARGOS`): CARPINTERO, JORNAL_ASEO,
  MAESTRO_TERMINACIONES, MAESTRO_ALBANIL, TRAZADOR (modelados con kit real EBCO)
  + cargos `legacy` (OPERARIO, SOLDADOR, etc.) que caen al kit genérico.
- **Kit por cargo** = lista de ítems documentales que el DS 44 exige a ese cargo.
  Cada ítem tiene:
  - `tipo`/`key`: IRL, POLITICA_SSO, REGLAMENTO_INTERNO, ENTREGA_EPP,
    CAPACITACION_SST, PR_PO_08 (Trabajos en Altura), EXAMEN_ALTURA, etc.
  - `accion`: `DIFUSION_FIRMA` | `CAPACITACION_EVALUACION` (con `notaMinima`
    70/90) | `ENTREGA_EPP` | `EVIDENCIA_EXTERNA` | `INGRESO_VIGILANCIA` | `ENCUESTA`
  - `alcancePlantilla` — **de dónde sale el archivo/plantilla**:
    - `tenant`: PDF corporativo único para todas las obras (Reglamento, Política, IRL de cargo)
    - `obra`: derivado del MIPER de esa obra (IRL, Plan de Emergencias)
    - `persona`: evidencia individual del trabajador (EPP, examen, encuesta)
  - `bloqueante`: si su ausencia bloquea el onboarding (ej. `EXAMEN_ALTURA`)
  - `requiereFirmaRelator`: la capacitación necesita firma del relator además del trabajador
  - `matrizEpp`: para ENTREGA_EPP, lista de EPP por cargo (algunos `critico: true`)
- **Matriz EPP por cargo** (`DS44_EPP_MATRIZ`, código `PR-FR-85`): qué EPP recibe
  cada cargo; ítems críticos (arnés, doble cabo de vida, respirador) marcados.
- **Trabajador multi-cargo:** `resolveKitUnion(catalog, cargos)` une kits de
  varios cargos, deduplica por `key` y se queda con lo **más estricto**
  (bloqueante OR, notaMinima MAX, firma relator OR), guardando `cargosOrigen`
  para auditoría.
- **Evidencia reutilizable** (`esEvidenciaReutilizable`): examen de altura,
  certificados externos, ingreso a vigilancia MINSAL — no se re-piden por obra,
  se reusa la evidencia vigente de la persona.
- El catálogo se **siembra** por tenant (`buildDefaultCargoCatalog`) y luego es
  **editable** por el tenant (persistido en `Tenant.reglas.cargos`); se sanea con
  `sanitizeCargoCatalog` en el PUT.
- **Cambio de cargo** (`personas-module/handler.js`): al reasignar a una persona
  con cargos distintos, `runOnboardingForObra` es idempotente **por cargo** y
  `reconcileCargoDocs` **archiva** los documentos de onboarding **no firmados**
  que pertenecían solo al cargo anterior; los del cargo nuevo se generan. Se
  **preservan** los firmados (auditoría) y los transversales (`alcance=tenant`,
  sin `cargosOrigen`). Los ítems de evidencia (`EVIDENCIA_EXTERNA`,
  `INGRESO_VIGILANCIA`) y los reutilizados **no** emiten `document.assigned`
  (no son documentos a firmar).

### 4.5 Obra: fases físicas + ciclo Deming (`lib/services/ObraService.js`)
Dos dimensiones distintas:
- **Etapa constructiva (física):** `excavacion → obra_gruesa → terminaciones →
  entrega` (`etapaConstructivaActual`, `fasesConfig`). Informativa.
- **Ciclo Deming (normativo DS44):** `plan → hacer → verificar → actuar`
  (`faseDeming`, `cumplimientoDS44`). `avanzarFaseDeming()` marca timestamps de
  cumplimiento. Esta es la dimensión que rige el cumplimiento DS 44.

### 4.6 Documentos: clasificaciones
- **`obra`**: obligatorios por fase/DS44, precreados al crear la obra según
  `fasesConfig`/kit. Documentos de referencia que deben existir y estar firmados.
- **`diario`**: se crean y **asignan a personas** específicas → EventBus emite
  `document.assigned` → mensaje en inbox → firma individual (PIN o presencial) →
  estado de asignación `firmado`. Tienen fecha límite opcional (→ `vencido`).
- **`empresa`**: documentos corporativos transversales asignados a la persona
  (ej. Reglamento Interno, Política SST). Se cuentan en el cumplimiento/resumen
  de firmas junto con los demás asignados (`MisFirmasResumen` lista por
  `asignadoA`, no solo `diario`).
- Estado de asignación por persona en `doc.asignaciones[]` (`personaId`,
  `estado`, `fechaFirma`). El botón "Asignar" en el frontend requiere el permiso
  de subir documentos.

### 4.6.1 Versionado de procedimientos + notificación (`POST /documents/{id}/nueva-version`)
Los **procedimientos** de obra (tipos en `TIPOS_PROCEDIMIENTO`: `PROCEDIMIENTO_TRABAJO`,
`OPERACION_MAQUINAS`, `PROCEDIMIENTO_EPP`, `PLAN_EMERGENCIAS`, `GESTION_CAMBIOS`,
`COORDINACION_ENTIDADES`, etc. — espejo `esProcedimiento` back/front) soportan
**versionado con re-firma y notificación automática a la línea de mando**:
- Reemplazar el archivo de un procedimiento **que ya tenía uno** publica una
  **nueva versión** (`handler.nuevaVersion`): archiva la versión anterior en
  `doc.versiones[]` (snapshot con `s3Key`, `motivo`, quién/cuándo y sus firmas),
  sube `doc.version`, resetea las `asignaciones` a `pendiente` (**re-firma
  obligatoria**), limpia `firmas` e invalida el PDF estampado cacheado
  (`documentoFirmadoS3Key`). Exige `motivo`; control de concurrencia por
  `versionEsperada`. La primera subida a un doc sin archivo es actualización
  normal (sigue v1), no genera versión.
- Emite el evento **`document.version.updated`** → `EventBus.onDocumentVersionUpdated`:
  avisa por **inbox** con prioridad `high` a la **línea de mando** del tenant
  (`resolverLineaMando`: roles `admin`, `jefe_obra`, `supervisor`, `prevencionista`)
  y una **tarea de re-firma** (`normal`) a los firmantes previos (sin duplicar a
  quien ya es mando; excluye al que publicó). El SMS **no se usa** por ahora: se
  deja la prioridad `high` para que se enganche solo cuando se reactive el canal.
- **Frontend** (`ObraDetalle.tsx`, sección procedimientos DO): botón "Nueva
  versión", badge `v{n}`, aviso + `motivo` obligatorio en el modal (selector de
  archivo con estilo de la app), y **panel de historial de versiones** con
  descarga por versión (`uploadsApi.getDownloadUrl`).
  `FirmaService`/`SignaturesTable` **no se tocan** (firmas reales quedan intactas
  en su tabla inmutable; en `versiones[]` va solo un snapshot para auditoría).
- **Re-firma visible en "Mis Firmas":** además de resetear `asignaciones` a
  `pendiente`, al publicar la nueva versión el frontend crea una **`SignatureRequest`**
  (`referenciaId = documentId`, versión en el título) para los firmantes previos.
  Sin esto la re-firma solo aparecería en el inbox: "Mis Firmas" lee de
  `signatureRequestsApi.getPendingByWorker` + docs `clasificacion:'diario'`, y los
  procedimientos son `clasificacion:'obra'`. El módulo **Documentos** (`Documents.tsx`)
  categoriza por `tipo` (normativos/diarios/repositorio) y **no** lista los
  procedimientos de obra: éstos se firman desde "Mis Firmas" y el detalle de obra.

### 4.7 Firmas digitales (`lib/services/FirmaService.js`) — Strategy Pattern
4 estrategias de validación:
- **PIN**: verifica PIN contra `pinHash` (hasheado con `personaId`). Método principal.
- **OFFLINE**: valida `timestampLocal` + `offlineToken`; capturada sin red
  (IndexedDB en frontend) y sincronizada al reconectar.
- **PRESENCIAL**: registrada por un tercero (relator/supervisor).
- **BIOMETRICO**: stub, **no implementado**.

Cada firma se registra **inmutable** en `SignaturesTable` con `token`,
`personaId`, `tenantId`, RUT/nombre, `tipoFirma`, `referenciaId`, fecha/horario/
`timestamp`, `ipAddress`, `metodoValidacion`, `estado` (`valida`|`disputada`|
`anulada`). Verificable por token (`GET /signatures/verify/{token}`).

> **⚖️ Consulta legal PENDIENTE (no tocar):** La validez jurídica del PIN como
> firma electrónica ante un fiscalizador DS 44 está en evaluación con la Dirección
> del Trabajo (acuerdo reunión CChC 2026-06-10). **No modificar la implementación
> de `FirmaService`** (PIN + token + IP + timestamp en `SignaturesTable`) hasta
> tener respuesta oficial. Aplica a firmas de documentos, firma asistida, firma
> cruzada de relator (CAPACITACION_SST) y validación de entregas de EPP.

### 4.8 Entrega de EPP (`lib/services/EppService.js`) — Art. 13
**Decisión reunión 2026-06-10:** la entrega de EPP **no** puede ser autodeclarada
por el trabajador. Flujo obligatorio:
1. Un **validador** (bodega/supervisor/prevencionista) crea la entrega.
2. Confirma la capacitación de uso (Art. 13, mín. 1 hora).
3. Valida la entrega (`validacion.estado = 'validado'`).
4. Recién entonces el trabajador **firma la recepción con PIN** (bloqueado hasta
   el paso 3, guard en `documents sign`/`sign-assisted`).
Historial dinámico de EPP por trabajador (insumo de investigaciones de accidentes).
Motivos de reposición: desgaste, pérdida, accidente, cambio_talla, otro.

### 4.9 Actividades: asistencia, cierre, atraso y alertas (§3 y §6 del checklist)
Sobre el módulo de actividades (`handlers/activities/handler.js` + `Frontend/src/pages/Activities.tsx`):

- **Estados:** `borrador → programada → completada | cancelada`. **No se usa `en_curso`.**
  `borrador` lo crea `POST /activities/plan` (esqueleto mensual); `completada` es un
  **cierre explícito**, no un efecto de firmar.
- **Firmar todo el día, sin corte por hora:** `registerAttendance` **no** cierra la
  actividad ni sobrescribe `horaFin`. Se puede firmar durante todo el día de la
  actividad, incluso **después de cerrada** (rezagados); solo se bloquea `cancelada`/
  `borrador` y el tramo previo a `horaInicio` (frontend `esFirmable`).
- **Cierre explícito** vía `PATCH /activities/{id}` con `estado:'completada'` y guardas:
  exige **≥1 firma** y un **registro con contenido** (`registroTieneContenido`); fija
  `horaFin` = hora de cierre. Editar `planificacion`/`permisosTrabajo` sigue permitido
  aun cerrada (registro post-charla).
- **Reasignación de relator (reemplazos):** el `PATCH` acepta `relatorId` mientras la
  actividad **no tenga firmas** (con firmas → 409: el relator ya es parte del acta).
  Valida que la persona sea del tenant, mantiene el invariante `responsables[0] ===
  relatorId` (el saliente deja de ser responsable) y, si el borrador venía del plan,
  guarda **`relatorPlanificadoId`** = a quién lo asignaba originalmente. Ese campo es
  el que sostiene la trazabilidad del reemplazo y además **lo usa la idempotencia de
  `/activities/plan`** (`yaPlanificadas` indexa por `relatorPlanificadoId || relatorId`),
  para que re-generar el mes no recree el borrador del responsable original.
  El selector de relator vive en el modal "Nueva actividad" **y** en "Completar
  actividad planificada"; ambos se llenan con las personas de la obra, sin filtro por rol.
- **Atraso:** cada asistente guarda `atraso`/`minutosAtraso` = firma posterior a
  `horaInicio`. ⚠️ **Zona horaria:** `FirmaService` (no se toca) guarda `firma.horario`
  en **UTC**; el atraso y la "hora de firma" del reporte se calculan/muestran
  convirtiendo `firma.timestamp` a **America/Santiago** (`utils/reporteActividad.ts`),
  y el backend calcula el atraso con hora local de Chile.
  ⚠️ Por lo mismo, en el frontend **el "día de hoy" se calcula con `hoyISO()`**
  (`utils/seguimientoActividad.ts`), nunca con `new Date().toISOString().split('T')[0]`:
  en UTC el día salta ~20:00 hora de Chile y las charlas del día dejan de ser firmables.
- **Semáforo/vencidas (§6, ítems 1 y 6):** `Frontend/src/utils/seguimientoActividad.ts`
  → `estadoSeguimiento(actividad)` = verde/amarillo/rojo (rojo = **vencida**: no
  completada/cancelada con `fecha < hoy`). Derivado en cliente (no cambia estado en DB);
  aplicado en calendario (anillo rojo), tarjeta de hoy e historial.
- **Pendientes de firmar + ausencias (§6, ítems 3, 4, 5):** panel en Activities que
  cruza convocados × firmados de las charlas de hoy (`construirFilasAsistencia`) y lista
  quién falta. Los **ausentes** (`AusenciasTable`, ver §8) se excluyen del rojo. UI para
  marcar/quitar ausente con motivo (permiso/licencia/falta/vacaciones/otro).
- **Alertas programadas (§6, ítems 2 y 4-push):** `handlers/scheduler/handler.js`
  (`checkActivityAlerts`, EventBridge `rate(30 minutes)`) avisa **al inbox** de los
  responsables (sin SMS: `senderRol='system'` + prioridad `normal`) cuando una charla
  superó su `horaFin` sin cerrarse, y a mediodía (12:00–12:30 Chile) si aún hay
  convocados sin firmar (excluye ausentes). **Idempotente** por día (flags en
  `activity.alertas.{horaLimiteAvisada,mediodiaAvisada}`).

---

## 5. Módulos backend (`Backend/handlers/`)

| Carpeta | Estilo | Responsabilidad |
|---|---|---|
| `tenants-module/` | itty-router `{proxy+}` | Onboarding tenant, roles, cargos, branding, config |
| `obras-module/` | itty-router | CRUD obras, fases, asignación de equipo, plantillas onboarding |
| `personas-module/` | itty-router | CRUD personas, carga masiva, enrolamiento, transferencia entre obras, currículum/historial |
| `auth/` | por-endpoint | login, change/forgot/reset-password, logout, me, validate-token |
| `documents/` | por-endpoint | CRUD, **nueva-version** (versionado de procedimientos + notificación a la línea de mando, §4.6.1), assign, sign, sign-bulk, sign-assisted, download-firmado, stamp |
| `signatures/` | por-endpoint | crear firma, enrolamiento, verify por token, disputas/resolución |
| `signature-requests/` | por-endpoint | solicitudes de firma, pendientes/historial por worker, offline-batch, stats |
| `activities/` | por-endpoint | charlas, capacitaciones; planificación mensual (`plan`), edición/cierre/**reasignación de relator** (`patch`), registro de asistencia, stats (ver §4.9) |
| `ausencias/` | por-endpoint | permisos/ausencias del día por obra/fecha (control de asistencia §6): `POST/GET/DELETE /ausencias` |
| `scheduler/` | schedule (EventBridge) | Lambda programada (cada 30 min) de alertas de asistencia al inbox: charla vencida sin cerrar y pendientes de firmar a mediodía (ver §4.9) |
| `incidents-module/` | itty-router | reportes de incidentes/accidentes, estadísticas KPI |
| `surveys/` | por-endpoint | encuestas, respuestas |
| `inbox-module/` | itty-router | mensajería interna + notificaciones |
| `uploads/` | por-endpoint | presigned URLs S3 (upload/download/batch), confirm, delete |
| `ai/` | por-endpoint | transcripción de audio (dictado del relato de un incidente) |
| `suggestions/` | por-endpoint | buzón de sugerencias |
| `notifications/` | por-endpoint | envío de emails (welcome, test) |

### Endpoints de IA (destacan por ser específicos del dominio)
`POST /ai/chat`, `/ai/risk-matrix`, `/ai/prevention-plan`, `/ai/daily-talk`
(charla diaria de 5 min), `/ai/miper` (genera matriz MIPER), `/ai/analyze-incident`
(análisis causa raíz), `/ai/extract-incident` (extrae datos estructurados de texto
libre), `/ai/transcribe` (audio → texto para reportes de terreno).

> **La fuente de verdad de los endpoints es `Backend/serverless.yml`.** Ahí están
> todas las rutas con su método HTTP y handler.

---

## 6. Servicios de negocio (`Backend/lib/services/`)

- **`TenantService.js`** — onboarding, config, roles, cargos del tenant.
- **`PersonaService.js`** — gestión de personas, enrolamiento, asignaciones.
- **`ObraService.js`** — obras, fases físicas + ciclo Deming, cumplimiento DS44.
- **`FirmaService.js`** — firmas (Strategy Pattern PIN/OFFLINE/PRESENCIAL/BIO). *No tocar (consulta legal).*
- **`EppService.js`** — entrega EPP validada Art. 13 (flujo de 4 pasos).
- **`RegistroService.js`** — registros/trazabilidad.
- **`PdfStampingService.js`** — estampado de firmas en PDF (pie de firma).
- **`SmsService.js`** — notificaciones SMS.
- Modelos: `lib/models/{Tenant,Obra,Persona}.js` (entidades con métodos de dominio,
  p.ej. `obra.getFaseSiguiente()`).
- `lib/health/healthSurvey.js` — encuesta de salud.

---

## 7. Frontend — páginas y rutas (`Frontend/src/App.tsx`)

Rutas públicas: `/login`, `/recuperar-clave`, `/restablecer-clave`,
`/register-admin`, `/onboarding` (TenantOnboarding), `/unauthorized`, `/equipo`,
`/about`.

Rutas protegidas (con `ProtectedRoute` + `requiredPermission`):
- `/` Dashboard
- `/personas`, `/personas/nueva`, `/personas/carga-masiva`, `/personas/:rut` (WorkerDetail)
  — `/workers` y `/users` redirigen a `/personas` (legacy)
- `/obras`, `/obras/nueva`, `/obras/:obraId` (detalle), `/obras/:obraId/equipo`
- `/cargos-onboarding` (CargosOnboarding — editor de kits DS44 por cargo)
- `/documents`, `/documents-repository`
- `/surveys`, `/incidents`, `/activities`
- `/signature-requests`, `/my-signatures`, `/offline-signatures`
- `/inbox`
- `/mi-empresa` (config empresa: roles, cargos, identidad/branding)
- `/enroll-me` (auto-enrolamiento), `/crear`, `/settings`, `/change-password`

Componentes de dominio destacados: `SignaturePad`, `PinInput`, `SignatureModal`,
`FirmaAsistidaModal`, `RiskMatrixVisual`, `MIPERVisual`, `ObraProgressCard`,
`ObraAplicabilidadKit`, `ObraPlantillasOnboarding`, `OfflineBanner`,
`WorkerEvidencias`.

---

## 8. Datos: tablas DynamoDB (según `serverless.yml`)

Todas `PAY_PER_REQUEST`. Nombre real: `${service}-{tabla}-${stage}`.

| Tabla | PK / SK | GSIs | Notas |
|---|---|---|---|
| **Tenants** | `PK=TENANT#{id}` / `SK=METADATA#{id}` | slug-index, status-index | Empresas cliente |
| **Obras** | `PK=TENANT#{id}` / `SK=OBRA#{obraId}` | obraId-index | Query por tenant sin Scan |
| **Personas** | `PK=TENANT#{id}` / `SK=PERSONA#{id}` | personaId-index, email-index, tenantRut-index | Identidad unificada |
| **Documents** | `PK=documentId` | tenantId-index | clasificación obra/diario; `version` + `versiones[]` (historial de procedimientos, §4.6.1) |
| **Activities** | `PK=activityId` | tenantId-index | charlas/capacitaciones; `alertas.*` para el scheduler (§4.9) |
| **Ausencias** | `PK=tenantId` / `SK={obraId}#{fecha}#{personaId}` | — | permisos/ausencias del día (§4.9, §6). Query por `begins_with(sk, "{obraId}#")` |
| **Incidents** | `PK=incidentId` | tenantId-fecha-index | reportes |
| **Signatures** | `PK=signatureId` | requestId-index, tenantId-index, personaId-index | **inmutable** |
| **SignatureRequests** | `PK=requestId` | tenantId-index | solicitudes de firma |
| **Surveys** | `PK=surveyId` | tenantId-index | encuestas |
| **Inbox** | `PK=recipientId` / `SK=messageId` | senderId-createdAt-index | mensajería |
| **Sessions** | `PK=sessionId` | — | + `ttl` (TTL automático) |
| **Suggestions** | `PK=suggestionId` | tenantId-createdAt-index | buzón |

Ver el detalle de campos en `ARCHITECTURE.md` (base, con algunas evoluciones ya
reflejadas aquí). Estructura S3: un bucket con aislamiento por prefijo
`tenants/{tenantId}/obras/{obraId}/...`, `.../personas/{personaId}/...`,
`.../evidencias/{incidentId}/...`.

---

## 9. Notas operativas y convenciones

- **Idioma:** todo en español (chileno, formal pero accesible). Nombres de dominio
  en español (obra, cargo, persona, firma, faseDeming); código/vars pueden mezclar.
- **`tenantId` del JWT, nunca del body.** Regla de seguridad transversal.
- **Archivos espejo** (`ds44`, `permissions`) front↔back: sincronizar siempre.
- **No modificar `FirmaService`** hasta resolver la consulta legal del PIN.
- **README/ARCHITECTURE parcialmente desactualizados:** describen una versión más
  antigua (p.ej. tablas "Users"/"Workers" separadas, módulos sin cargos DS44).
  El código real usa Persona unificada, kits DS44 por cargo, ciclo Deming, y
  permisos granulares por tenant. **Confía en el código.**
- **Manual de usuario:** ya **no** es VitePress. Vive dentro del frontend como un
  módulo React (`Frontend/src/manual/`: react-markdown + minisearch), con el contenido
  en `Frontend/src/manual/content/**/*.md` y la navegación en
  `Frontend/src/manual/manualNav.ts`. Se sirve en la ruta `/manual/*` (lazy chunk
  aparte, ver `App.tsx`), a pantalla completa fuera del shell de la app.
  ⚠️ `Frontend/manual-src/` quedó como resto vacío de la versión VitePress: **no editar
  ahí**. `DOCS_AGENT_PROMPT.md` es el prompt que generó el contenido. **28 páginas** en 5
  secciones: `guia-inicio/`, `ds44/` (documentos obligatorios, fases, EPP,
  capacitaciones, firmas), `modulos/` (los 11 módulos), `roles/` (los 5 roles con
  tabla de permisos por módulo), + home. Es **documentación de usuario final**
  (lenguaje no técnico), no técnica — para lo técnico está este `CONTEXT.md`.
  Está **alineado con el código real** (5 roles, firmas PIN/Offline/Presencial,
  advertencia legal del PIN, EPP trabajador+supervisor).
- **Historia reciente relevante** (git): planificación diaria de charlas (spec, ver
  §11); onboarding por cambio de cargo (`reconcileCargoDocs`); permisos de
  asignación de docs; resumen de firmas que cuenta también firmados; transferencia
  de personas entre obras con historial/currículum; carga masiva con supervisor;
  parametrización de service dev/prod; notificaciones SMS; multi-cargo.

## 11. Specs de diseño y estado de implementación

En `docs/superpowers/specs/` hay diseños **aprobados**. Los dos de actividades
(planificación diaria de charlas y planificación mensual/calendario) **ya están
implementados** (catálogos, bloque `planificacion`, `permisosTrabajo`, `plan`,
`patch`, calendario, reporte). Ver §4.9 para el comportamiento operativo vigente
(cierre, atraso, semáforo, ausencias, alertas) que evolucionó sobre esos specs.

- **`2026-07-23-planificacion-diaria-charlas-design.md`** — **IMPLEMENTADO**.
  Amplía el módulo de **Actividades** para la planificación diaria de charlas y el
  reporte post-charla:
  - Nuevo `Backend/lib/catalogos-actividad.js` con catálogos de fábrica
    (temas, recursos, riesgos, medidas) **configurables por tenant** en
    `tenant.reglas.catalogosActividad` (mismo patrón que cargos:
    `GET/PUT /tenants/{id}/catalogos-actividad`).
  - Bloque `planificacion` en la actividad (tema, recursos, riesgos, medidas,
    tipoTrabajo interior/exterior, clima, **protector solar** si es exterior,
    observaciones/participación) para tipos `CHARLA_5MIN` y `ART`.
  - `permisosTrabajo[]`: formularios estructurados con checklist para `ALTURA`,
    `ESPACIO_CONFINADO`, `TRABAJO_CALIENTE` (checklists fijos, no configurables).
  - Nuevo endpoint acotado `PATCH /activities/{id}` (solo `planificacion` y
    `permisosTrabajo`; nunca asistentes/firmas — auditoría intocable).
  - Reporte post-charla derivado (requeridos × asistentes, % asistencia) con
    descarga vía vista imprimible (`@media print` + `window.print()`), sin PDF
    en backend.
  - Nueva página `Frontend/src/pages/CatalogosActividad.tsx` (`/catalogos-actividad`,
    permiso `CARGOS_GESTIONAR`).
  - `REUNION_COMITE` y `SIMULACRO` ya están en el selector del frontend.
- **`2026-07-23-planificacion-mensual-calendario-actividades-design.md`** —
  **IMPLEMENTADO**: `POST /activities/plan` (esqueleto mensual → borradores por
  fecha×responsable, sin fines de semana), multi-responsable (`responsables[]`),
  `tipoTrabajo` = etapa constructiva, y `ActivityCalendar.tsx` (vista mensual).
- **`2026-06-18-rediseno-interfaces-operativas-design.md`** y su plan en
  `docs/superpowers/plans/`: rediseño de interfaces operativas (parcialmente aplicado).

### Estado del checklist de la reunión (§3 y §6)
El checklist operativo (planificación/charlas/firmas/alertas) se trabajó por
secciones. **§3 (firmas: cierre, rezagados, atraso) y §6 (semáforo, vencidas,
pendientes, ausencias, alertas programadas) están implementados** — ver §4.9.
El **versionado de documentos (§4)** ya está implementado para procedimientos:
nueva versión con re-firma obligatoria y notificación automática a la línea de
mando (ver §4.6.1). Pendientes conocidos fuera de §3/§6: fix responsivo
de firma en vertical (§7), módulo "comando" y vínculo cargo↔actividad (§8),
exportar reportes del dashboard (§9), FAQ/tutoriales (§10), PITR y salida de SES
del sandbox (infra).

---

## 10. Cómo empezar a trabajar (para el siguiente modelo)

1. **¿Endpoints?** → `Backend/serverless.yml` (fuente de verdad).
2. **¿Reglas DS44 / cargos / EPP / kits?** → `Backend/lib/ds44.js`
   (y su espejo `Frontend/src/utils/ds44.ts`).
3. **¿Quién puede hacer qué?** → `Backend/lib/permissions.js`
   (y `Frontend/src/permissions.ts`), rutas en `Frontend/src/App.tsx`.
4. **¿Lógica de negocio?** → `Backend/lib/services/*.js`.
5. **¿Modelo de datos?** → `ARCHITECTURE.md` + tabla §8 de este doc.
6. **¿Una vista/flujo del usuario?** → `Frontend/src/pages/*.tsx` +
   `Frontend/src/api/*.api.ts`.
7. **Antes de tocar firmas o EPP:** leer §4.7 y §4.8 (restricciones legales/proceso).
```