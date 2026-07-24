# Prompt de ejecución — Fable: Planificación mensual + calendario de actividades

> **Para el modelo Fable 5 (`claude-fable-5`).** Este prompt te dice qué construir.
> El diseño completo (problema, decisiones ya cerradas, modelo de datos, trazabilidad)
> está en el documento hermano; **léelo entero antes de escribir código.**

## Rol
Eres un ingeniero full-stack trabajando en **Build & Serve**, una plataforma SaaS
multi-tenant real (en producción) para gestión de Seguridad y Salud en el Trabajo
(SST) en obras de construcción chilenas (cumplimiento DS 44), para la CChC.
Prioriza **solidez**: validación en backend, retrocompatibilidad y código que
calce con el estilo existente.

## Antes de empezar (lectura obligatoria)
1. `docs/CONTEXT.md` — contexto técnico global (stack, dominio, reglas). Lee sobre
   todo §3 (archivos espejo), §4.5 (obra/fases), §4.7 (firmas: no tocar), §5–§7.
2. `docs/superpowers/specs/2026-07-23-planificacion-mensual-calendario-actividades-design.md`
   — el **diseño de esta tarea** (decisiones ya tomadas; no las re-litigues).
3. `docs/superpowers/specs/2026-07-23-planificacion-diaria-charlas-design.md` —
   spec relacionado (contenido de la charla). Debes **unificar** con él el endpoint
   `PATCH /activities/{id}` y el modelo, sin duplicar. Si aún no está implementado,
   deja el `PATCH` preparado para absorber sus campos (`planificacion`, `permisosTrabajo`).

## Qué construir
Una capa de **planificación mensual** de actividades con **vista de calendario**.
El prevencionista/jefe de obra arma un **esqueleto** (por tipo y periodicidad) que
genera actividades reales en estado `borrador`, una por día (excluyendo fines de
semana), asignables a varios supervisores filtrando por tipo de trabajo. El
supervisor solo **rellena** el borrador (o crea actividades ad-hoc). Todo se
visualiza en un **calendario mensual**.

## Decisiones ya cerradas (NO cambiar)
- **Enfoque A**: se generan actividades reales en estado `borrador` (no una entidad
  plantilla separada).
- **`tipoTrabajo`** = etapa constructiva de la obra (`obra_gruesa`, `terminaciones`,
  etc.). Sin catálogo nuevo.
- **Feriados: ignorar.** Solo excluir **sábado (getDay()===6)** y **domingo (===0)**.
- **Multi-responsable**: campo `responsables[]`; `relatorId` = `responsables[0]`
  (retrocompatibilidad con firmas/attendance).
- Todos los campos nuevos son **opcionales y retrocompatibles**.

## Archivos a tocar
**Backend**
- `Backend/handlers/activities/handler.js`:
  - `generarFechasRecurrencia(...)`: agregar flag `excluirFinDeSemana` (default true
    para planes) que salta sáb/dom.
  - Nuevo export `plan` → `POST /activities/plan` (genera borradores; ver §5.2 del diseño).
  - Nuevo export `patch` → `PATCH /activities/{id}` (completar/editar acotado; ver §5.3).
  - `list`: filtros nuevos `estado=borrador`, `planId`, `responsableId`,
    `tipoTrabajo`, `fechaDesde`/`fechaHasta` (ver §5.4).
  - Añadir `estado: 'borrador'`, `origen`, `responsables`, `tipoTrabajo`, `planId`,
    `camposPrellenados` al modelo que escribe `create`/`plan`.
- `Backend/serverless.yml`: registrar las funciones `plan` (POST /activities/plan)
  y `patch` (PATCH /activities/{id}).
- `Backend/lib/permissions.js`: agregar `ACTIVIDADES_PLANIFICAR`; añadir
  `ACTIVIDADES_CREAR` al preset **supervisor**; `ACTIVIDADES_PLANIFICAR` a
  **prevencionista** y **jefe_obra**.

**Frontend**
- `Frontend/src/permissions.ts`: **espejo** del cambio de permisos (obligatorio).
- `Frontend/src/api/activities.api.ts`: `plan()`, `patch()`, tipos nuevos y filtros;
  fix: agregar `REUNION_COMITE` y `SIMULACRO` donde falten en el frontend.
- `Frontend/src/components/ActivityCalendar.tsx` (**nuevo**): calendario mensual,
  fines de semana atenuados, chips por tipo/estado, navegación de mes, callbacks de
  click en día/chip.
- `Frontend/src/pages/Activities.tsx`: toggle **Lista/Calendario**; integrar el
  calendario; constructor de esqueleto (para `ACTIVIDADES_PLANIFICAR`); crear ad-hoc
  desde día vacío; completar borrador (PATCH).

## Orden de ejecución sugerido
1. Backend: `generarFechasRecurrencia` + exclusión de fin de semana (con unit test).
2. Backend: endpoint `plan` (+ validación, idempotencia, filtrado por `tipoTrabajo`).
3. Backend: endpoint `patch` (+ autorización y campos permitidos) y filtros de `list`.
4. `serverless.yml`: rutas nuevas.
5. Permisos: `permissions.js` **y** `permissions.ts` (espejo).
6. Frontend API + tipos + fix de tipos de actividad.
7. `ActivityCalendar.tsx` + toggle en `Activities.tsx`.
8. Constructor de esqueleto + completar borrador + crear ad-hoc.
9. `tsc --noEmit`, pruebas de backend y verificación manual del flujo.

## Restricciones (no romper)
- **NO hagas ningún commit ni push sin permiso explícito del usuario.** Deja los
  cambios en el working tree y avisa; el usuario decide cuándo commitear.
- **`tenantId` siempre del JWT, nunca del body.**
- **Mantener sincronizados** `permissions.js` ↔ `permissions.ts`.
- **No tocar** `FirmaService` ni los `asistentes`/`firmaRelator` ya firmados
  (auditoría inmutable; consulta legal del PIN pendiente).
- Retrocompatibilidad: actividades antiguas sin los campos nuevos deben listarse y
  verse en el calendario sin errores (render/validación defensivos).
- Todo en **español** (chileno, formal). Sin placeholders; contenido real.

## Criterios de aceptación
- El prevencionista arma un esqueleto (ej. "Charla diaria" + "Inspección de andamio
  semanal") sobre un rango de fechas y se generan borradores **sin sábados ni
  domingos**, uno por día, asignados solo a los supervisores que corresponden por
  `tipoTrabajo`.
- Cada borrador es **editable de forma independiente** (no comparten detalle).
- El supervisor puede **completar** un borrador (→ `programada`) y **crear** una
  actividad ad-hoc en un día vacío.
- El **calendario mensual** muestra todo por día, con fines de semana atenuados y
  distinción visual de borrador vs. programada/completada.
- Los 9 requisitos del §8 del diseño quedan cubiertos.
- `tsc --noEmit` pasa; retrocompatibilidad verificada.
