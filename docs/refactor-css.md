# Refactor del CSS global del frontend (septiembre 2026)

**Rama:** `refactor/css-app`, creada desde `pruebas` en `c47b88a` el 29 de septiembre de 2026.
**Alcance:** `Frontend/src/css/` y el orden de sus imports en `Frontend/src/App.tsx`. No se
tocó ningún componente ni la apariencia intencionada de ninguna pantalla.

Este documento deja constancia de por qué se hizo, qué se encontró, qué reglas se siguieron
y cómo se verificó. Si alguien encuentra una diferencia visual, acá está el razonamiento para
rastrearla.

---

## 1. El problema

`Frontend/src/css/App.css` tenía **4.719 líneas**. El tamaño en sí no era el problema —en una
aplicación de este porte, varios miles de líneas de CSS son normales—, sino cómo estaba armado:

1. **Cerca de un tercio era código muerto.** 132 de las 435 clases que definía no se usaban
   en ningún componente: el logo antiguo del sidebar (pasó al header), el dictado del
   asistente de IA (retirado en `e9b0d89`), las pestañas antiguas de incidentes y de firmas,
   tarjetas de estado DS 44 reemplazadas, y utilidades nunca usadas (`grid-cols-3`, `gap-5`,
   `max-w-4xl`…). El propio rediseño de encuestas de la misma semana dejó huérfanas
   `response-question*` y `option-input-row`.
2. **Mezclaba todo en un archivo global:** estructura de la app, sidebar, header, piezas base
   (botones, formularios, tarjetas, tablas, modales, insignias) y secciones de pantallas
   concretas (DS 44, encuestas, incidentes, firmas), intercaladas.
3. **Piezas base definidas en varios lugares.** `.btn`, `.badge`, `.stat-card`, `.form-hint`,
   entre otras, se definían dos o tres veces, a veces en archivos distintos. Cambiar un botón
   obligaba a revisar varios sitios, y el resultado dependía del orden.

Además, todo este CSS se carga completo al abrir la app (`App.tsx` lo importa y las páginas
no se cargan por demanda). Partirlo en archivos no la hace más rápida: el beneficio es de
mantenimiento. Lo que sí reduce la descarga es borrar el código muerto.

## 2. Resultado

| | Antes | Después |
|---|---|---|
| `App.css` | 4.719 líneas | eliminado |
| Archivos globales | `index`, `App`, `components`, `dashboard` | `index`, `layout`, `ds44`, `base`, `encuestas`, `responsive`, `utilidades`, `incidentes`, `firmas`, `components`, `dashboard` |
| Total de CSS global (`src/css/`) | 7.415 líneas | 5.920 líneas |
| CSS empaquetado (`dist`) | 134,5 kB (22,5 kB gzip) | 109,4 kB (19,0 kB gzip) |
| Selectores definidos más de una vez (contados tras la separación) | 23 | 4 (dentro de listas de selectores, ver §6) |

Orden de import en `App.tsx` (`index.css` lo importa además `main.tsx`):

```
index → layout → ds44 → base → encuestas → responsive → utilidades → incidentes → firmas → components → dashboard
```

| Archivo | Contenido |
|---|---|
| `layout.css` | Contenedor principal, sidebar, header, migas de pan |
| `ds44.css` | Documentos DS 44 en la obra: avisos, filtros, filas de evidencia, progreso, selector de caducidad |
| `base.css` | Tarjetas, botones, barra de búsqueda, formularios, casillas, tablas, insignias, avatar, grilla |
| `encuestas.css` | Módulo de Encuestas: listado, creación, detalle y respuesta |
| `responsive.css` | Ajustes generales para tablet y móvil (sidebar, contenido, tarjetas, botones, cifras) |
| `utilidades.css` | Utilidades (flex, espaciado, texto), estados vacíos, spinner, modales, alertas, progreso, pestañas, tarjetas de estadística, encabezados de página, con sus ajustes móviles |
| `incidentes.css` | Estadísticas de incidentes: gráficos de barras, navegación del calendario, filas de detalle |
| `firmas.css` | Pad de firma, modal de firma antiguo (`SignatureModal`) y modal compartido de "Mis firmas" |

