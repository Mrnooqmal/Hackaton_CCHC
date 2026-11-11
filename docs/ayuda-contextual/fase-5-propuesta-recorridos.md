# Fase 5: propuesta de recorridos iniciales

**7 de noviembre de 2026.** Para aprobar antes de crear ninguno. Para cada recorrido: pantalla, quién lo ve, pasos con su texto propuesto, y qué anclas hay que marcar en el código. Hoy solo existen las anclas del header, del menú lateral y del menú de ayuda.

---

## Restricciones que moldean la propuesta

1. **Ningún paso dentro de un modal.** La ventana de firma, la firma asistida y el PIN son modales. Están por encima de la capa del recorrido, y un recorrido no puede abrirlos. Lo que pasa dentro se explica en el texto del paso, desde la pantalla.
2. **Nada en la elección de obra.** Esa pantalla no tiene header (no hay botón de ayuda) y nada se lanza sin ámbito elegido. La introducción del administrador va en Inicio, con ámbito empresa.
3. **Teléfono.** El menú lateral está oculto y la etiqueta de la obra del header no se muestra. Los pasos que los usan se **saltan solos** en el teléfono. Para que no quede un hueco, propongo un ancla en el botón de menú (las tres líneas), que solo se ve en el teléfono: en escritorio ese paso se salta y en el teléfono se salta el del menú lateral.
4. **Un solo recorrido automático por sesión.** Las introducciones de Inicio se reparten por permiso para que **cada persona calce con una sola**.
5. **Firma sin conexión (paso 2 a prod).** Va a cambiar Mis firmas, la firma asistida y va a sumar "Preparar cuadrilla sin señal". Los recorridos de firma se anclan solo a lo que no debería cambiar (pestañas y lista) y no mencionan la conexión. **La firma asistida queda fuera** hasta que eso llegue.
6. **Redacción:** las reglas de siempre. La plataforma guarda y custodia, no valida el contenido, no garantiza el cumplimiento. Las cuatro fases son un esquema propio.

---

## Obligatorios (se lanzan solos)

### 1. `inicio-terreno`: tu pantalla de Inicio (terreno)

- **Pantalla:** Inicio. **Ámbito:** cualquiera.
- **Lo ven:** quienes no tienen `obras.ver`, es decir, trabajador y colaborador con los permisos por defecto.
- **Manual:** `roles/trabajador`.

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | `inicio.aviso-ingreso` *(nueva)* | Antes de entrar a la obra | Si te faltan firmas obligatorias para ingresar a terreno, este aviso aparece primero. Tócalo y fírmalas antes que nada. |
| 2 | `inicio.accesos` *(nueva)* | Tus accesos | Tus firmas, las actividades de hoy, tus encuestas y el botón para reportar un hallazgo o un incidente. |
| 3 | `inicio.pendientes` *(nueva)* | Lo que te toca | Aquí aparece lo que espera por ti: firmar, responder o registrar tu asistencia. Lo atrasado va primero. |
| 4 | `global.boton-ayuda` | ¿Dudas? | En cada pantalla, este botón tiene guías como esta y la página del manual que la explica. |

El paso 1 solo aparece si la persona tiene ese aviso; si no, se salta solo.

### 2. `inicio-gestion`: Inicio para quien gestiona la obra

- **Pantalla:** Inicio. **Ámbito:** obra.
- **Lo ven:** quienes tienen `obras.ver` y no tienen `empresa.ver`, es decir, supervisor, prevencionista y jefe de obra por defecto.
- **Manual:** `empezar/elegir-obra`.

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | `global.obra-actual` *(nueva)* | La obra en la que estás | Todo lo que ves es de esta obra: actividades, firmas, incidentes y documentos. *(Se salta en el teléfono.)* |
| 2 | `global.menu-lateral` | Tus módulos | Desde aquí entras a lo que gestionas: el detalle de la obra, personas, repositorio, actividades e incidentes. *(Se salta en el teléfono.)* |
| 3 | `global.boton-menu` *(nueva)* | Tus módulos | Abre el menú para entrar a lo que gestionas. Abajo, junto a tu nombre, está **Cambiar de obra**. *(Solo en el teléfono.)* |
| 4 | `global.menu-sesion` *(nueva)* | Cambiar de obra | Si trabajas en varias obras, cambia de una a otra desde este menú. *(Se salta en el teléfono.)* |
| 5 | `inicio.pendientes` | También lo tuyo | Tus propias firmas y encuestas aparecen aquí, como las de cualquier persona. |
| 6 | `global.boton-ayuda` | Ayuda en cada pantalla | Guías como esta y el manual de la pantalla en la que estás. |

