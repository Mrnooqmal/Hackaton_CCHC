# DS44: Documentos, Registros y Fases del SGSST

## Contexto del Sistema

El sistema gestiona el cumplimiento del **Decreto Supremo N°44** (SGSST), organizado en el ciclo de Deming: **PLAN → DO → CHECK → ACT**. Actualmente el sistema va por la **Fase 2 (DO)**. Este documento define exactamente qué documentos y registros maneja el sistema, quién los crea, quién los firma, y cómo se relacionan con las entidades existentes (`Documents`, `SignatureRequests`, `Activities`, `Personas`).

---

## Resumen por Fase

| Fase | Ciclo Deming | Documentos en el sistema |
|---|---|---|
| PLAN | Planificar | 5 documentos base de la obra |
| DO | Hacer | 1 registro maestro + documentos de onboarding por trabajador |
| CHECK | Verificar | 1 informe de evaluación (solo >100 trab.) |
| ACT | Actuar | Mejora continua — fuera del scope actual |

---

## FASE 1 — PLAN (Planificar)

### Documentos obligatorios al crear/activar una obra

Estos 5 documentos son el **punto de partida de la obra**. Los crea el `jefe_obra` o el `prevencionista`. Son documentos de nivel obra, no de nivel trabajador.

| # | Documento | `tipo` en sistema | Art. DS44 | Firmantes |
|---|---|---|---|---|
| 1 | Política de SST | `POLITICA_SSO` | Art. 22 | Representante Legal (admin) |
| 2 | Matriz Legal aplicable | `DIAGNOSTICO_LEGAL` | — | Prevencionista (validación) |
| 3 | MIPER (Matriz de Identificación de Peligros y Evaluación de Riesgos) | `MIPER` | Art. 7 | Prevencionista + Jefe Obra |
| 4 | Programa de Trabajo Preventivo (PTP) | `PROCEDIMIENTO_TRABAJO` | Art. 8 | Representante Legal (admin) |
| 5 | Mapa de Riesgos + Reglamento Interno (RIHS/RIOHS) | `MAPA_RIESGOS` / `REGLAMENTO_INTERNO` | Art. 56-62 | Jefe Obra |

### Estado actual en el código

`Obra.js` ya tiene `DOCS_OBLIGATORIOS_POR_FASE` pero usa fases constructivas (`excavacion`, `obra_gruesa`, etc.) — esto es **incorrecto para el DS44**. Los documentos PLAN no dependen de la etapa de construcción, son obligatorios desde el inicio de la obra.

**Cambio requerido en `Backend/lib/models/Obra.js`:**

```js
// Reemplazar DOCS_OBLIGATORIOS_POR_FASE por estructura de fases DS44
const DOCS_OBLIGATORIOS_PLAN = [
  'POLITICA_SSO',
  'DIAGNOSTICO_LEGAL',
  'MIPER',
  'PROCEDIMIENTO_TRABAJO', // usado como PTP
  'MAPA_RIESGOS',
  'REGLAMENTO_INTERNO'
];

// Agregar campo en Obra para tracking de cumplimiento PLAN
// cumplimientoDS44: {
//   plan: { completado: false, documentosSubidos: [] },
//   do:   { completado: false, documentosSubidos: [] },
//   check: { completado: false, documentosSubidos: [] }
// }
```

### Lógica de cumplimiento PLAN

- Una obra tiene `estado_cumplimiento_plan: 'pendiente' | 'en_proceso' | 'completo'`
- Se calcula dinámicamente: cuántos de los 5 documentos PLAN tienen `estado: 'activo'` y `obraId` correcto
- El dashboard de la obra muestra un indicador de progreso PLAN (ej. "3/5 documentos")

---

## FASE 2 — DO (Hacer)

### 2A — Registro Maestro de Actividad Preventiva (Art. 72)

Es el **único documento formal de la fase DO** como tal. En la práctica, es el conjunto de todos los registros generados durante la operación.

| Documento | `tipo` | Quién lo gestiona | Aplica a |
|---|---|---|---|
| Registro de Actividad Preventiva | `REGISTRO_ACTIVIDAD` (nuevo tipo) | Prevencionista / Sistema automático | Toda la obra |

Este registro es el **respaldo agregado** — en el sistema equivale a poder exportar/listar todos los registros de la obra (capacitaciones, EPP, incidentes, etc.) para presentar a fiscalizadores.

