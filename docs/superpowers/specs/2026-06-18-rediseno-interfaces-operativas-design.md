# Rediseño de interfaces operativas — Build & Serve (CChC)

**Fecha:** 2026-06-18
**Autor:** Adrean Torres (+ Claude)
**Estado:** En revisión

---

## 0. Contexto y objetivo

La plataforma ya tiene una **identidad de marca real y no genérica** (tokens CChC: navy `#002952`, azul `#006edc`, rojo `#df3601`; tipografías `Lora` display + `Roboto` UI; dark mode + tema claro). El problema no es la marca: es que las **interfaces operativas** se sienten genéricas ("dashboard de IA"), abusan de tarjetas/grillas, y encadenan modales dentro de modales.

**Objetivo:** rediseño profundo de las partes operativas para que se vean como una **herramienta técnica profesional**, oxigenada pero con densidad de dato donde corresponde, intuitiva, responsiva y accesible — **sin perder ni alterar funcionalidades**.

### Qué NO se toca
- Footer.
- Login y Registro (`Login.tsx`, `RegisterAdmin.tsx`, `TenantOnboarding.tsx` en su parte de auth pública).
- Logos / identidad de marca (logo Build & Serve, colores institucionales, tipografías).
- **Ninguna funcionalidad ni lógica de negocio**: APIs, permisos, ruteo funcional, validaciones y efectos se conservan. El rediseño es de capa de presentación y de **organización de la navegación** (modal→página/drawer), separando lógica en archivos nuevos cuando haga falta sin cambiar comportamiento.

### Principios de diseño (transversales)
1. **No genérico de IA**: nada de íconos decorativos de edificios/ciudades ni stock de "tarjetas flotantes". Símbolos solo cuando son funcionales (estados, acciones, tipos de documento).
2. **Híbrido por contexto**: listas densas (tabla + toggle lista/grilla) donde hay muchos datos; layout oxigenado/editorial en flujos y detalle de una entidad. Mismo sistema de componentes.
3. **No todo es dashboard**: el dashboard es un patrón, no el patrón por defecto.
4. **Menos modales, con criterio**: modal solo para confirmaciones y micro-acciones. Formularios con secciones, o modal-dentro-de-modal → **página propia** o **drawer lateral**.
5. **Consistencia empresa↔obra**: una sola sidebar estable; el ámbito lo define el rol/permiso, y el **contexto de datos** lo cambia el selector de obra. Sin atajos que mezclen ámbitos.
6. **Jerarquía tipográfica**: `Lora` para títulos de sección/página; `Roboto` para datos y UI. Acento de marca (línea azul→rojo) como recurso de jerarquía, con moderación.

---

## 1. Sistema base / shell (APROBADO)

### 1.1 Modo "sin chrome" para pasos bloqueantes
`AppContent` gana un `layout-mode` derivado del estado del usuario:
- Si `passwordTemporal` **o** `!habilitado` → se fuerza el flujo de primer ingreso a **pantalla completa**, **sin sidebar, header ni footer**. Paso bloqueante real.
- El resto de la app mantiene el shell normal.
- Se implementa con una condición en `AppContent` que decide entre `auth-mode`/`onboarding-mode` (sin chrome) y el layout normal. No cambia el ruteo funcional ni `authApi.changePassword`.

### 1.2 Sidebar única + selector de obra (estable, NO se reestructura)
- La sidebar **no cambia de estructura** según contexto. Qué ítems se ven depende **del rol/permiso** (comportamiento actual conservado).
  - Roles administrativos (admin, jefe de obra): ven ítems de **empresa** (Obras, Personas globales, Mi Empresa, Cargos, Repositorio) + operativos.
  - Roles operativos (trabajador, etc.): **sin atajos a lo general**; solo su(s) obra(s) vía selector con una **por defecto**.
- **Selector de obra** (en la cabecera de la sidebar; movible al header si en revisión no convence): muestra **código + nombre + estado** de la obra y permite cambiar. Es el único control que cambia el **contexto de datos**, no el menú.
- Mejora: indicador inequívoco de "viendo: *Obra X*" / "*Vista empresa*" para quien tiene ambos ámbitos; persistencia de la obra elegida (ya existe en `localStorage`); toda página de obra refleja siempre la obra seleccionada.

### 1.3 Patrón de colecciones: lista ⇄ grilla
Componente común `CollectionView` (o equivalente) reutilizado por Obras, Personas y Documentos:
- **Toggle lista/grilla** (estilo Drive). **Lista (tabla densa) = vista primaria**; grilla opcional.
- Barra superior con: búsqueda, filtros, orden, y el toggle. Densidad alta por defecto.
- Estados vacíos y de carga consistentes (skeleton, no spinner suelto centrado).

### 1.4 Modal → página / drawer
Regla de decisión:
- **Confirmación / micro-acción** (borrar, confirmar, una nota corta) → modal.
- **Formulario con secciones** o **flujo de varios pasos** → **página con ruta propia**.
- **Acción rápida contextual sobre un ítem de lista** (editar 2-3 campos, ver detalle ligero) → **drawer lateral**.

