# Rediseño de interfaces operativas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar las interfaces operativas de Build & Serve (CChC) para que se vean como herramienta técnica profesional —no genérica— sin alterar ninguna funcionalidad.

**Architecture:** Frontend React + Vite + TypeScript + react-router. Se introduce una capa de componentes comunes (PageHeader, Stepper, Drawer, CollectionView/DataTable, FormPage) sobre los tokens CChC existentes, un "modo sin chrome" en `AppContent` para pasos bloqueantes, y se migran formularios de modales grandes a páginas/drawers. La lógica de negocio (APIs, permisos, validaciones) se mueve tal cual, sin cambios de comportamiento.

**Tech Stack:** React 18, react-router-dom, react-icons, CSS con variables (tokens en `src/css/index.css`). Sin librerías nuevas.

## Global Constraints

- **No tocar:** Footer, Login (`Login.tsx`), Registro (`RegisterAdmin.tsx`, parte auth de `TenantOnboarding.tsx`), logos/identidad de marca, tipografías y tokens de color.
- **No alterar funcionalidad:** APIs (`api/*`), permisos (`PERMISSIONS`), ruteo funcional, validaciones y efectos se conservan idénticos. Solo cambia presentación y organización (modal→página/drawer).
- **Solo tokens existentes** de `src/css/index.css` (no inventar colores). `Lora` (`--font-display`) para títulos; `Roboto` (`--font-ui`) para datos/UI.
- **Sin dependencias nuevas** salvo imprescindibles (preferir CSS/componentes propios).
- **Verificación por tarea (no hay test runner):** `npm run build` debe pasar (tsc -b + vite build), `npm run lint` sin errores nuevos, + checklist manual de la tarea. Commits frecuentes.
- **Responsividad y accesibilidad:** tablas densas colapsan a tarjetas en móvil; `aria-label` en acciones de ícono; foco visible; navegación por teclado en drawers/tablas.
- Trabajo dentro de `Frontend/`. Componentes comunes en `Frontend/src/components/ui/`, exportados desde `Frontend/src/components/ui/index.ts`.

---

## Fase 0 — Fundaciones (shell + componentes comunes)

### Task 1: Modo "sin chrome" para pasos bloqueantes

**Files:**
- Modify: `Frontend/src/App.tsx` (`AppContent`, ~líneas 90-110 y el render del layout)
- Modify: `Frontend/src/css/App.css` (clase `onboarding-mode` / ajuste de `auth-mode`)

**Interfaces:**
- Consumes: `useAuth()` → `user.passwordTemporal`, `user.habilitado`; `useLocation()`.
- Produces: variable booleana `isBlockingStep` en `AppContent`; cuando es `true`, no se renderizan `<Sidebar>`, `<Header>`, `<OfflineBanner>`, `<SuggestionsWidget>`, `<Footer>` y el `<main>` usa clase sin chrome.

- [ ] **Step 1:** En `AppContent` calcular el paso bloqueante:
```tsx
const location = useLocation();
const isBlockingStep = !!user && (
  user.passwordTemporal === true || user.habilitado === false
) && ['/change-password', '/enroll-me'].includes(location.pathname);
```
- [ ] **Step 2:** Envolver el render: si `isBlockingStep`, renderizar solo `<main className="onboarding-content"><div className="route-outlet"><Routes>…</Routes></div></main>` (mismas `<Routes>`), sin `Sidebar/Header/OfflineBanner/SuggestionsWidget/Footer`. Mantener `SessionExpiredModal`. Reusar el mismo bloque `<Routes>` (extraerlo a una const `routes` para no duplicarlo).
- [ ] **Step 3:** En `App.css` añadir `.onboarding-content { min-height: 100vh; width: 100%; margin: 0; }` y asegurar que no aplica el padding/margen de `.main-content`.
- [ ] **Step 4:** `npm run build` → PASS. `npm run lint` → sin errores nuevos.
- [ ] **Step 5 (manual):** Login con usuario `passwordTemporal` → la pantalla de cambio de contraseña NO muestra sidebar/header/footer; un usuario normal en `/` sí ve el shell completo.
- [ ] **Step 6:** Commit: `git commit -m "feat(shell): modo sin chrome para pasos bloqueantes (cambio de contraseña / enrolamiento)"`

