# Planificación mensual + calendario visual de actividades — Diseño

**Fecha:** 2026-07-23
**Estado:** Aprobado por el usuario · pendiente de implementar
**Autor del diseño:** Claude (Opus 4.8) · **Implementa:** Fable 5 (`claude-fable-5`)
**Contexto:** Producto real en producción para la CChC (no prototipo). Priorizar
solidez: validación en backend, retrocompatibilidad total (actividades antiguas
sin los campos nuevos deben seguir funcionando), catálogos/enums claros.

> **Lee primero** `docs/CONTEXT.md` (contexto técnico global del proyecto) y este
> spec completo antes de tocar código. El prompt de ejecución está en
> `docs/superpowers/specs/2026-07-23-planificacion-mensual-calendario-actividades-prompt.md`.

---

## 1. Problema

La planificación de actividades preventivas (charlas diarias, ART, inspecciones,
etc.) hoy es rígida y repetitiva:

1. **La recurrencia clona la misma actividad todos los días.** El supervisor no
   puede tener una actividad distinta por día; la serie repite título, relator y
   detalle idénticos.
2. **No hay un esqueleto/calendario mensual.** El supervisor debe crear cada
   actividad desde cero en lugar de solo rellenar un plan ya armado.
3. **No se distingue el tipo de trabajo real** del supervisor (obra gruesa,
   terminaciones, etc.): a todos se les asigna lo mismo todo el mes.
4. **El prevencionista no puede armar un esqueleto** por tipo de actividad y
   periodicidad (planificación diaria, inspección de andamio semanal, etc.).
5. **El supervisor no puede crear sus propias actividades** ad-hoc cuando trabaja
   solo o tiene tareas adicionales (hoy no tiene el permiso `actividades.crear`).
6. **No se puede delegar la generación de actividades** a otros roles (ej.
   representantes del Comité Paritario).
7. **La generación no excluye sábados y domingos**, ensuciando el plan con días no
   laborables.
8. **No se puede asignar un plan a varios supervisores a la vez** filtrando solo a
   quienes corresponde una actividad específica (ej. solo quienes inspeccionan
   andamios).
9. **Falta una vista de calendario** que haga visual la coordinación mensual.

## 2. Estado actual (auditoría 2026-07-23)

Archivos involucrados:

- **Backend:** `Backend/handlers/activities/handler.js` (456 líneas). Exporta
  `create`, `list`, `get`, `registerAttendance`, `getStats`.
  - `ACTIVITY_TYPES`: `CHARLA_5MIN`, `ART`, `CAPACITACION`, `INDUCCION`,
    `REUNION_COMITE`, `SIMULACRO`, `INSPECCION`.
  - `CAPACITACION_SUBTIPOS`: subtipos DS44 de capacitación.
  - `generarFechasRecurrencia(inicio, hasta, frecuencia)`: genera fechas por
    `unica|diaria|semanal|mensual`. **No excluye fin de semana.** Tope
    `MAX_OCURRENCIAS = 180`.
  - `create`: genera N ocurrencias **idénticas** (mismo título/relator/detalle)
    unidas por `serieId`; `relatorId` es **único**; `asistentesRequeridos` es lista;
    `estado` ∈ `programada|en_curso|completada|cancelada`.
  - `list`: filtra por `tenantId, obraId, tipo, estado, fecha, relatorId` (Scan con
    FilterExpression; tabla `ACTIVITIES_TABLE`, PK `activityId`, GSI `tenantId-index`).
- **Frontend:** `Frontend/src/pages/Activities.tsx` (1131 líneas). Vistas: hoy,
  historial (fecha < hoy), próximas (fecha > hoy). `FRECUENCIA_OPCIONES`,
  `emptyActivity`, `handleCreateActivity`. Ya importa `FiCalendar`.
  `Frontend/src/api/activities.api.ts`: tipos `Activity`, `CreateActivityData`,
  `ActivityListParams`, `activitiesApi.{list,get,create,registerAttendance,getStats}`.
- **Permisos:** `Backend/lib/permissions.js` (espejo `Frontend/src/permissions.ts`).
  `ACTIVIDADES_VER`, `ACTIVIDADES_CREAR`. **Supervisor** hoy solo tiene
  `actividades.ver`; `admin`, `jefe_obra`, `prevencionista` tienen `crear`.
- **Rutas backend:** `Backend/serverless.yml` — funciones `activities.*` con
  `GET /activities`, `POST /activities`, `GET /activities/{id}`,
  `POST /activities/{id}/attendance`, `GET /activities/stats`.