### 3. `inicio-empresa`: la vista de empresa (administración)

- **Pantalla:** Inicio. **Ámbito:** empresa.
- **Lo ven:** quienes tienen `empresa.ver` (administrador por defecto).
- **Manual:** `roles/administrador`.

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | `global.menu-lateral` | La vista de empresa | Aquí configuras la empresa: obras, personas, Mi Empresa, Onboarding y catálogos. *(Se salta en el teléfono.)* |
| 2 | `global.boton-menu` | La vista de empresa | Abre el menú para configurar la empresa: obras, personas, Mi Empresa, Onboarding y catálogos. *(Solo en el teléfono.)* |
| 3 | `global.menu-sesion` | Entrar a una obra | Para trabajar dentro de una obra, usa **Cambiar de obra** en este menú. *(Se salta en el teléfono.)* |
| 4 | `global.boton-ayuda` | Ayuda en cada pantalla | Guías como esta y el manual de cada pantalla. Para empezar, revisa **Mi Empresa** y registra a tu equipo. |

### 4. `mis-firmas`: firmar lo que te asignan

- **Pantalla:** Mis firmas. **Ámbito:** cualquiera. **Lo ven:** todos.
- **Manual:** `terreno/firmar`.

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | `mis-firmas.pestanas` *(nueva)* | Pendientes e historial | En **Pendientes** está lo que espera tu firma; en **Historial**, todo lo que ya firmaste, con su comprobante. |
| 2 | `mis-firmas.lista` *(nueva)* | Cómo se firma | Toca **Firmar**, lee el documento con **Ver documento**, escribe tu PIN de 4 dígitos y marca que lo leíste. La firma queda registrada con fecha y hora. |
| 3 | `mis-firmas.avance` *(nueva)* | Tu avance | Cuánto llevas firmado este mes y lo que vence pronto en tu obra. |

Sin pasos dentro de la ventana de firma (restricción 1), sin mencionar la conexión (restricción 5) y sin afirmar validez legal.

---

## Opcionales (desde la ayuda de cada pantalla)

### 5. `reportar`: hallazgo, incidente o accidente

- **Pantalla:** Reportar. **Lo ven:** todos.
- **Manual:** `terreno/reportar`.
- **Opcional y no obligatorio a propósito:** quien abre Reportar suele estar apurado, y un recorrido automático estorbaría.

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | `incidente-reportar.tipo` *(nueva)* | ¿Hallazgo o incidente? | Un **hallazgo** es algo inseguro que ves **antes** de que cause daño: cualquiera puede reportarlo. Un **incidente** es algo que **ya pasó**. Si hubo lesión, quien tiene el permiso lo califica después como accidente. |
| 2 | `incidente-reportar.gravedad` *(nueva)* | Gravedad | Leve, grave o fatal. Los graves y fatales se investigan. |
| 3 | `incidente-reportar.detalle` *(nueva)* | Qué pasó | Cuéntalo con claridad. Puedes dictarlo si lo autorizaste en Mis datos y privacidad. |
| 4 | `incidente-reportar.evidencia` *(nueva)* | Fotos | Una foto ayuda a entender y a corregir. Queda con tu nombre como quien reporta. |

### 6. `cambiar-de-obra`: trabajar en varias obras

- **Pantalla:** Inicio. **Lo ven:** quienes tienen `obras.ver`.
- **Manual:** `empezar/elegir-obra`.
- **Es la navegación multiobra** que pedía el encargo. Repite los pasos 1, 3 y 4 de `inicio-gestion`, para volver a verlos cuando se necesiten.

### 7. `programar-actividades`: charlas y capacitaciones

- **Pantalla:** Actividades. **Ámbito:** obra.
- **Lo ven:** quienes tienen `actividades.crear` o `actividades.planificar`.
- **Manual:** `obra/actividades`.

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | `actividades.vistas` *(nueva)* | Lista o calendario | La lista muestra lo de hoy y lo que falta completar; el calendario, el mes completo. |
| 2 | `actividades.planificar` *(nueva)* | Planificar el mes | Arma de una vez los borradores del mes. Cada responsable completa después el detalle del día. *(Solo con `actividades.planificar`; si no, se salta.)* |
| 3 | `actividades.nueva` *(nueva)* | Una actividad suelta | Para una charla o capacitación que no estaba planificada. |
| 4 | `actividades.por-completar` *(nueva)* | Por completar | Los borradores del plan que te tocan: ábrelos, escribe el tema y quedan programados. |

### 8. `subir-documentos`: guardar y versionar documentos