---

### Task 2: Componentes `PageHeader` y `Stepper`

**Files:**
- Create: `Frontend/src/components/ui/PageHeader.tsx`
- Create: `Frontend/src/components/ui/Stepper.tsx`
- Modify: `Frontend/src/components/ui/index.ts`

**Interfaces:**
- Produces:
```tsx
// PageHeader.tsx
export interface PageHeaderProps {
  title: string;
  description?: string;
  scope?: { label: string };        // breadcrumb de ámbito: "Vista empresa" / "Obra: …"
  backTo?: string;                   // si está, muestra botón "Volver"
  actions?: React.ReactNode;         // botones primarios a la derecha
}
export default function PageHeader(props: PageHeaderProps): JSX.Element;

// Stepper.tsx
export interface StepperStep { id: string; label: string; }
export interface StepperProps {
  steps: StepperStep[];
  currentIndex: number;              // 0-based
  completed?: string[];              // ids completados (muestra ✓)
  orientation?: 'horizontal' | 'vertical';
}
export default function Stepper(props: StepperProps): JSX.Element;
```

- [ ] **Step 1:** Crear `PageHeader.tsx`: título con `font-family: var(--font-display)`, descripción en `--text-secondary`, `scope` como chip pequeño, `backTo` con `<Link>` + `FiArrowLeft`, `actions` alineadas a la derecha. Usar clases CSS (no inline excesivo); estilos en un `<style>` local o en `App.css` bajo `.ui-page-header`.
- [ ] **Step 2:** Crear `Stepper.tsx`: pasos con índice, estado actual (acento `--accent`), completados con `FiCheck`, línea conectora con `--cchc-accent-line` atenuada. `role="list"`, cada paso `aria-current` cuando activo.
- [ ] **Step 3:** Exportar ambos desde `index.ts` (default + types), siguiendo el patrón existente.
- [ ] **Step 4:** `npm run build` → PASS; `npm run lint` → sin errores nuevos.
- [ ] **Step 5 (manual):** Render temporal en cualquier página para ver PageHeader (título en Lora, ámbito chip, acciones) y Stepper (3 pasos, uno activo, uno ✓) en dark y claro.
- [ ] **Step 6:** Commit: `git commit -m "feat(ui): componentes PageHeader y Stepper"`

---

### Task 3: Componente `Drawer`

**Files:**
- Create: `Frontend/src/components/ui/Drawer.tsx`
- Modify: `Frontend/src/components/ui/index.ts`

**Interfaces:**
- Produces:
```tsx
export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: number;                    // px, default 480
  footer?: React.ReactNode;          // barra de acciones sticky inferior
  children: React.ReactNode;
}
export default function Drawer(props: DrawerProps): JSX.Element | null;
```

- [ ] **Step 1:** Crear `Drawer.tsx` con `createPortal` a `document.body`: overlay con blur (reusar patrón del modal de `App.tsx`), panel lateral derecho que entra con transición `--transition-normal`, header (title/subtitle + botón cerrar `FiX`), cuerpo con scroll, `footer` sticky. En móvil (`max-width: 640px`) ocupa el 100% del ancho.
- [ ] **Step 2:** Accesibilidad: `role="dialog"`, `aria-modal="true"`, cerrar con `Escape`, focus trap básico (focus al abrir, restaurar al cerrar), `aria-label` en botón cerrar.
- [ ] **Step 3:** Exportar desde `index.ts`.
- [ ] **Step 4:** `npm run build` → PASS; `npm run lint` → sin errores nuevos.
- [ ] **Step 5 (manual):** Abrir/cerrar un Drawer de prueba; Escape cierra; en móvil ocupa todo; footer queda fijo.
- [ ] **Step 6:** Commit: `git commit -m "feat(ui): componente Drawer (panel lateral)"`

---