- **Etapas constructivas de la obra** (reutilizables como "tipo de trabajo"):
  `excavacion`, `obra_gruesa`, `terminaciones`, `entrega` (ver `ObraService`,
  `Obra.fasesConfig`, `docs/CONTEXT.md` §4.5).

**Dependencia:** existe el spec aprobado `2026-07-23-planificacion-diaria-charlas-design.md`
que agrega el *contenido* de la charla (bloque `planificacion`, `permisosTrabajo`,
catálogos y un `PATCH /activities/{id}`). **Este spec es la capa de
PLANIFICACIÓN/CALENDARIO que se apoya encima.** El `PATCH /activities/{id}` se
**unifica** entre ambos (ver §5).

## 3. Decisiones tomadas (cerradas)

| Tema | Decisión |
|---|---|
| Cómo materializar el esqueleto | **Enfoque A: pre-generar actividades reales en estado `borrador`.** El plan crea actividades reales editables una por día; el supervisor solo las completa. Reusa list/attendance/firmas existentes. NO se crea entidad "plantilla" separada. |
| "No repetir el detalle" | Cada ocurrencia generada es un **borrador independiente y editable**; no comparten contenido, solo `planId`. |
| Tipo de trabajo del supervisor | **Reutilizar las etapas constructivas de la Obra** (`obra_gruesa`, `terminaciones`, etc.) como dimensión `tipoTrabajo`. Sin catálogo nuevo. |
| Feriados | **Ignorados.** Solo se excluyen **sábado y domingo**. (Sin API de feriados, sin campo de feriados.) |
| Asignación múltiple | La actividad admite **varios responsables** (`responsables[]`); `relatorId` se conserva = primer responsable (retrocompatibilidad). |
| Filtrado por corresponsalía | Al generar el plan se filtra qué responsables reciben cada ítem según `tipoTrabajo` (y opcionalmente cargo/rol). |
| Supervisor crea ad-hoc | Se le concede `ACTIVIDADES_CREAR`; sus actividades llevan `origen: 'ad_hoc'`. |
| Delegar generación | Nuevo permiso `ACTIVIDADES_PLANIFICAR`, asignable por tenant desde Mi Empresa → Roles (ej. Comité Paritario). |
| Vista calendario | **Nueva vista de calendario mensual** en el frontend (componente nuevo + toggle Lista/Calendario en Activities). |
| `PATCH /activities/{id}` | Se **unifica** con el del spec de charlas: un solo endpoint acotado para completar/editar. |

## 4. Diseño de datos (cambios en la actividad)

Todos los campos son **opcionales y retrocompatibles** (render y validación
defensivos; actividades antiguas no los tienen):

```js
{
  // ... campos actuales (tipo, titulo, relatorId, fecha, asistentesRequeridos, ...)

  estado: 'borrador' | 'programada' | 'en_curso' | 'completada' | 'cancelada',
  // 'borrador' = planificada por el esqueleto, aún sin completar por el supervisor.

  origen: 'planificacion' | 'ad_hoc' | null,
  // 'planificacion' = generada por POST /activities/plan; 'ad_hoc' = creada suelta.

  responsables: string[],       // personaId de los responsables (multi-asignación).
  // relatorId se mantiene = responsables[0] para compatibilidad con firmas/attendance.

  tipoTrabajo: string | null,   // etapa constructiva: 'obra_gruesa' | 'terminaciones' | ...

  planId: string | null,        // agrupa las ocurrencias generadas por un mismo esqueleto.
  // Distinto de serieId (que era la repetición idéntica; ya no se usa para planes).

  camposPrellenados: string[],  // nombres de campos que vienen del esqueleto (para UI).
}
```

## 5. Backend — cambios

### 5.1 Exclusión de fin de semana
`generarFechasRecurrencia` recibe un flag `excluirFinDeSemana` (default **true**
en la generación de planes): al iterar, **omite** fechas cuyo `getDay()` sea 0
(domingo) o 6 (sábado). No toca la creación individual (`unica`) existente salvo
que se pida.

### 5.2 Nuevo endpoint `POST /activities/plan` — generar esqueleto
Recibe un **esqueleto** y genera actividades `borrador`:

```js
// body
{
  obraId: string,
  rangoDesde: 'YYYY-MM-DD',
  rangoHasta: 'YYYY-MM-DD',       // tope defensivo: MAX_OCURRENCIAS por ítem
  items: [{
    tipo: 'CHARLA_5MIN' | 'ART' | 'INSPECCION' | ...,   // de ACTIVITY_TYPES
    subtipo?: string,                                   // si CAPACITACION
    periodicidad: 'diaria' | 'semanal' | 'mensual',
    tipoTrabajo?: string,                               // etapa constructiva
    responsables: string[],                             // personaId (varios supervisores)
    tituloBase?: string,
    camposPrellenados?: object,                         // defaults por día (ubicación, hora, etc.)
  }]
}
```

Lógica:
- Por cada ítem, generar fechas con `generarFechasRecurrencia(..., excluirFinDeSemana=true)`.
- **Filtrado por corresponsalía:** un ítem se genera solo para los `responsables`
  que correspondan a ese `tipoTrabajo` (si el responsable tiene un `tipoTrabajo`
  incompatible, se excluye). Documentar la regla exacta en el código.
- Crear una actividad `borrador` por (fecha × responsable-que-corresponde), con
  `origen: 'planificacion'`, `planId` compartido, `camposPrellenados` marcados.
- **Idempotencia:** no duplicar si ya existe un borrador del mismo `planId`+fecha+
  responsable+tipo.
- Validar: `obraId` existe, `tipo`/`subtipo` válidos, `responsables` son personas
  del tenant, periodicidad válida, rango razonable. Errores → 400 con mensaje claro.
- Respuesta: `{ planId, count, activities: [...] }`.

### 5.3 Nuevo endpoint `PATCH /activities/{id}` — completar/editar (unificado)
- El supervisor completa un `borrador` → pasa a `programada`.
- Campos editables: contenido de la actividad (título, descripción, ubicación,
  hora, `asistentesRequeridos`) **y**, cuando se implemente el spec de charlas, el
  bloque `planificacion` y `permisosTrabajo`. **Nunca** `asistentes` firmados ni
  `firmaRelator` (auditoría intocable).
- Autorización: un responsable de la actividad, o quien tenga `ACTIVIDADES_CREAR`,
  del mismo tenant. Actualiza `updatedAt`.

### 5.4 `list`
- Soportar filtros nuevos: `estado=borrador`, `planId`, `responsableId` (busca en
  `responsables[]` con `relatorId` como fallback), `tipoTrabajo`, y rango
  `fechaDesde`/`fechaHasta` (para cargar el mes del calendario de una sola vez).

### 5.5 `serverless.yml`
Agregar las funciones `plan` (`POST /activities/plan`) y `patch`
(`PATCH /activities/{id}`) al módulo activities.

## 6. Frontend — calendario y flujos

### 6.1 Vista de calendario mensual (núcleo visual)
- **Nuevo componente** `Frontend/src/components/ActivityCalendar.tsx`: grilla
  mensual (semana de lun–vie destacada, **sábado/domingo atenuados** como no
  laborables), navegación mes anterior/siguiente, y por cada día los "chips" de
  actividades (color por tipo, ya existe el mapa de colores en `Activities.tsx`).
  Distinguir visualmente `borrador` vs. `programada`/`completada`.
- **Toggle Lista / Calendario** en `Frontend/src/pages/Activities.tsx` (reusar
  `FiCalendar`). Cargar el mes con `list({ obraId, fechaDesde, fechaHasta })`.
- **Interacción:**
  - Click en un chip → abre detalle o el modal "Completar registro" (si es
    borrador y el usuario es responsable / tiene permiso).
  - Click en un día vacío (con `ACTIVIDADES_CREAR`) → crear actividad ad-hoc
    (`origen: 'ad_hoc'`) pre-cargando la fecha.
  - Filtros existentes (tipo) + nuevos (responsable, `tipoTrabajo`, estado).

### 6.2 Constructor de esqueleto (planificación mensual)
- Visible para roles con `ACTIVIDADES_PLANIFICAR`. UI para definir la lista de
  `items` (`tipo`, `periodicidad`, `tipoTrabajo`, `responsables`, defaults) y un
  rango de fechas → `POST /activities/plan`.
- **Selección múltiple de supervisores** con filtro por `tipoTrabajo` (punto 8):
  al elegir un ítem de un `tipoTrabajo`, solo se ofrecen/aplican los supervisores
  que correspondan.
- Al generar, refrescar el calendario mostrando los borradores creados.