**No requiere un formulario específico** — se genera automáticamente desde los registros existentes.

---

### 2B — Onboarding de Trabajador Nuevo (Checklist DS44)

Este es el **núcleo operativo de la fase DO** para el sistema. Cuando se agrega un trabajador a una obra, el sistema debe generar y gestionar los siguientes documentos/registros. Se excluyen explícitamente contrato de trabajo y cosas ajenas al DS44.

#### Documentos que SÍ maneja el sistema al vincular un trabajador a una obra:

| # | Registro DS44 | Mecanismo en sistema | `tipo` documento | Firmantes | Obligatorio |
|---|---|---|---|---|---|
| 1 | **IRL — Información de Riesgos Laborales** (ex-ODI) | Documento asignado al trabajador para firmar | `IRL` | Trabajador (firma) + Prevencionista (crea) | Sí, Art. 15 |
| 2 | **Capacitación SST 8 horas** | `SignatureRequest` tipo `CAPACITACION` + registro de asistencia | `CAPACITACION` | Todos los trabajadores de la obra + Relator (prevencionista/supervisor) | Sí, Art. 16 |
| 3 | **Entrega RIHS/RIOHS** (Reglamento Interno) | Documento asignado al trabajador para firmar | `REGLAMENTO_INTERNO` | Trabajador (firma de recepción) | Sí, Art. 56 |
| 4 | **Entrega y Capacitación EPP** | `SignatureRequest` tipo `ENTREGA_EPP` | `ENTREGA_EPP` | Trabajador + Prevencionista/Supervisor | Sí, Art. 13 |
| 5 | **Procedimientos de Trabajo Seguro aplicables** | Documento asignado al trabajador | `PROCEDIMIENTO_TRABAJO` | Trabajador (firma recepción) | Sí, Art. 10 |
| 6 | **Inducción Plan de Emergencia** | `SignatureRequest` tipo `INDUCCION` | — | Trabajador | Sí, Art. 19 |
| 7 | **Vigilancia de salud** (si aplica) | Registro en perfil del trabajador — campo en `Persona` | — | Sistema (registro administrativo) | Condicional, Art. 67 |
| 8 | **Exámenes ocupacionales** (si aplica) | Registro en perfil del trabajador | — | Sistema (registro administrativo) | Condicional, Art. 68 |

#### Lo que NO maneja el sistema:
- Contrato de trabajo (es RRHH, no DS44)
- Descriptor de cargo (es RRHH)
- Registro de obra/faena/área (ya está en `obraIds` de `Persona`)

---

### 2C — Documentos Operacionales Recurrentes (durante la relación laboral)

Estos son documentos que se generan **continuamente** durante la operación de la obra, no solo al ingreso:

| Registro | Mecanismo en sistema | `tipo` / módulo | Quién crea | Quién firma |
|---|---|---|---|---|
| Charlas operacionales (5 min) | `SignatureRequest` tipo `CHARLA_5MIN` | `CHARLA_5MIN` | Supervisor | Todos los presentes |
| AST / ART (Análisis de Riesgo en Terreno) | `SignatureRequest` tipo `ART` | `ART` | Supervisor | Trabajadores involucrados |
| Capacitaciones periódicas (≤2 años) | `Activity` + `SignatureRequest` tipo `CAPACITACION` | `CAPACITACION` | Prevencionista | Asistentes + Relator |
| Investigación de accidentes/incidentes | Módulo `Incidents` | — | Prevencionista | Prevencionista + Supervisor |
| Inspecciones de seguridad | `SignatureRequest` tipo `INSPECCION` | `INSPECCION` | Prevencionista / Supervisor | Supervisor o Prevencionista |
| Simulacros anuales (plan emergencia) | `Activity` + registro de participación | — | Prevencionista | Lista asistencia |
| Estadísticas accidentabilidad | KPI en dashboard — calculado automáticamente | — | Sistema | — |

---

### 2D — Eventos Sobrevinientes (se activan ante un hecho concreto)

| Evento | Mecanismo | Quién actúa |
|---|---|---|
| Riesgo grave e inminente | Alerta en sistema + registro en `Incidents` | Supervisor / Prevencionista |
| Accidente de trabajo / EP | Módulo `Incidents` con investigación árbol de causas | Prevencionista |
| Traslado de puesto por EP | Registro en perfil `Persona` — campo `restriccionLaboral` | Jefe Obra |