### Task 4: `DataTable` + `CollectionView` (patrón lista ⇄ grilla)

**Files:**
- Create: `Frontend/src/components/ui/DataTable.tsx`
- Create: `Frontend/src/components/ui/CollectionView.tsx`
- Modify: `Frontend/src/components/ui/index.ts`

**Interfaces:**
- Produces:
```tsx
// DataTable.tsx — tabla densa genérica
export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  width?: string;
  align?: 'left' | 'right' | 'center';
  hideOnMobile?: boolean;
}
export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  loading?: boolean;                 // muestra skeleton
}
export default function DataTable<T>(props: DataTableProps<T>): JSX.Element;

// CollectionView.tsx — toolbar (buscar/filtrar/ordenar/toggle) + lista|grilla
export type CollectionMode = 'list' | 'grid';
export interface CollectionViewProps {
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;          // selects de filtro (slot)
  sort?: React.ReactNode;             // control de orden (slot)
  mode: CollectionMode;
  onModeChange: (m: CollectionMode) => void;
  count?: number;                     // "N elementos"
  list: React.ReactNode;              // típicamente un <DataTable/>
  grid: React.ReactNode;              // grilla alternativa
  actions?: React.ReactNode;          // acción primaria (ej: "Nueva obra")
}
export default function CollectionView(props: CollectionViewProps): JSX.Element;
```

- [ ] **Step 1:** Crear `DataTable.tsx`: tabla semántica (`<table>`), encabezados con orden asc/desc (icono) cuando `sortable`, filas clicables (`onRowClick`, `role` y `tabIndex` para teclado), densidad alta. `loading` → filas skeleton. Vacío → `emptyState`. En `max-width: 640px` colapsa a tarjetas-fila (cada fila = bloque con label:valor, ocultando columnas `hideOnMobile`).
- [ ] **Step 2:** Crear `CollectionView.tsx`: toolbar superior con `SearchInput` (existente), slots `filters`/`sort`, contador, toggle lista/grilla (2 botones con `FiList`/`FiGrid`, `aria-pressed`), `actions` a la derecha. Render `list` o `grid` según `mode`.
- [ ] **Step 3:** Exportar ambos + types desde `index.ts`.
- [ ] **Step 4:** `npm run build` → PASS; `npm run lint` → sin errores nuevos.
- [ ] **Step 5 (manual):** Montaje de prueba con datos dummy: ordenar por columna, alternar lista/grilla, buscar, ver colapso a tarjetas en móvil, estado vacío y skeleton.
- [ ] **Step 6:** Commit: `git commit -m "feat(ui): DataTable y CollectionView (patrón lista/grilla)"`

---

### Task 5: Layout `FormPage` + `FieldSection`

**Files:**
- Create: `Frontend/src/components/ui/FormPage.tsx` (incluye `FieldSection`)
- Modify: `Frontend/src/components/ui/index.ts`

**Interfaces:**
- Produces:
```tsx
export interface FormPageProps {
  header: React.ReactNode;            // típicamente <PageHeader/>
  stepper?: React.ReactNode;          // opcional <Stepper/>
  children: React.ReactNode;          // <FieldSection/>...
  actions: React.ReactNode;           // barra sticky inferior (Cancelar/Guardar)
  onSubmit?: (e: React.FormEvent) => void;
}
export default function FormPage(props: FormPageProps): JSX.Element;

export interface FieldSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}
export function FieldSection(props: FieldSectionProps): JSX.Element;
```

- [ ] **Step 1:** Crear `FormPage.tsx`: contenedor centrado/oxigenado con ancho máx ~`--max-content-width` reducido (~760px), `header` arriba, `stepper` opcional, cuerpo `<form onSubmit>`, barra de acciones **sticky** abajo (`actions`). `FieldSection` = título (`Lora`, `--text-lg`), descripción opcional y contenido con grilla de campos.
- [ ] **Step 2:** Exportar `FormPage` (default) y `FieldSection` (named) desde `index.ts`.
- [ ] **Step 3:** `npm run build` → PASS; `npm run lint` → sin errores nuevos.
- [ ] **Step 4 (manual):** Montaje de prueba con 2 `FieldSection` y barra de acciones sticky que queda fija al hacer scroll.
- [ ] **Step 5:** Commit: `git commit -m "feat(ui): layout FormPage + FieldSection"`