## 3. Reglas que se siguieron

Estas son las reglas que guiaron cada decisión. Sirven también para quien toque el CSS después.

### R1. No cambiar cómo se ve nada
El objetivo era ordenar, no rediseñar. Toda regla que sobrevive conserva sus declaraciones, y
cada propiedad de cada selector sigue ganando con el mismo valor que antes. Donde la
separación habría cambiado algo (ver §4, paso 2), se ajustó la separación, no la regla.

### R2. En CSS el orden importa, así que se verifica
Con igual especificidad gana la regla que viene después. Mover una regla de archivo puede
cambiar cuál gana sin que nadie lo note. Por eso no se confió en la intuición: se escribió un
verificador (§5) y cada paso tuvo que pasarlo.

### R3. Una clase está muerta solo si no aparece en ningún lado
Se buscó cada clase como palabra completa en todos los `.tsx`, `.ts`, `.md` de `src/` y en
`index.html`. Se consideraron vivas también las que se arman en tiempo de ejecución con un
prefijo (`` `badge-${tipo}` `` o `'x-' + y`). Las dudosas se revisaron a mano (por ejemplo,
`idp-field-value--empty` y `rd-dato--alerta` sí se usan; `ui-skel--titulo` y
`rd-dato--salud` no).

### R4. De una lista de selectores se quita solo la parte muerta
`.documents-actions-bar, .workers-actions-bar { … }` quedó como `.workers-actions-bar { … }`:
la regla sigue viva para la clase que sí se usa.

### R5. Separar por responsabilidad, respetando la posición original
Cada regla fue al archivo de su tema según el prefijo de sus clases (`ds44-`, `survey-`,
`msig-`, `h-bar-`…). Las piezas base y de estructura se repartieron además **por su posición
en el `App.css` original**, porque ahí estaba intercalado: los ajustes móviles generales venían
después de DS 44 y encuestas, pero antes de las utilidades. De ahí salen `responsive.css` y
`utilidades.css` como archivos aparte, y el orden de import de §2.

### R6. Los estilos globales se importan desde `App.tsx`, no desde la página
Vite ordena el CSS según el grafo de imports. `App.tsx` importa las páginas antes que sus
archivos CSS, así que un CSS importado desde una página queda **antes** de todos los globales
en el bundle, y sus reglas pierden contra `base` o `utilidades` a igual especificidad. Se
comprobó en el bundle real: las reglas de `obra.css` y `repositorio-ds44.css` quedan antes
que `.app-layout` y `.btn`. Esos dos archivos siguen así (no se tocaron) y son la excepción,
no el patrón.

### R7. Al unir definiciones repetidas, gana lo que ya ganaba
Las declaraciones de todas las apariciones se juntan en orden y, para cada propiedad, queda
la que ya ganaba (la última, salvo que una anterior sea `!important`). Se conserva el orden
entre propiedades abreviadas y detalladas (`padding` y `padding-left`), para que no cambie
cuál se impone. La regla unida queda donde estaba la última aparición o, si eso cambiaba la
cascada, donde estaba la primera. Si ninguna de las dos servía, el grupo se habría dejado
como estaba (no pasó).

### R8. Solo se unen reglas de un selector único
Una regla con lista de selectores (`.table th, .table td`) no se parte para unirla con otra:
cambiaría el significado del archivo más de lo que ordena.

### R9. Sin cambio de herramienta
No se migró a CSS Modules ni a Tailwind. Implicaría reescribir los estilos de toda la app y
chocaría con el trabajo de interfaz que se hace en paralelo.

### R10. Un commit por paso
Tres commits (código muerto, separación y unificación) más este documento, para que cada paso
se pueda revisar o revertir por separado.