- **Pantalla:** Repositorio. **Lo ven:** quienes tienen `repositorio.subir`.
- **Manual:** `obra/documentos`.

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | `repositorio.carpetas` *(nueva)* | Cómo está ordenado | Por carpeta, y en **DS44 · Cumplimiento**, por sección del formulario de fiscalización. |
| 2 | `repositorio.subir` *(nueva)* | Subir un documento | La plataforma guarda el archivo y su historial de versiones. **No revisa su contenido**: que sea correcto y esté al día es responsabilidad de quien lo sube. |

### 9. `cumplimiento-obra`: qué le falta a la obra

- **Pantalla:** Detalle de obra. **Lo ven:** quienes tienen `obras.detalle`.
- **Manual:** `obra/cumplimiento`.
- **Sin "Ver recorrido" desde el manual:** la ruta `/obras/:obraId` necesita la obra. Se abre desde la ayuda.

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | `obra-detalle.avance` *(nueva)* | Avance y fases | El avance cuenta solo lo que se le exige a esta obra. Las cuatro fases son la forma en que la plataforma ordena los requisitos: un requisito cuenta en la fase que sea. |
| 2 | `obra-detalle.filtro` *(nueva)* | Filtrar por estado | Vencido, pendiente, incompleto, pendiente de firma o completado. |
| 3 | `obra-detalle.requisito` *(nueva)* | Qué falta | Cada fila dice qué falta, en palabras, y ofrece una sola acción. La plataforma muestra la evidencia registrada; no certifica que la obra cumpla. |

---

## Lo que no propongo (todavía)

- **Firma asistida:** va a cambiar con la firma asistida sin red (restricción 5). Se agrega cuando eso llegue a `pruebas`.
- **Un anuncio de lanzamiento** ("Ahora hay ayuda en cada pantalla"): los anuncios pasan antes que los obligatorios y solo hay uno por sesión, así que el primer día le quitaría el lugar a la introducción. Las introducciones ya presentan el botón de ayuda. Si lo quieres igual, propongo ponerlo en otra pantalla (Mis firmas, por ejemplo).
- **Firmar mi asistencia:** el botón solo existe si hay una actividad hoy a la que estás convocado, así que el paso se saltaría casi siempre. Ya lo cubren el paso 3 de `inicio-terreno` y el manual.

---

## Anclas a marcar

22 anclas nuevas en 8 archivos. Cada una con `ancla('…')` en el elemento y su descripción en el registro:

| Archivo | Anclas |
|---|---|
| `components/Header.tsx` | `global.obra-actual`, `global.boton-menu` |
| `components/Sidebar.tsx` | `global.menu-sesion` |
| `pages/Dashboard.tsx` | `inicio.aviso-ingreso`, `inicio.accesos`, `inicio.pendientes` |
| `pages/MySignatures.tsx` | `mis-firmas.pestanas`, `mis-firmas.lista`, `mis-firmas.avance` |
| `pages/IncidentReportar.tsx` | `incidente-reportar.tipo`, `.gravedad`, `.detalle`, `.evidencia` |
| `pages/Activities.tsx` | `actividades.vistas`, `.planificar`, `.nueva`, `.por-completar` |
| `pages/DocumentsRepository.tsx` | `repositorio.carpetas`, `repositorio.subir` |
| `pages/ObraDetalle.tsx` | `obra-detalle.avance`, `.filtro`, `.requisito` |

Marcar es agregar un atributo `data-tour`; no cambia el aspecto ni el comportamiento. Toca archivos que Benja edita seguido: si una pantalla se rediseña, el build avisa qué ancla quedó sin marcar.

## Cómo quedaría probado

- **El build:** el verificador que ya corre antes de `tsc -b` comprueba anclas, páginas del manual, versiones y validación de cada recorrido.
- **Playwright,** con la app y la API simuladas:
  - cada obligatorio se lanza para el perfil de permisos que le corresponde, y para ningún otro;
  - ninguno se lanza dos veces en una sesión;
  - a 360 px, los pasos del menú lateral se saltan y aparece el del botón de menú.
- **Manual:** "Ver recorrido" en `terreno/firmar`, `terreno/reportar`, `obra/actividades` y `obra/documentos`.
- **Todos entran como `publicado`,** salvo que prefieras pasarlos primero por dev como borrador.

---

## Preguntas

1. ¿Apruebas la lista (4 obligatorios y 5 opcionales) y sus textos? Cambiar un texto ahora es gratis; después de publicado exige subir la versión.
2. ¿`mis-firmas` obligatorio para todos, o solo para quienes no gestionan (como `inicio-terreno`)?
3. ¿Anuncio de lanzamiento sí o no? Y si va, ¿en qué pantalla?
4. ¿Entran como borrador para revisarlos en dev con la vista previa, o directamente publicados?