---

### Task 5b: Mejora del selector de obra (Header)

**Files:**
- Modify: `Frontend/src/components/Header.tsx` (dropdown de obra, ~líneas 72-230)

**Interfaces:**
- Consumes: `useObraContext()` → `obras`, `selectedObraId`, `setSelectedObraId`, `isLoadingObras`; `Badge` (existente).
- Produces: selector mejorado en el Header (no se mueve de ubicación).

- [ ] **Step 1:** En el trigger del dropdown mostrar **código + nombre + estado** de la obra seleccionada (hoy solo muestra nombre, `Header.tsx:199`). Para "Vista empresa" (sin obra) mostrar etiqueta clara "Vista empresa". El estado se pinta con `Badge` según `obra.estado`.
- [ ] **Step 2:** En cada ítem del dropdown mostrar `código · nombre` + `Badge` de estado; conservar la opción "Vista empresa" (`setSelectedObraId(null)`) solo para roles que hoy la tienen (no cambiar la lógica de visibilidad existente).
- [ ] **Step 3:** No cambiar `setSelectedObraId`, persistencia en `localStorage`, ni la lógica de auto-selección de `ObraContext`.
- [ ] **Step 4:** `npm run build` → PASS; `npm run lint` → sin errores nuevos.
- [ ] **Step 5 (manual):** Admin ve "Vista empresa" + obras con código/estado; trabajador ve su obra con código/estado y puede cambiar entre las suyas; la selección persiste al recargar.
- [ ] **Step 6:** Commit: `git commit -m "feat(header): selector de obra con código, nombre y estado"`

---

## Fase 1 — Interfaces (una por tarea)

### Task 6: Cambio de contraseña / primer ingreso

**Files:**
- Modify: `Frontend/src/pages/ChangePassword.tsx`
- Modify: `Frontend/src/pages/EnrollMe.tsx` (alineación visual del paso 2 del flujo, sin cambios de lógica)

**Interfaces:**
- Consumes: `Stepper` (Task 2), `useAuth`, `authApi.changePassword` (sin cambios).
- Produces: pantalla rediseñada sin chrome (depende de Task 1) con stepper de primer ingreso.

> **Alcance EnrollMe:** comparte el flujo sin chrome (Task 1) y el `Stepper` (paso 2 activo). En este task solo se alinea su cabecera/stepper para que el flujo se vea continuo; **no** se rediseña su lógica de enrolamiento ni sus pasos internos.

- [ ] **Step 1:** Reemplazar el layout por columna centrada oxigenada: panel izquierdo (desktop) con logo Build & Serve (reusar el del header/marca existente), usuario/obra y `<Stepper steps=[{id:'pass',label:'Contraseña'},{id:'enroll',label:'Enrolamiento'}] currentIndex={0} />` cuando `passwordTemporal || !habilitado`; a la derecha el formulario. En móvil apila (stepper arriba). Fondo con la línea de acento `--cchc-accent-line` y retícula técnica muy tenue (CSS, sin imágenes/íconos decorativos).
- [ ] **Step 2:** Validación en vivo: estado derivado de coincidencia (`passwordNuevo === confirmarPassword`) y mínimo (≥6) mostrando ✓/✗ junto a cada regla; aviso `CapsLock` (evento `getModifierState('CapsLock')`). Mantener mostrar/ocultar existente. NO cambiar el submit ni el `setTimeout`/redirección.
- [ ] **Step 3:** Integrar el éxito en el stepper (paso 1 → ✓, mensaje "Avanzando a enrolamiento…") en vez del bloque `if (success)` de pantalla completa intermitente; conservar la redirección a `/enroll-me` o `/`.
- [ ] **Step 4:** `npm run build` → PASS; `npm run lint` → sin errores nuevos.
- [ ] **Step 5 (manual):** Usuario `passwordTemporal`: ve stepper, sin chrome; reglas en vivo; CapsLock avisa; al enviar correcto → redirige a enrolamiento. Cambio voluntario desde Settings (no temporal): un solo paso, botón "Cerrar sesión" sigue presente.
- [ ] **Step 6:** Commit: `git commit -m "feat(onboarding): rediseño de cambio de contraseña / primer ingreso con stepper"`

