# Fase 5 · Propuesta de pasos nuevos

> **Estado (8 de noviembre de 2026):** aprobada por Adrean. Implementado, en borrador:
> `encontrar-documentos`, `subir-documentos`, `programar-actividades` con el buscador,
> `cumplimiento-obra` con 6 pasos, `reportar` con 6 pasos y `gestionar-incidentes`.
> **Pendientes hasta que la firma sin conexión llegue a `pruebas`:** `registrar-asistencia` (2b),
> `mis-actividades` (2c) y los pasos nuevos de `mis-firmas` (4). El paso de Investigaciones de
> Incidentes se queda. Los formularios no se recorren (el manual los cubre).
>
> Ajustes al implementar: el paso de afectados de Reportar aparece en un incidente y, en un
> hallazgo, solo al elegir acción subestándar (así es la pantalla). "Revisar y enviar" dice que se
> marca la declaración y que se avisa al equipo de prevención, que es lo que muestra el formulario.
> El buscador de Actividades busca por título o descripción y filtra por tipo.

Pedido de Adrean (2026-11-08): los recorridos de las pantallas más completas se quedan cortos.
Se revisó pantalla por pantalla lo que de verdad muestra (código del worktree `tours` + manual).

Reglas que se mantienen:

- Solo lo de esa pantalla y esa tarea. Nada de barra lateral, encabezado ni cambio de obra.
- Todo sigue en **borrador**.
- El motor no hace clic por la persona. Solo puede señalar lo que está a la vista en la pantalla tal como abre. Lo que vive dentro de un formulario, una pestaña no activa o un panel cerrado se explica en el texto del paso que lo abre, sin apuntarlo.
- Un paso cuya ancla no está (por permiso o porque no hay datos) se salta, y el contador ya no lo cuenta.

Leyenda: 🆕 recorrido o paso nuevo · ✏️ texto cambiado · = sin cambios · ⚓ ancla nueva que hay que marcar.

---

## 1. Repositorio → dividir en dos

Hoy hay un solo recorrido (`subir-documentos`), y solo lo ve quien puede subir. No explica las pestañas General y Personal, el buscador ni la carpeta DS44. Propuesta: uno para **encontrar** (lo ve todo el que entra al repositorio) y otro para **subir** (solo quien sube).

### 1a. 🆕 `encontrar-documentos` · `repositorio.ver` · ámbito obra · opcional

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | ⚓ `repositorio.ambito` (pestañas del encabezado) | General o Personal | En General están los documentos de la obra y de la empresa. En Personal, solo los que te asignaron a ti para leer o firmar. Si solo ves Mis documentos, esos son los tuyos. |
| 2 | ⚓ `repositorio.buscar` | Buscar | Escribe parte del nombre y busca en todo el repositorio, sin abrir carpeta por carpeta. |
| 3 | `repositorio.carpetas` | Las carpetas | Empresa, obra, registros y actividades, documentos de personas y otros. Solo aparecen las que tienen algo. Dentro de cada una, el ojo abre el documento y la flecha lo descarga. |
| 4 | ⚓ `repositorio.ds44` (botón de la carpeta DS44) | DS44 · Cumplimiento | No es una carpeta de archivos: es el formulario de fiscalización, ordenado por sección. Muestra qué documento acredita cada requisito, de esta obra o de la empresa, y qué falta. |

El paso 4 no aparece en Personal ni para quien no ve el general, porque ahí no está esa carpeta.

### 1b. ✏️ `subir-documentos` · `repositorio.subir` · ámbito obra

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | `repositorio.subir` | ✏️ Subir un documento | Elige el tipo, ponle un título y adjunta el archivo (hasta 10 MB). Según el tipo, queda en su carpeta. La plataforma no revisa el contenido: que sea correcto y esté al día es responsabilidad de quien lo sube. |
| 2 | ⚓ `repositorio.ds44` | 🆕 Una versión nueva, no otro archivo | Si un documento del formulario se renueva, no subas uno aparte. Ábrelo desde DS44 · Cumplimiento y usa Publicar nueva versión: así queda el historial y se vuelve a pedir la firma. |

El paso "Cómo está ordenado" sale de este recorrido y pasa a 1a.

---

## 2. Actividades → dividir en tres

El recorrido actual (`programar-actividades`) cubre solo la planificación. No cubre "Hoy", el registro de asistencia, el historial ni el buscador. Tampoco hay nada para quien solo asiste.