---

## 2. Componentes comunes nuevos / a consolidar

| Componente | Propósito | Reemplaza / mejora |
|---|---|---|
| `PageHeader` | Título (`Lora`), descripción, breadcrumb de ámbito, acciones primarias | `page-header` ad-hoc repetido |
| `CollectionView` | Lista/grilla + toolbar (buscar, filtrar, ordenar, toggle) + estados vacío/carga | grillas de tarjetas y "Listado" en cards |
| `DataTable` | Tabla densa accesible (orden por columna, selección, responsive→tarjetas en móvil) | listados inline |
| `Drawer` | Panel lateral para acciones rápidas / detalle ligero | modales medianos |
| `Stepper` | Indicador de pasos para flujos (primer ingreso, crear obra) | pantallas de éxito que parpadean |
| `FormPage` (layout) | Layout de página de formulario oxigenado con secciones y barra de acciones sticky | formularios dentro de `Modal size="lg"` |
| `FieldGroup` / `SectionTitle` | Secciones de formulario consistentes | `form-section-title` inline |

Todos consumen los tokens existentes (no se inventan colores). Se busca **reducir estilos inline** y card-anidadas.

---

## 3. Interfaz por interfaz

> Orden del flujo acordado. Se aprueba e implementa **de a una**.

### 3.1 Cambio de contraseña / primer ingreso  — `ChangePassword.tsx` (+ `EnrollMe.tsx`)
**Hoy:** card centrada, pero renderizada **dentro** del `app-layout` → se ve sidebar/header en un paso que debería ser mandatorio. Estado de éxito en pantalla separada que parpadea.

**Rediseño:**
- **Pantalla completa sin chrome** (ver 1.1).
- Primer ingreso = **flujo con `Stepper`**: `1 Contraseña → 2 Enrolamiento`. Cambio voluntario desde Settings = mismo componente, un paso, con "volver".
- Layout oxigenado: panel de contexto a la izquierda (logo Build & Serve, usuario/obra, stepper) + formulario a la derecha; en móvil se apila. **Sin íconos genéricos**; máximo una línea de acento CChC y una retícula técnica muy tenue de fondo.
- Formulario: validación **en vivo** (coincidencia + mínimo) con check ✓/✗, **medidor de fuerza**, aviso de `CapsLock`, mostrar/ocultar (ya existe).
- Éxito integrado en el stepper (paso 1 ✓ → avanza), sin pantalla de éxito intermitente.

**No cambia:** `authApi.changePassword`, redirección a `/enroll-me` / `/`, reglas de validación de backend.

### 3.2 Inicio — `Dashboard.tsx`
**Hoy:** dashboard por rol de 1253 líneas; concentra "Mis Pendientes", "Progreso DS44", "Actividades Recientes", "Resumen de Obras". Es el caso donde más se siente lo genérico.

**Rediseño (principios, no pixel-spec):**
- El Inicio es **resumen accionable orientado a tareas**, no un muro de widgets. Jerarquía: primero **qué tengo que hacer** (pendientes), luego **estado** (progreso/cumplimiento), luego **actividad reciente**.
- **Diferenciar por rol con altura, no con más tarjetas**:
  - Operativo (trabajador): vista enfocada — mis pendientes (firmas, encuestas, onboarding), nada de métricas de empresa.
  - Jefe/admin: panorama de obra(s) seleccionada(s) + accesos a lo de empresa, pero **sin grilla de KPIs decorativos**; pocos números, bien elegidos, con enlace a la vista que los explica.
- Sustituir tarjetas decorativas por **secciones con encabezado + lista**; los números viven inline en la lista, no en "stat cards" sueltas.
- Reutiliza `PageHeader` + secciones; "Resumen de Obras" enlaza a Obras (no duplica la lista completa).
- **Decisión abierta a confirmar en su turno:** alcance exacto de cada variante por rol.

**No cambia:** todas las llamadas a APIs y cálculos de progreso/cumplimiento existentes.

### 3.3 Obras (listado) — `Obras.tsx`
**Hoy:** `page-header` + "Listado de Obras" dentro de una card; crear obra es un modal grande.

**Rediseño:**
- Adopta `CollectionView`: **lista densa por defecto** (código, nombre, mandante, etapa, fase DS44/cumplimiento, estado), con **toggle a grilla**, búsqueda, filtro por estado y orden.
- Fila de obra: clic → `ObraDetalle`. Acciones por fila (ver, editar) discretas; sin tarjetas infladas.
- Acción primaria "**Nueva obra**" → **navega a página** (3.4), ya no abre modal.
- Estado vacío con copy claro y CTA único.

**No cambia:** `obrasApi`, permisos `OBRAS_VER`/`OBRAS_DETALLE`, navegación a detalle.

### 3.4 Crear obra (NUEVA página) — extraída de `Obras.tsx`
**Hoy:** modal de ~200 líneas (510-709) con formulario completo dentro del listado.