---

### Task 7: Inicio (Dashboard)

**Files:**
- Modify: `Frontend/src/pages/Dashboard.tsx`
- (posible) Create: `Frontend/src/pages/dashboard/` para extraer las variantes por rol si reduce el tamaño del archivo.

**Interfaces:**
- Consumes: `PageHeader` (Task 2), `useAuth`, `useObra` (ObraContext), todas las llamadas API existentes (sin cambios).
- Produces: Inicio orientado a tareas, sin grilla de KPIs decorativos.

- [ ] **Step 1:** Sustituir la cabecera por `<PageHeader title="Inicio" scope={…} />` con ámbito ("Vista empresa" o "Obra: código · nombre" según `selectedObra`).
- [ ] **Step 2:** Reordenar a jerarquía de tareas: (1) **Mis pendientes** (firmas/encuestas/onboarding) como lista accionable arriba; (2) **Estado/cumplimiento DS44** como sección con números inline (no stat-cards sueltas); (3) **Actividad reciente** como lista. Reusar los datos ya cargados; no cambiar las llamadas API ni los cálculos.
- [ ] **Step 3:** Variante por rol con *altura, no más tarjetas*: trabajador → solo pendientes propios (sin métricas de empresa); jefe/admin → panorama de obra seleccionada + enlaces a Obras/Personas (sin duplicar listados completos; "Resumen de obras" enlaza a `/obras`).
- [ ] **Step 4:** Eliminar tarjetas decorativas/"stat cards" sin dato accionable; mantener `StatCard` solo donde el número enlaza a su vista explicativa.
- [ ] **Step 5:** `npm run build` → PASS; `npm run lint` → sin errores nuevos.
- [ ] **Step 6 (manual):** Iniciar como trabajador (ve solo pendientes), como jefe/admin (panorama + enlaces), con y sin obra seleccionada; verificar que ningún dato/acción previa desapareció (firmas, encuestas, progreso).
- [ ] **Step 7:** Commit: `git commit -m "feat(inicio): rediseño orientado a tareas, sin KPIs decorativos"`

---

### Task 8: Obras (listado)