### 6.3 Completar borrador (supervisor)
- Desde el calendario/lista, abrir un borrador y rellenar lo faltante → `PATCH`
  → pasa a `programada`. Coordinar con el formulario de `planificacion`/permisos
  del spec de charlas cuando esté.

### 6.4 API (`activities.api.ts`)
- Agregar `plan(payload)`, `patch(id, payload)`; extender tipos con `origen`,
  `responsables`, `tipoTrabajo`, `planId`, `camposPrellenados`, `estado: 'borrador'`,
  y los filtros nuevos de `list`.
- **Fix incluido:** agregar `REUNION_COMITE` y `SIMULACRO` al `ACTIVITY_TYPES` del
  frontend (ya soportados por el backend, faltan en el selector).

## 7. Permisos

`Backend/lib/permissions.js` **y** su espejo `Frontend/src/permissions.ts`
(mantener sincronizados — ver `docs/CONTEXT.md` §3):

- Agregar `ACTIVIDADES_PLANIFICAR: 'actividades.planificar'`.
- Preset **supervisor**: agregar `ACTIVIDADES_CREAR` (puede crear ad-hoc).
- Presets **prevencionista** y **jefe_obra**: agregar `ACTIVIDADES_PLANIFICAR`.
- `admin` obtiene todo automáticamente.
- Punto 6 (delegar a Comité Paritario): al ser permisos editables por tenant, el
  admin puede asignar `ACTIVIDADES_CREAR`/`ACTIVIDADES_PLANIFICAR` a cualquier rol
  desde Mi Empresa → Roles. No requiere código extra más allá de exponer el permiso.

## 8. Trazabilidad requisito → solución

| Requisito | Solución |
|---|---|
| No copiar el detalle cada día | Borradores independientes por día (§3, §5.2) |
| Calendario/esqueleto mensual para solo rellenar | `POST /activities/plan` + calendario (§5.2, §6.1, §6.2) |
| Campos pre-llenados/automáticos | `camposPrellenados` + defaults del esqueleto (§4, §6.2) |
| Diferenciar por tipo de trabajo | `tipoTrabajo` = etapa constructiva (§3, §4, §5.2) |
| Prevencionista arma esqueleto por tipo + periodicidad | Constructor + `ACTIVIDADES_PLANIFICAR` (§5.2, §6.2, §7) |
| Supervisor crea sus propias actividades | `ACTIVIDADES_CREAR` a supervisor + `origen: ad_hoc` (§4, §6.1, §7) |
| Delegar generación a otros (Comité Paritario) | Permiso asignable por tenant (§7) |
| Excluir sábados/domingos | `excluirFinDeSemana` (§5.1) + días atenuados en UI (§6.1) |
| Asignar a varios supervisores filtrando corresponsalía | `responsables[]` + filtro por `tipoTrabajo` (§4, §5.2, §6.2) |
| Calendario visual | `ActivityCalendar.tsx` + toggle (§6.1) |

## 9. Fuera de alcance (esta fase)

- Feriados (se ignoran; solo fin de semana).
- Generación de PDF en backend (el reporte se imprime desde el navegador, según el
  spec de charlas).
- Drag & drop de actividades en el calendario (mover de día). Fase 2.
- Catálogo propio de "tipo de trabajo" (se reutiliza la etapa constructiva).
- Notificaciones nuevas más allá del `activity.created`/inbox ya existente.

## 10. Testing y aceptación

- **Backend:** unit tests de `generarFechasRecurrencia` con exclusión de fin de
  semana; validación de `POST /activities/plan` (tipos/personas inválidas → 400,
  idempotencia, filtrado por `tipoTrabajo`); autorización y campos permitidos del
  `PATCH`.
- **Frontend:** `tsc --noEmit`; verificación manual del flujo: prevencionista arma
  esqueleto → calendario muestra borradores (sin fines de semana) → supervisor
  completa un día → pasa a programada; supervisor crea ad-hoc en un día vacío.
- **Retrocompatibilidad:** actividades antiguas sin los campos nuevos se listan y
  se ven en el calendario sin errores.

## 11. Restricciones (no romper)

- **`tenantId` siempre del JWT, nunca del body** (regla transversal).
- **Archivos espejo** front/back: `permissions.js ↔ permissions.ts`. Sincronizar.
- **No tocar** la lógica de firmas (`FirmaService`) ni los `asistentes`/`firmaRelator`
  ya firmados (auditoría — ver `docs/CONTEXT.md` §4.7, consulta legal del PIN).
- Todo en **español** (chileno, formal). Cero placeholders.
