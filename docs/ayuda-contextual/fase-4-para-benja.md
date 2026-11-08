# Manual por tarea: lista para revisar

**Para Benja.** El manual se reorganizó por tarea (propuesta aprobada en
`fase-4-propuesta-manual.md`). Tu revisión de octubre se conservó: casi todo el texto y todas las
capturas se **movieron**, no se reescribieron. Esto es lo que conviene revisar antes de que llegue a
`pruebas`.

## Capturas nuevas

Marcadas en el markdown como comentario `<!-- CAPTURA PENDIENTE (Benja): … -->`. No se ven en la
página ni en el buscador.

| Página | Captura | Archivo sugerido |
|---|---|---|
| `empezar/ayuda` | Menú de ayuda abierto, con sus tres grupos | `/img/ayuda/menu-ayuda.png` |
| `empezar/ayuda` | Un paso de un recorrido, con el elemento resaltado y el globo | `/img/ayuda/recorrido-paso.png` |
| `terreno/mis-datos` | Mis datos y privacidad, pestaña Consentimientos | `/img/mis-datos/consentimientos.png` |

Al agregar cada una, reemplaza el comentario por la imagen.

## Texto nuevo (escrito desde cero)

- `empezar/index`: qué es y **qué no hace** (no redacta, no revisa contenido, no verifica roles, no
  garantiza cumplimiento).
- `empezar/ayuda`: el botón de ayuda, los recorridos y las novedades.
- `terreno/mis-datos`: consentimientos, copia de datos y solicitudes del titular (pantalla
  `/mis-datos`).
- `roles/*`: cada página de rol es ahora una lista de tareas con enlace.
- `fuf/index`: reescrita. Planificar, Hacer, Verificar, Actuar queda como **esquema propio de la
  plataforma**, no como estructura del decreto. **Toda la sección FUF y DS 44 espera revisión
  normativa** (la coordina Adrean): mientras tenga la marca, el build de prod falla.
- Introducciones cortas en las páginas que juntan contenido de varias.
- `terreno/firmar`: sección "Firmar tu asistencia a una actividad" (antes estaba dentro de
  Actividades).
- `terreno/reportar`: "Hallazgo, incidente o accidente" (antes era una pregunta frecuente) y el
  aviso de que dictar necesita autorización.

## Lo que se quitó

- **"Enviar una sugerencia"** de Primeros pasos: el botón está oculto
  (`SuggestionsWidget`, `MOSTRAR_BOTON = false`). Si vuelve, la sección se puede recuperar del
  historial.
- **El índice por módulo** (`modulos/index`): lo cubren la ayuda de cada pantalla y el buscador.

## Lo que se mantuvo a propósito

- La palabra **Onboarding**: es la que muestra la app (menú lateral, "Onboarding por cargo",
  "Onboarding DS 44" en la ficha). El manual la explica una vez como "incorporación".
- La frase sobre el Hackathon CChC 2025 se quitó de la portada; si debe estar en algún lado, avísame.

## Anclas de los recorridos: qué no romper

Los recorridos guiados resaltan elementos marcados con `{...ancla('…')}` (Fase 5). Si mueves o
quitas uno de estos elementos, conserva el `ancla(...)` en el elemento que cumple esa función. Si
desaparece, `npm run build` falla y dice cuál quedó sin marcar. El texto que lo describe está en
`src/ayuda/registro.ts`.

| Archivo | Anclas | En qué elemento |
|---|---|---|
| `components/Header.tsx` | `global.boton-ayuda` (vía `ayuda/MenuAyuda.tsx`), `global.boton-menu`, `global.obra-actual` | Botón de ayuda, botón de tres líneas, nombre de la obra |
| `components/Sidebar.tsx` | `global.menu-lateral`, `global.menu-sesion` | `<nav>` del menú, botón "Más opciones" |
| `pages/Dashboard.tsx` | `inicio.aviso-ingreso`, `inicio.accesos`, `inicio.pendientes` | Aviso rojo de firmas para ingresar, grilla de accesos rápidos, panel "Tus pendientes" |
| `pages/MySignatures.tsx` | `mis-firmas.pestanas`, `mis-firmas.lista`, `mis-firmas.avance` | Pestañas (prop `tabsAncla` de `PageHeader`), columna de la lista, columna de "Tu avance" |
| `pages/IncidentReportar.tsx` | `incidente-reportar.tipo`, `.datos`, `.detalle`, `.evidencia` | Selector Hallazgo/Incidente y tres `FieldSection` (prop `ancla`) |
| `pages/Activities.tsx` | `actividades.vistas`, `.planificar`, `.nueva`, `.por-completar` | Pestañas Lista/Calendario (`tabsAncla`), botones Planificar mes y Nueva actividad, sección "Del plan, por completar" |
| `pages/DocumentsRepository.tsx` | `repositorio.carpetas`, `repositorio.subir` | Grilla de carpetas, botón Subir documento |
| `components/obra/Ds44Fases.tsx` | `obra-detalle.avance`, `.filtro`, `.requisitos` | Avance con las fases, filtro por estado, lista de requisitos |
| `ayuda/MenuAyuda.tsx` | `menu-ayuda.recorridos`, `.manual`, `.novedades` | Los tres grupos del menú de ayuda |

`PageHeader` y `FieldSection` tienen ahora una prop opcional (`tabsAncla` y `ancla`) para esto; no
cambia nada cuando no se usa.

Los recorridos están en **borrador**: se revisan en dev con
`/?recorrido=<id>&previa=1` (la ruta de cada uno la da `npm run recorridos:listar`). Mientras son
borradores, sus textos se corrigen sin subir la versión.

## Pendiente: firma sin conexión

La otra sesión va a implementar la **firma sin conexión con vales**, la **firma asistida de
documentos sin red** y una pantalla **"Preparar cuadrilla sin señal"**. Cuando eso entre a
`pruebas`, hay que actualizar:

- `terreno/firmar`: la sección "Sin conexión" (hoy dice, correctamente, que firmar requiere
  conexión) y las preguntas frecuentes.
- `obra/pedir-firmas`: la firma asistida sin red y la pantalla nueva.
- `fuf/firmas`: "Firmar requiere conexión" (esta página espera además la revisión normativa).
- Las capturas de esas pantallas.

Por ahora quedan como están (decisión del 7 de noviembre de 2026).

## Direcciones viejas

Las 33 direcciones anteriores siguen funcionando y llevan a la página nueva, con su sección
(`Frontend/src/manual/redirecciones.ts`). Si renombras una página nueva, agrega la redirección ahí:
`npm test` falla si una dirección vieja queda sin destino o si un enlace del manual se rompe.