**Files:**
- Modify: `Frontend/src/pages/Obras.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `CollectionView`, `DataTable` (Tasks 2,4), `obrasApi`, permisos (sin cambios).
- Produces: listado con lista densa por defecto + toggle grilla; "Nueva obra" navega (Task 9).

- [ ] **Step 1:** Reemplazar la card "Listado de Obras" por `<CollectionView>` con `<DataTable>` de columnas: Código, Nombre, Mandante, Etapa, Cumplimiento DS44 (con `Badge`/barra), Estado. `onRowClick` → `navigate('/obras/'+obraId)`.
- [ ] **Step 2:** Grilla alternativa depurada (tarjeta compacta por obra) en el slot `grid`; toggle persistido en `localStorage` (`obrasViewMode`).
- [ ] **Step 3:** Búsqueda (nombre/código), filtro por estado, orden por columnas. Estado vacío con `EmptyState` + CTA único.
- [ ] **Step 4:** Acción primaria "**Nueva obra**" en `PageHeader.actions` → `navigate('/obras/nueva')` (en vez de abrir el modal). El modal de crear obra se elimina de este archivo en la Task 9 (aquí solo se cambia el botón; si Task 9 aún no existe, dejar el botón apuntando a la ruta y mantener el modal hasta entonces — **orden recomendado: Task 9 antes que este Step**).
- [ ] **Step 5:** `npm run build` → PASS; `npm run lint` → sin errores nuevos.
- [ ] **Step 6 (manual):** Lista densa por defecto; toggle a grilla; buscar/filtrar/ordenar; clic en fila abre detalle; "Nueva obra" navega; estado vacío correcto.
- [ ] **Step 7:** Commit: `git commit -m "feat(obras): listado con CollectionView (lista/grilla) y acción Nueva obra a página"`

---

### Task 9: Crear obra (nueva página)

**Files:**
- Create: `Frontend/src/pages/ObraNueva.tsx`
- Modify: `Frontend/src/App.tsx` (ruta `/obras/nueva`)
- Modify: `Frontend/src/pages/Obras.tsx` (eliminar el `Modal` de crear y su estado `isModalOpen` y handlers asociados, ya extraídos)

**Interfaces:**
- Consumes: `FormPage`, `FieldSection`, `Stepper` (Tasks 2,5), `obrasApi.create`, `AddressAutocomplete` (componente existente), lógica de autocompletado de nombre de empresa (mover tal cual desde `Obras.tsx`).
- Produces: ruta `/obras/nueva` protegida con `PERMISSIONS.OBRAS_CREAR` (mismo permiso que hoy gobierna el botón crear).

- [ ] **Step 1:** Crear `ObraNueva.tsx` moviendo el formulario del modal (`Obras.tsx` ~510-709) a `FormPage` con `FieldSection`s (Datos generales · Mandante/Ubicación · Configuración inicial) y `Stepper` si procede. Mover `formData`, efectos de autocompletado, validaciones y `handleSubmit` **sin cambios de lógica**.
- [ ] **Step 2:** En éxito, `navigate('/obras/'+nuevaObraId)` (o a `/obras` si hoy hace eso). Barra de acciones sticky: Cancelar (`navigate('/obras')`) / Crear obra.
- [ ] **Step 3:** Registrar la ruta en `App.tsx` con `<ProtectedRoute requiredPermission={PERMISSIONS.OBRAS_CREAR}>` (verificar el nombre exacto del permiso en `permissions.ts`; si no existe `OBRAS_CREAR`, usar el que gobierna hoy la creación).
- [ ] **Step 4:** En `Obras.tsx` eliminar el `<Modal>` de crear y el estado/handlers ya migrados; el botón "Nueva obra" queda navegando (Task 8 Step 4).
- [ ] **Step 5:** `npm run build` → PASS; `npm run lint` → sin errores nuevos.
- [ ] **Step 6 (manual):** Crear una obra de punta a punta desde la nueva página (autocompletados funcionan, validaciones idénticas, se crea y redirige); verificar que no quedó referencia rota al modal eliminado.
- [ ] **Step 7:** Commit: `git commit -m "feat(obras): crear obra como página propia (/obras/nueva)"`

---

### Task 10: Cargos de onboarding (rework master-detalle)

**Files:**
- Modify: `Frontend/src/pages/CargosOnboarding.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Drawer` (Tasks 2,3), `tenantsApi`, `uploadsApi`, `Ds44KitItem` (sin cambios de modelo).
- Produces: master-detalle rediseñado; editar ítem en Drawer (no modal anidado).

- [ ] **Step 1:** Cabecera con `PageHeader title="Cargos de onboarding" scope={{label:'Catálogo de empresa'}}` + acción "Guardar cambios" (estado dirty/guardado) sticky.
- [ ] **Step 2:** Panel izquierdo = **lista densa de cargos** (no botones-tarjeta): nombre, origen (EBCO/heredado/personalizado), nº ítems; búsqueda + "Nuevo cargo" (mantener modal **pequeño** de solo-nombre). Resaltado del seleccionado sin `card` anidada.
- [ ] **Step 3:** Panel derecho = editor del kit como **lista/tabla limpia** (filas, no card-en-card): por ítem título, acción, alcance, bloqueante y `PlantillaControl` inline (reusar el componente existente).
- [ ] **Step 4:** "Editar ítem" pasa de `<Modal>` a `<Drawer>`: mover `ItemEditor` dentro del Drawer; la **matriz EPP** (`EppMatrixEditor`) queda como sub-sección clara dentro del drawer (no card flotante anidada). Conservar `saveItem`, `setItemPlantilla`, `uploadPlantilla` sin cambios.
- [ ] **Step 5:** Reducir estilos inline y `card` anidadas a clases CSS.
- [ ] **Step 6:** `npm run build` → PASS; `npm run lint` → sin errores nuevos.
- [ ] **Step 7 (manual):** Crear/duplicar/eliminar cargo; agregar/editar ítem en drawer; matriz EPP funciona; subir/previsualizar/quitar plantilla; "Guardar cambios" persiste; semilla DS44 sigue cargando cuando no hay catálogo.
- [ ] **Step 8:** Commit: `git commit -m "feat(cargos): rework master-detalle y editar ítem en drawer (sin card anidadas)"`

---

### Task 11: Personas

**Files:**
- Modify: `Frontend/src/pages/PersonasManagement.tsx`
- Create: `Frontend/src/pages/PersonaNueva.tsx` (alta) y/o `Frontend/src/pages/PersonasCargaMasiva.tsx` (carga masiva)
- Modify: `Frontend/src/App.tsx` (rutas nuevas)

**Interfaces:**
- Consumes: `PageHeader`, `CollectionView`, `DataTable`, `Drawer`, `FormPage` (Tasks 2-5), `personasApi`, `CredentialCard`, permisos (sin cambios).
- Produces: directorio con lista densa por defecto; alta y carga masiva como páginas; edición rápida en drawer.

- [ ] **Step 1:** Reemplazar la grilla `.pdir-grid` por `<CollectionView>` + `<DataTable>` (Nombre, RUT, Rol, Obra, Estado enrolamiento/habilitación) con toggle a la grilla actual depurada; búsqueda y filtros (rol, obra, estado). Persistir modo en `localStorage` (`personasViewMode`).
- [ ] **Step 2:** Extraer el `Modal` de **alta** a `PersonaNueva.tsx` (`FormPage` + `FieldSection`: Datos personales · Ficha del colaborador · Rol). Mover `handleCreate`/estado tal cual; en éxito mostrar `CredentialCard`. Ruta protegida con el permiso actual (`PERSONAS_CREAR`).
- [ ] **Step 3:** Extraer el `Modal` de **carga masiva** a `PersonasCargaMasiva.tsx` (`FormPage`: Plantilla · Opciones · Archivo · Resultado). Mover lógica sin cambios. Ruta con permiso actual.
- [ ] **Step 4:** **Edición rápida** (pocos campos) pasa a `<Drawer>` desde la fila; edición completa sigue en `WorkerDetail` (`/personas/:rut`). Conservar `handleEdit`.
- [ ] **Step 5:** Botones "Nueva persona" / "Carga masiva" en `PageHeader.actions` → navegan a las nuevas rutas (en vez de abrir modales). Eliminar los modales migrados.
- [ ] **Step 6:** `npm run build` → PASS; `npm run lint` → sin errores nuevos.
- [ ] **Step 7 (manual):** Lista densa + toggle grilla; buscar/filtrar; alta de persona end-to-end (credenciales + correo bienvenida si aplica); carga masiva end-to-end; edición rápida en drawer; abrir detalle. Nada de funcionalidad perdida.
- [ ] **Step 8:** Commit: `git commit -m "feat(personas): directorio con CollectionView; alta y carga masiva como páginas; edición en drawer"`

---

## Orden de ejecución recomendado
Fase 0 completa (Tasks 1-5) → luego Fase 1 en orden de flujo (6 → 7 → 8/9 juntas, con **9 antes del Step 4 de 8** → 10 → 11). Cada interfaz se aprueba antes de seguir.

## Notas de verificación funcional (no romper nada)
- Tras cada extracción modal→página/drawer: confirmar que submit, validaciones, efectos de autocompletado, generación de credenciales, subida de archivos y permisos se comportan **igual que antes**.
- `npm run build` y `npm run lint` son obligatorios por tarea. La verificación manual de cada Task es la red de seguridad principal al no haber test runner.