### 2a. ✏️ `programar-actividades` · `actividades.crear` o `actividades.planificar` · ámbito obra

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | `actividades.vistas` | = Lista o calendario | (sin cambios) |
| 2 | `actividades.planificar` | = Planificar el mes | (sin cambios) |
| 3 | `actividades.nueva` | = Una actividad suelta | (sin cambios) |
| 4 | `actividades.por-completar` | = Por completar | (sin cambios) |
| 5 | ⚓ `actividades.buscar` | 🆕 Buscar | Encuentra una actividad de hoy o del calendario por su título, tema o tipo. |

### 2b. 🆕 `registrar-asistencia` · `actividades.crear` · ámbito obra

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | ⚓ `actividades.hoy` | Lo de hoy | Las actividades programadas para hoy. Con Registrar asistencia, cada asistente firma en tu equipo con su propio PIN, que nadie más ve. |
| 2 | ⚓ `actividades.hoy` | Quién falta | Ver pendientes muestra quién no ha firmado. Ahí también anotas una ausencia justificada. Se puede firmar todo el día; después de la hora de inicio queda como atraso. |
| 3 | ⚓ `actividades.historial` | Historial | Lo ya realizado, por 7 días, 30 días o entre dos fechas. Desde cada fila ves el reporte o lo descargas en PDF. |

> ⚠️ **Esperar a la otra sesión.** El registro de asistencia cambia con la firma sin conexión: vales, revisión de firmas tardías y "Preparar cuadrilla sin señal" (esta última se va a quitar de la app; decisión del 8 de noviembre de 2026). Ya están en el árbol principal, sin commitear, en `Activities.tsx`. Propongo escribir 2b cuando eso llegue a `pruebas`, para no explicar un flujo que cambia. El texto de arriba es el del flujo actual.

### 2c. 🆕 `mis-actividades` · `actividades.ver` sin `actividades.crear` · ámbito obra

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | ⚓ `actividades.hoy` | Tus charlas de hoy | Las charlas y capacitaciones de hoy en tu obra. Si te convocaron, toca Firmar mi asistencia y escribe tu PIN. |
| 2 | ⚓ `actividades.hoy` | Si llegas tarde | Puedes firmar durante todo el día. Si firmas después de la hora de inicio, el reporte lo marca como atraso, pero tu firma vale. |

> ⚠️ Esto depende de la misma condición que 2b. Además, "Firmar mi asistencia" hoy se muestra según el nombre del rol (`rol === 'trabajador'`), no según un permiso. Por eso el recorrido se segmenta con "ve actividades y no crea", que es lo más cercano. Si te parece, lo dejamos como pendiente para Benja.

---

## 3. Detalle de obra · `cumplimiento-obra` → un solo recorrido, ampliado a 6 pasos

No se divide. Todo pasa en la pestaña Cumplimiento DS 44, que es la que abre por omisión, y son 6 pasos cortos. El recorrido actual no cubre los módulos de la fase, la exportación del FUF ni las acciones de cada requisito.

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | ⚓ `obra-detalle.pestanas` | 🆕 Resumen y cumplimiento | En Resumen están los datos de la obra, su dotación y el órgano preventivo que le exige el DS 44. Aquí, en Cumplimiento, está lo que se le pide y en qué va cada requisito. |
| 2 | `obra-detalle.avance` | ✏️ Avance y fases | El avance cuenta solo lo que se le exige a esta obra. La fase En curso pasa sola a la siguiente cuando se completa, y puedes resolver requisitos de cualquier fase cuando quieras. |
| 3 | `obra-detalle.filtro` | = Filtrar por estado | (sin cambios) |
| 4 | `obra-detalle.requisitos` | ✏️ Qué falta | Cada fila dice qué falta y ofrece una sola acción: Cargar el documento, elegir Firmantes, Recordar a quien no firma, Registrar un envío o responder Sí o No. La plataforma muestra la evidencia; no certifica que la obra cumpla. |
| 5 | ⚓ `obra-detalle.modulos` | 🆕 Módulos de la fase | Aquí se registra el trabajo de cada día: estructura preventiva, registro de actividad, investigaciones, medidas correctivas. Lo que registras acredita los requisitos de al lado. |
| 6 | ⚓ `obra-detalle.exportar` | 🆕 Exportar FUF | Abre el reporte imprimible del formulario de fiscalización, con el estado de cada requisito. Útil para tenerlo a mano en una fiscalización. |

El paso 6 se salta solo cuando no hay empresa activa, porque en ese caso el botón no aparece.

---

## 4. Mis firmas · `mis-firmas` → ampliar con un paso

