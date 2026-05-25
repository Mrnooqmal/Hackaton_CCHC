# DS44 Integration Checkpoint

## Status Summary
- Work completed:
  - Compact, expandable document lists implemented in frontend (`src/pages/Documents.tsx`, `src/pages/DocumentsRepository.tsx`, `src/css/App.css`).
  - DS44 phase pill added to `ObraProgressCard` and DS44 phase label exposed to Dashboard.
  - Auto-advance from PLAN → HACER implemented client-side in `ObraDetalle.tsx` with one-shot guard to avoid repeated POSTs.
  - Backend models extended: `Obra.cumplimientoDS44` tracking started, DS44 document types added to documents handler, `Persona.vigilanciaSalud` fields added, and `signatureRequests` persist `obraId`.
  - WorkerDetail checklist view added.

## Checkpoint Goal
Reach a stable integration checkpoint where:
- PLAN documents are tracked and Progress shows correct percentages per-phase.
- Auto-advance triggers once when PLAN reaches 100% and backend records the new `faseDeming`.
- Assigning a worker to an obra automatically creates required onboarding artifacts (documents and signature requests).
- Dashboard reflects the active DS44 phase progress for each obra.

## Remaining Tasks (detailed)

### 1) Backend: Complete onboarding artifact creation (HIGH)
- Implement creation of required documents and signature requests when a `Persona` is linked to an `Obra`.
  - Hook location: `Backend/handlers/personas-module/handler.js` (on `PUT /personas/{id}` or `POST /personas`).
  - Items to create:
    - Documents: `INDUCCION_EMERGENCIA`, `REGLAMENTO_INTERNO` (obra-specific copy or reference), `ENTREGA_EPP` (evidence), `REGLAMENTO_VIGILANCIA_SALUD` if applicable, and `OTRO` placeholder if needed.
    - SignatureRequests: requests for `INDUCCION`, `CAPACITACION_OBRA`, `ENTREGA_EPP`.
  - Implementation details:
    - Use `documentsApi.create`-equivalent service from backend code (`Backend/lib/services`) to create document metadata in DB.
    - Use `signatureRequests` handler/service to create signature requests; include `obraId`, `empresaId`, `personaId`, and `type` or `templateId`.
    - Emit `signature.requested` events to `EventBus` for inbox and notifications.
    - Mark newly-created docs with `faseDeming: 'DO'` or appropriate phase tag so they count toward DO progress.
  - Tests:
    - Unit test that when persona.worksInObra change triggers artifact creation exactly once.
    - Integration test verifying created signature requests are queryable via `signature-requests` list API.

### 2) Backend: Persist `Obra.cumplimientoDS44` and `faseDeming` changes (HIGH)
- Ensure `ObraService.avanzarFaseDeming(obraId)` updates both `faseDeming` and `cumplimientoDS44` snapshot when moving phases.
  - Update `Backend/lib/models/Obra.js` and `Backend/lib/services/ObraService.js`.
  - When Phase moves from PLAN→HACER, persist current PLAN completion percentage and timestamp.
- Endpoint:
  - Verify `POST /obras/{id}/avanzar-fase-deming` handler is included in `serverless.yml` and redeploy.
- Tests:
  - Unit test for `avanzarFaseDeming` updates `faseDeming`.
  - End-to-end test hitting the lambda via API Gateway (post-deploy).

### 3) Deploy Backend (CRITICAL)
- Run `serverless deploy --aws-profile <profile>` from `Backend/` to ensure the API route for `avanzar-fase-deming` is available and not returning 404.
- Validate by calling the endpoint (curl or via frontend in dev mode) and checking CloudWatch logs for the handler invocation.

### 4) Frontend: Dashboard phase-accurate progress (HIGH)
- Replace any precomputed fallback mapping with real per-phase progress calculation:
  - For each `obra`, query `documents` with `faseDeming` filter or compute using `Obra.cumplimientoDS44[phase]`.
  - Update `src/pages/Dashboard.tsx` to pass `progress` reflecting the active `faseDeming` to `ObraProgressCard`.
- Edge cases:
  - If `Obra.cumplimientoDS44` is missing, fall back to computing from `documentsApi.list` filtered by the expected types for the current phase.
- Tests:
  - Visual check: When PLAN reaches 100% the Dashboard should show 100% for PLAN and immediately update to 0% (or initial) for HACER after backend confirms phase advance.

### 5) Frontend: Auto-advance robustness & UX (MEDIUM)
- Ensure `ObraDetalle.tsx` auto-advance flow:
  - Only calls `obrasApi.avanzarFaseDeming` once per phase transition (retain `autoAdvanceRef` guard).
  - Show a non-blocking toast and a loading state during the request.
  - If backend returns 404 or 5xx, retry once after a short delay, then surface an actionable error.
- Add analytics / logs for failures to help debug backend deploy issues.

### 6) Implement CHECK phase UI & storage (MEDIUM)
- Create a CHECK-phase evaluation form component under `src/pages/ObraDetalle/CheckEvaluation.tsx`.
  - Fields per DS44 spec: year, evaluator, checklist answers, free-text observations, overall compliance percent.
  - Store entries in `documents` table or a dedicated `ds44_evaluations` table; prefer `documents` with `type: 'EVALUACION_DS44'` to reuse listing/filtering.
- Backend: Add handler to save evaluation documents and attach to `Obra.cumplimientoDS44.checks`.

### 7) Tests & QA (MEDIUM)
- End-to-end tests (Cypress or Playwright) to cover:
  - Uploading PLAN documents → triggers frontend recognition and reach 100%.
  - Auto-advance request succeeds and backend updates `faseDeming`.
  - Adding worker to obra → auto-creates onboarding artifacts and signature requests; inbox shows pending signatures.
  - Worker signs requests → documents and obra compliance update.

### 8) UX Polish (LOW)
- Small UI fixes:
  - Default expand state for DocumentsRepository rows for `obra` scope only.
  - Add small animation for phase pill change.
  - Ensure accessible labels and alt text for icons.

## Prioritization
1. Deploy backend (task 3) — makes auto-advance call reachable. (Blocker)
2. Backend onboarding artifacts creation (task 1) — critical for DO phase progress.
3. Persist Obra.cumplimientoDS44 and ensure `avanzarFaseDeming` updates (task 2).
4. Dashboard phase-accurate mapping (task 4).
5. Auto-advance robustness & UX (task 5).
6. Implement CHECK phase (task 6).
7. Tests & QA (task 7).
8. UX polish (task 8).

## Quick Runbook (developer steps)
- Deploy backend:

```bash
cd Backend
serverless deploy --aws-profile adrean_cchc
```

- After deploy, run a smoke test:

```bash
# Replace with real obraId and tenant
curl -X POST "https://<api-host>/dev/obras/<obraId>/avanzar-fase-deming" -H "Content-Type: application/json" -d '{}'
```

- Locally test frontend flows (dev server):

```bash
cd Frontend
npm install
npm run dev
```

## Acceptance Criteria for Checkpoint
- Auto-advance PLAN→HACER works once per obra when PLAN is complete and backend confirms phase change.
- Dashboard displays per-obra progress for the active DS44 phase consistently with `Obra.faseDeming`.
- Adding a worker to an obra creates the expected documents and signature requests.
- No repeated POST loops or Hook order React errors remain.

---

If you want, I can now implement the highest-priority backend onboarding artifact creation (task 1). Do you want me to proceed and create the backend code changes and tests, or would you prefer I trigger the backend `serverless deploy` first to unblock the auto-advance endpoint?