---

## FASE 3 — CHECK (Verificar)

### Documento único

| Documento | Condición | Quién lo elabora | En sistema |
|---|---|---|---|
| Informe Anual de Gestión Preventiva | Solo obras/empresas con Depto. de Prevención (>100 trabajadores) | Prevencionista con rol experto | Exportable desde el sistema — consolidación de todos los registros DO |

Para el sistema, el CHECK se implementa como:

1. **Evaluación anual** — un formulario/checklist que el prevencionista completa una vez al año revisando el cumplimiento del PTP
2. **Fuentes de evidencia** — el sistema debe mostrar y permitir consolidar:
   - % cumplimiento PTP (medidas ejecutadas vs planificadas)
   - Tasa de accidentabilidad, frecuencia y gravedad
   - Resultados de capacitaciones (% personal capacitado)
   - Investigaciones cerradas vs abiertas
   - Medidas prescritas por OAL pendientes

---

## Cambios Requeridos en el Backend

### 1. `Backend/handlers/documents/handler.js` — Agregar tipos faltantes

```js
const DOCUMENT_TYPES = {
  // Existentes (mantener)
  IRL: 'Informe de Riesgos Laborales',
  DIAGNOSTICO_LEGAL: 'Diagnóstico de aspectos legales',
  POLITICA_SSO: 'Política de Seguridad y Salud Ocupacional',
  REGLAMENTO_INTERNO: 'Reglamento Interno',
  PROCEDIMIENTO_TRABAJO: 'Procedimiento de Trabajo Seguro',
  MIPER: 'Matriz de Identificación de Peligros y Evaluación de Riesgos',
  ENTREGA_EPP: 'Entrega de EPP',
  CAPACITACION: 'Registro de Capacitación',
  MAPA_RIESGOS: 'Mapa de Riesgos',
  TEST_EVALUACION: 'Test de Evaluación',

  // Nuevos
  REGISTRO_ACTIVIDAD: 'Registro de Actividad Preventiva (Art. 72)',  // ← DO maestro
  INDUCCION_EMERGENCIA: 'Inducción Plan de Emergencia',              // ← onboarding
  VIGILANCIA_SALUD: 'Registro de Vigilancia de Salud',               // ← condicional
  EXAMEN_OCUPACIONAL: 'Registro de Examen Ocupacional',              // ← condicional
  INVESTIGACION_ACCIDENTE: 'Investigación de Accidente / EP',        // ← evento
  RESTRICCION_LABORAL: 'Restricción o Traslado por EP',              // ← evento
};
```

### 2. `Backend/lib/models/Persona.js` — Campos para vigilancia de salud

Agregar campos opcionales al modelo `Persona` para tracking de salud ocupacional:

```js
// En constructor de Persona, agregar:
this.vigilanciaSalud = data.vigilanciaSalud || {
  enVigilancia: false,
  protocolos: [],            // ej. ['PREXOR', 'TMERT']
  fechaUltimoExamen: null,
  aptitudLaboral: null,      // 'apto' | 'apto_con_restricciones' | 'no_apto'
  restricciones: []
};
```

### 3. `Backend/lib/models/Obra.js` — Tracking de cumplimiento DS44

```js
// Reemplazar fasesConfig (fases constructivas) por cumplimientoDS44
// O agregar cumplimientoDS44 como campo separado

this.cumplimientoDS44 = data.cumplimientoDS44 || {
  plan: {
    documentosRequeridos: ['POLITICA_SSO', 'DIAGNOSTICO_LEGAL', 'MIPER', 'PROCEDIMIENTO_TRABAJO', 'MAPA_RIESGOS', 'REGLAMENTO_INTERNO'],
    documentosSubidos: [],    // se calcula dinámicamente desde Documents
    completado: false
  },
  do: {
    activo: true,
    registrosMaestros: []     // IDs de documentos tipo REGISTRO_ACTIVIDAD
  },
  check: {
    ultimaEvaluacion: null,
    resultados: null
  }
};
```

---

## Flujo de Onboarding de Trabajador — Lógica del Sistema

Cuando `jefe_obra` o `prevencionista` agrega un trabajador a una obra (`POST /personas/:id/obras`), el sistema debe:

```
1. Vincular obraId al trabajador (ya existe en Persona.obraIds)

2. Generar automáticamente las siguientes tareas pendientes:
   a. Asignar documento IRL al trabajador (tipo: IRL, estado: pendiente firma)
   b. Asignar documento RIHS/RIOHS al trabajador (tipo: REGLAMENTO_INTERNO)
   c. Asignar documentos de Procedimientos aplicables según cargo/área
   d. Crear SignatureRequest tipo ENTREGA_EPP para el trabajador
   e. Crear SignatureRequest tipo INDUCCION para inducción de emergencia
   
3. Notificar al trabajador vía inbox de sus documentos pendientes

4. El trabajador ve en su sidebar:
   "Documentos pendientes de firma: X"
   (se van tachando conforme firma)

5. El prevencionista/jefe_obra ve en el perfil del trabajador:
   Checklist de onboarding DS44 con % de completitud
```

---

## Checklist de Onboarding — Vista en el Sistema

El sistema debe mostrar en el perfil de cada trabajador dentro de una obra un **checklist de cumplimiento DS44**:

```
Trabajador: Juan Pérez — Obra: Torre Costanera
─────────────────────────────────────────────
✅ IRL firmado                    (Art. 15)
✅ RIHS/RIOHS recibido y firmado  (Art. 56)
⏳ Capacitación SST 8h            (Art. 16) — pendiente
⏳ Entrega EPP firmada            (Art. 13) — pendiente
✅ Procedimientos de trabajo      (Art. 10)
✅ Inducción de emergencia        (Art. 19)
— Vigilancia de salud            (Art. 67) — no aplica
─────────────────────────────────────────────
Cumplimiento: 4/6 documentos obligatorios (67%)
```

Este porcentaje alimenta el KPI de cumplimiento de la obra en el Dashboard.

---

## Matriz de Firmantes por Documento

| Documento | Trabajador | Prevencionista | Supervisor | Jefe Obra | Admin |
|---|---|---|---|---|---|
| IRL | ✅ firma recepción | ✅ crea y firma | — | — | — |
| Capacitación 8h | ✅ firma asistencia | ✅ firma relator | puede relatar | — | — |
| RIHS/RIOHS | ✅ firma recepción | — | — | ✅ entrega | ✅ firma doc |
| Entrega EPP | ✅ firma recepción | ✅ crea | ✅ puede entregar | — | — |
| Procedimientos | ✅ firma recepción | ✅ crea | — | — | — |
| Inducción emergencia | ✅ firma asistencia | — | ✅ puede dictar | — | — |
| Charla 5 min | ✅ firma asistencia | — | ✅ crea y firma | — | — |
| ART | ✅ firma | — | ✅ crea y firma | — | — |
| MIPER | — | ✅ crea y firma | — | ✅ firma | — |
| Política SST | — | — | — | — | ✅ firma (RL) |
| PTP | — | ✅ elabora | — | ✅ valida | ✅ aprueba |

---

## Resumen de Archivos a Modificar

| Archivo | Cambio |
|---|---|
| `Backend/handlers/documents/handler.js` | Agregar tipos: `REGISTRO_ACTIVIDAD`, `INDUCCION_EMERGENCIA`, `VIGILANCIA_SALUD`, `EXAMEN_OCUPACIONAL`, `INVESTIGACION_ACCIDENTE`, `RESTRICCION_LABORAL` |
| `Backend/lib/models/Obra.js` | Agregar `cumplimientoDS44` con tracking de fases PLAN/DO/CHECK; separar de fases constructivas |
| `Backend/lib/models/Persona.js` | Agregar campo `vigilanciaSalud` con protocolos, aptitud y restricciones |
| `Backend/handlers/personas-module/handler.js` | Al vincular persona a obra, disparar creación automática de documentos de onboarding |
| `Frontend/src/pages/` | Nueva vista de checklist DS44 en perfil de trabajador dentro de obra |

## Lo que NO cambia

- Módulo `Incidents` — ya cubre investigación de accidentes
- Módulo `SignatureRequests` — ya tiene los tipos necesarios (`CHARLA_5MIN`, `CAPACITACION`, `INDUCCION`, `ENTREGA_EPP`, `ART`, `PROCEDIMIENTO`, `INSPECCION`, `REGLAMENTO`)
- Módulo `Activities` — ya cubre capacitaciones y simulacros
- Módulo `Inbox` — ya gestiona notificaciones a trabajadores
- Firma electrónica — ya funciona correctamente