## 4. Los pasos

### Paso 1 — Código muerto
- `App.css`: se eliminaron 237 reglas (246 selectores) y la animación `h-bounce`, sin
  usos. Quedó en 3.156 líneas.
- `components.css`: 1 regla (`idp-field-value--mono`, `ui-skel--titulo`).
- `repositorio-ds44.css`: 2 reglas (`rd-dato--salud`, `rd-fila-simple--falta`).
- Los `@media` que quedaron vacíos y los comentarios que describían reglas borradas se fueron
  con ellas. Se comprobó que el nuevo `App.css` es el original con líneas quitadas, en el
  mismo orden, salvo las dos listas de selectores recortadas (R4).
- CSS empaquetado: de 134,5 kB a 110,7 kB.

### Paso 2 — Separación
El primer intento (un solo `base.css` y un solo `responsive.css` al final) habría cambiado
cosas reales, y el verificador las detectó:
- **Tarjetas de encuestas en móvil.** `className="card survey-question-card"`: en el original,
  los `@media` de `.card` venían después y ganaban en pantallas chicas.
- **Estado vacío de Onboarding** (`card empty-state` en `CargosOnboarding.tsx`) y
  **encabezados del calendario de actividades y de incidentes** (`card-header items-center`,
  `card-header chart-header-controls`): al revés, en el original las utilidades venían
  después de los ajustes móviles y ganaban.
- **Transición del campo de fecha DS 44** (`ds44-date-input form-input` en `ObraDetalle`):
  en el original `.form-input` venía después.

La separación final (R5) respeta los cuatro casos. También se corrigieron títulos de sección
que ya no correspondían ("INCIDENTS PAGE ENHANCEMENTS" encabezaba tarjetas que ahora usa
también `components/ui/StatCard.tsx`; "MySignatures Page Styles" encabezaba un ajuste genérico
de tablas; "Modal Improvements for SignatureRequests" era el `SignatureModal` antiguo) y se
descartaron los que habían quedado sin contenido. Solo cambian comentarios.

### Paso 3 — Unificación
19 grupos quedaron en una sola regla: `.btn`, `.badge`, `.form-hint`, `.form-section`,
`.form-section-title`, `.stat-card`, `.stat-card::before`, `.stat-card-content`,
`.stat-card-label`, `.stat-card-value`, `.sidebar-user-role`, `.survey-question-header`,
`.survey-question-list`, `.ui-select-trigger`, `.ui-select-caret`,
`.ui-select-panel.is-above` y, en `@media (max-width: 768px)`, `.page-content`,
`.table-container` y `.table`. En 18 casos la regla quedó donde estaba la última aparición; en
`.btn`, donde estaba la primera. Cada unión se verificó por separado antes de la siguiente.

## 5. Cómo se verificó

Con `postcss` (viene con Vite) se escribió un verificador que compara dos versiones del CSS y
reporta:
- **Declaraciones que cambian o desaparecen:** para cada selector, contexto (`@media`) y
  propiedad, el valor que gana antes y después.
- **Inversiones de orden:** dos declaraciones de la misma propiedad, con la misma
  especificidad y valores distintos, que pueden tocar el mismo elemento y cuyo orden relativo
  se invierte. "Pueden tocar el mismo elemento" significa que comparten una clase (que no sea
  de estado, como `.active`), que una no tiene clase, o que sus clases aparecen juntas en
  algún `className` del código. Un `!important` contra una declaración normal no se cuenta,
  porque ahí el orden no decide.

Antes de usarlo se comprobó que detecta un error: se movió `.btn` al final del archivo y
reportó la inversión frente a `.btn-sm`, `.btn-lg` y `.btn-icon`.