La pantalla en sí es chica. Lo que faltaba es lo que más se pregunta.

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | `mis-firmas.pestanas` | ✏️ Pendientes e historial | En Pendientes está lo que espera tu firma. En Historial, todo lo que ya firmaste: tócalo para ver su detalle y descargar el comprobante. |
| 2 | `mis-firmas.lista` | = Cómo se firma | (sin cambios) |
| 3 | `mis-firmas.avance` | = Tu avance | (sin cambios) |
| 4 | (sin ancla, globo centrado) | 🆕 Tu PIN es tu firma | No lo compartas. Si lo olvidas, un administrador lo restablece y tú creas uno nuevo en Configuración. Una firma no se deshace; si te equivocaste, avisa al prevencionista. |

> ⚠️ Mis firmas también cambia con la firma sin conexión (aviso de vales, firmas en revisión). Propongo implementar ahora solo el paso 1 y el 4, y revisar el recorrido entero cuando eso llegue a `pruebas`.

---

## 5. Reportar · `reportar` → ampliar a 6 pasos

Faltaban los afectados y el envío.

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | `incidente-reportar.tipo` | = ¿Hallazgo o incidente? | (sin cambios) |
| 2 | `incidente-reportar.datos` | = Qué y dónde | (sin cambios) |
| 3 | ⚓ `incidente-reportar.afectados` | 🆕 Quién resultó afectado | Opcional. Búscalo por nombre o RUT; si fueron varios, agrégalos uno por uno. |
| 4 | `incidente-reportar.detalle` | = Qué pasó | (sin cambios) |
| 5 | `incidente-reportar.evidencia` | ✏️ Fotos | Una foto ayuda a entender y a corregir. Súbela o tómala con la cámara del teléfono. |
| 6 | ⚓ `incidente-reportar.envio` | 🆕 Revisar y enviar | Revisa el resumen y envía. El reporte queda con tu nombre, y quien gestiona la obra lo revisa y le da seguimiento. |

---

## 6. 🆕 Incidentes (listado) · `gestionar-incidentes` · `incidentes.historial` · ámbito obra

Pantalla nueva en los recorridos. Es donde se gestiona lo reportado, y hoy no tiene guía.

| # | Ancla | Título | Texto |
|---|---|---|---|
| 1 | ⚓ `incidentes.pestanas` | Listado y estadísticas | En Listado están los eventos de la obra. En Estadísticas, los totales, la tasa de accidentabilidad y la tendencia, para descargar en CSV o PDF. |
| 2 | ⚓ `incidentes.filtros` | Encontrar un evento | Busca por descripción y filtra por gravedad, por abiertos o cerrados y por etapa. |
| 3 | ⚓ `incidentes.lista` | Gestionar un evento | Tócalo para ver su detalle. Ahí defines el responsable, el plazo y el cierre, y quien tiene el permiso lo califica como accidente. |
| 4 | ⚓ `incidentes.lista` | Investigaciones | Los graves y fatales se investigan. La investigación y sus medidas se registran en Detalle de obra, en las fases Verificar y Actuar. |

> El paso 4 nombra otra pantalla. Lo dejé porque es la respuesta a "¿dónde investigo esto?", que nace en esta tarea. Si prefieres no hacerlo, lo quito.

---

## Fuera de esta propuesta (por ahora)

- **Encuestas, Equipo, Personas y Mi Empresa:** no se revisaron a fondo; no estaban en la lista y no son de las más usadas en terreno. Si quieres, van en una segunda tanda.
- **Formularios que se abren con un botón** (Nueva actividad, Subir documento, el detalle de un requisito): el motor no los abre. Explicarlos campo por campo requeriría que el recorrido haga clic, y eso es una capacidad nueva del motor. No la propongo; el manual cubre esos formularios.

## Resumen del trabajo si se aprueba todo

- Recorridos: 4 ampliados y 4 nuevos (2b y 2c, si se esperan, quedan para después).
- Anclas nuevas: 14 (`repositorio.ambito`, `.buscar`, `.ds44`; `actividades.buscar`, `.hoy`, `.historial`; `obra-detalle.pestanas`, `.modulos`, `.exportar`; `incidente-reportar.afectados`, `.envio`; `incidentes.pestanas`, `.filtros`, `.lista`). Las tres de `incidentes` necesitan que la pantalla se agregue al registro.
- Todo en borrador, con pruebas e2e por recorrido nuevo, la tabla de anclas para Benja actualizada y sin cambios en el backend.