**Rediseño:**
- **Página propia** con ruta (p. ej. `/obras/nueva`) usando `FormPage` + `Stepper` si el formulario es largo (datos generales → mandante/ubicación → configuración inicial).
- Barra de acciones sticky (Cancelar / Crear). Autocompletado de dirección y nombre de empresa (lógica ya existente) se conserva.
- Al crear → redirige al detalle de la obra recién creada o al listado, según comportamiento actual.
- La lógica del formulario se **separa** del archivo `Obras.tsx` a la nueva página/route, sin cambiar el submit ni las validaciones.

**No cambia:** `obrasApi.create`, autocompletados, validaciones.

### 3.5 Cargos de onboarding (rework) — `CargosOnboarding.tsx`
**Hoy:** master-detalle en una sola pantalla con **tarjetas anidadas dentro de tarjetas**, y **dos modales** (nuevo cargo; editar ítem, que a su vez anida el editor de matriz EPP). Es el caso señalado como "horrible".

**Rediseño:**
- Mantener el patrón **master-detalle** (es correcto para un catálogo), pero **rediseñado**:
  - Panel izquierdo = **lista densa de cargos** (no botones-tarjeta): nombre, origen (EBCO/heredado/personalizado), nº de ítems. Búsqueda + "Nuevo cargo".
  - Panel derecho = **editor del kit como tabla/lista limpia**, no card-en-card: cada ítem en una fila con título, acción, alcance, bloqueante, y control de plantilla inline.
- **Editar ítem**: en vez de modal grande con muchos selects, pasa a **drawer lateral** (o sección inline expandible). La **matriz EPP** deja de ser un editor anidado dentro de un modal; vive dentro del drawer del ítem como sub-sección clara, no como card flotante anidada.
- "Nuevo cargo" puede seguir siendo un modal **pequeño** (solo nombre → deriva código): cumple la regla de micro-acción. ✔
- Barra "Guardar cambios" sticky con estado dirty/guardado consistente.
- Reduce drásticamente las `card` anidadas y estilos inline.

**No cambia:** `tenantsApi.getCargos/saveCargos`, `uploadsApi`, semilla DS44, modelo `Ds44KitItem`, alcances (tenant/obra/persona/ninguno) ni la lógica de plantillas por alcance.

### 3.6 Personas — `PersonasManagement.tsx`
**Hoy:** grilla de tarjetas de 4 columnas ("Directorio de Personas") + **3 modales grandes** (alta, edición, carga masiva).

**Rediseño:**
- Adopta `CollectionView`: **lista densa por defecto** (nombre, RUT, rol, obra, estado de enrolamiento/habilitación), con **toggle a grilla** (la grilla actual se conserva como vista alternativa, depurada), búsqueda y filtros (rol, obra, estado).
- **Alta de persona** y **carga masiva**: formularios con secciones → **página propia** o `FormPage` (carga masiva puede quedar como página por su flujo de plantilla→archivo→resultado).
- **Edición rápida** (pocos campos) → **drawer lateral** desde la fila; edición completa → página de detalle (`WorkerDetail` ya existe).
- Tarjeta de credenciales (`CredentialCard`) se conserva como resultado de alta.

**No cambia:** `personasApi`, permisos, generación de credenciales, carga masiva, envío de correo de bienvenida.

---

## 4. Responsividad y accesibilidad (transversal)
- **Móvil**: tablas densas colapsan a tarjetas-fila legibles; drawers ocupan pantalla completa; sidebar mantiene su comportamiento mobile actual (overlay).
- **Accesibilidad**: foco visible (ya existe `:focus-visible`), `aria-label` en acciones de ícono, navegación por teclado en tablas y drawers, contraste validado en ambos temas, `Stepper` con estado anunciable.
- **Estados**: skeletons en carga, vacíos con copy útil + CTA, errores con `AlertBanner` (ya existe).

---

## 5. Orden de implementación
Se implementa y aprueba **de a una**:
1. Sistema base / shell (1.1–1.4) + componentes comunes (sección 2) mínimos necesarios.
2. Cambio de contraseña / primer ingreso (3.1).
3. Inicio (3.2).
4. Obras listado (3.3).
5. Crear obra — página (3.4).
6. Cargos de onboarding — rework (3.5).
7. Personas (3.6).

Cada paso: rediseño visual + reorganización modal→página/drawer **conservando 100% de la funcionalidad**, verificando que las APIs, permisos y validaciones siguen intactos.

## 6. Riesgos / cuidados
- **No romper funcionalidad** es el riesgo principal: al extraer formularios de modales a páginas/drawers, mover la lógica tal cual y verificar submit/validaciones.
- Mantener compatibilidad con `ObraContext`, `AuthContext`, permisos y rutas existentes.
- Evitar regresiones de tema (dark/claro) reutilizando solo tokens.
- No introducir dependencias nuevas salvo que sean imprescindibles (se preferirá CSS/componentes propios).

## 7. Decisiones abiertas (a confirmar en cada turno)
- Ubicación final del selector de obra (sidebar vs header) — se prueba en sidebar primero.
- Alcance exacto de cada variante de Inicio por rol (3.2).
- Ruta exacta de "Crear obra" y de "Alta de persona / carga masiva".