Cada paso se verificó sobre los archivos fuente y además sobre el **CSS que genera
`npm run build`**, que es el orden real en que el navegador recibe las reglas, incluidos los
archivos importados desde páginas. De punta a punta (original contra final):
- Solo desaparecen selectores de clases sin uso.
- Quedan 3 avisos, revisados contra el HTML: son falsos positivos. `.card-header > *` solo
  alcanza a hijos directos, `.nav-btn` es nieto de `.card-header` (está dentro de
  `.calendar-nav`) y `.signature-modal` es hija de su overlay, no de una tarjeta.
- Una diferencia aparente en `.stat-card::before` (`top`/`right` contra `inset`) la produce el
  minificador al reescribir `top/right/bottom/left: 0` como `inset: 0`. El efecto es el mismo.

`npm run build` (incluye `tsc -b`) pasa en cada paso.

Las herramientas de verificación fueron de uso puntual y no se agregaron al repositorio.

## 6. Qué queda pendiente

- **Revisión visual.** La verificación es estática: falta mirar en el navegador, en escritorio
  y en celular, el sidebar y el header, el detalle de obra con DS 44 (selector de caducidad),
  Encuestas, Incidentes → Estadísticas y Mis firmas.
- **4 repeticiones sin unir**, porque son parte de listas de selectores (R8): `button` en
  `index.css`, `.table th` en `base.css`, y `.ui-select-trigger:hover:not(:disabled)` y
  `.ui-select-trigger.open` en `components.css`.
- **Estilos embebidos en `<style>`** dentro de al menos 13 componentes (`WorkerDetail`,
  `FormPage`, `Settings`, `PersonasManagement`, `MySignatures`…). No se tocaron; son otro lugar
  donde buscar estilos.
- **Cambios pendientes de otras ramas sobre `App.css`** chocan al integrar, porque el archivo
  ya no existe: el cambio hay que llevarlo al archivo que corresponda según §2.

## 6.1 Integración de `pruebas` (8 de octubre de 2026)

`pruebas` avanzó 27 commits mientras la rama esperaba, y seis tocaron CSS. El único conflicto
fue `App.css` (eliminado acá, modificado allá). Sus cambios se llevaron a mano:

| Cambio en `pruebas` | Destino |
|---|---|
| `min-height: 100dvh` en `.app-layout`; nueva `.app-boot` | `layout.css` |
| Se retira `.sidebar-mobile-close` (las tres definiciones) | `layout.css` y `responsive.css` |
| `overscroll-behavior` en `.sidebar-nav`; `.sidebar-user` con `.sidebar-user-link` | `layout.css` |
| Ícono animado de la hamburguesa (`.header-hamburger-icon`) | `layout.css` |
| Sidebar móvil bajo el header completo, con `bottom: 0` | `layout.css` |
| `.sgsst-row`, `.sgsst-row-main` | `ds44.css` |

`AuthCard.css` y `ficha.css` son nuevos de `pruebas` y se importan desde sus páginas, así que
quedan antes de los globales en el bundle, igual que antes (R6).

Verificación contra el CSS que genera `npm run build` de `pruebas`: ningún valor ganador cambia y
no aparece ninguna regla nueva. Todo lo que desaparece pertenece a clases que ya no usa ningún
componente, incluidas las que agregaron los commits de `pruebas`. Quedan dos avisos de orden entre
`.hidden` y `.signature-pad`/`.survey-firma-resumen` que ya venían del refactor: ningún elemento
combina esas clases.

## 7. Dónde poner un estilo nuevo

1. ¿Es de una pantalla o módulo? Va en su archivo (`encuestas.css`, `incidentes.css`…) o en uno
   nuevo, **importado desde `App.tsx`** en el lugar que le corresponda del orden (R6).
2. ¿Es una pieza base reutilizable? `base.css`, o `components.css` si es de `components/ui`.
3. ¿Es un ajuste para móvil? Junto a la regla que ajusta, en su mismo archivo. `responsive.css`
   es solo para los ajustes generales de estructura.
4. Antes de agregar una regla, buscar si el selector ya existe: una segunda definición del mismo
   selector es justo lo que se limpió acá.
