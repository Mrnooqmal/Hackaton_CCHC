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
  normativa** (la coordina Adrean): mientras tenga la marca, queda fuera del build de prod (en dev
  se ve) y los enlaces a ella desde otras páginas se muestran como texto.
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
| `pages/IncidentReportar.tsx` | `incidente-reportar.tipo`, `.datos`, `.afectados`, `.detalle`, `.evidencia`, `.envio` | Selector Hallazgo/Incidente y las `FieldSection` (prop `ancla`). `.afectados` va en las dos secciones de afectados (la del incidente y la del hallazgo de acción subestándar); `.envio`, en "Confirmación de envío" |
| `pages/Incidents.tsx` | `incidentes.pestanas`, `.filtros`, `.lista` | Pestañas Listado/Estadísticas (`tabsAncla`), barra de hallazgos/incidentes con buscador y filtros, lista de eventos |
| `pages/Activities.tsx` | `actividades.vistas`, `.planificar`, `.nueva`, `.por-completar`, `.buscar` | Pestañas Lista/Calendario (`tabsAncla`), botones Planificar mes y Nueva actividad, sección "Del plan, por completar", buscador con el filtro por tipo |
| `pages/DocumentsRepository.tsx` | `repositorio.ambito`, `.buscar`, `.carpetas`, `.ds44`, `.subir` | Pestañas General/Personal (`tabsAncla`), buscador, grilla de carpetas, botón de la carpeta DS44 · Cumplimiento, botón Subir documento |
| `components/obra/ObraCabecera.tsx` | `obra-detalle.pestanas`, `.exportar` | Pestañas Resumen/Cumplimiento DS 44, botón Exportar FUF |
| `components/obra/Ds44Fases.tsx` | `obra-detalle.avance`, `.filtro`, `.requisitos`, `.modulos` | Avance con las fases, filtro por estado, lista de requisitos, columna "Módulos de la fase" |
| `ayuda/MenuAyuda.tsx` | `menu-ayuda.recorridos`, `.manual`, `.novedades` | Los tres grupos del menú de ayuda |

`PageHeader` y `FieldSection` tienen ahora una prop opcional (`tabsAncla` y `ancla`) para esto; no
cambia nada cuando no se usa.

Los 11 recorridos se **publicaron** el 8 de noviembre de 2026, después de la revisión de Adrean
en dev. Desde ahora, cambiar el contenido de uno exige subir su versión; uno nuevo empieza en
borrador y se revisa en dev con `/?recorrido=<id>&previa=1` (la ruta la da
`npm run recorridos:listar`).

## Firma sin conexión

**Manual actualizado (8 de noviembre de 2026)** con el comportamiento final: sin señal siempre se
firma con el PIN; si la persona ya escribió su PIN con señal en ese equipo, el error de tipeo se
detecta al momento, y si no, se valida al volver la señal (si estaba mal, tiene que firmar de
nuevo); las firmas se envían solas y se ve cuántas quedan. Páginas: `terreno/firmar` (Sin
conexión), `obra/pedir-firmas` (Sin señal en terreno y Firmas en revisión) y la pregunta de
`obra/actividades`. El PIN sigue siendo de 4 dígitos.

Quedan para después:

- Los recorridos `registrar-asistencia` y `mis-actividades`, y los pasos nuevos de `mis-firmas`
  (el comprobante y "Tu PIN es tu firma").
- Las capturas de las pantallas nuevas (Firmas en revisión y el aviso de firmas por enviar). Las
  resuelves tú: ver "Capturas del manual: datos y cómo rehacerlas".

## Capturas del manual: datos y cómo rehacerlas

Las capturas las resuelves tú (decisión de Adrean, 8 de noviembre de 2026). Nadie las regeneró ni las
reemplazó.

### Posibles datos reales

Algunas capturas publicadas muestran nombres y RUT que pueden ser de personas reales. No pude
confirmar si lo son. El manual se abre sin sesión, así que conviene resolverlo antes de prod. Aquí
van solo los archivos, para no repetir esos datos en el repositorio. Están en
`Frontend/public/manual-img/`.

| Imagen | Qué se ve |
| --- | --- |
| `firmas/firma-asistida.png` | Nombre completo y RUT de una persona |
| `firmas/firma-asistida-pin.png` | Nombre de pila de esa misma persona, y el documento que firma |
| `personas/menu-persona.png` | Tarjetas de varias personas, con nombre completo y RUT |
| `guia-inicio/crear-pin-nuevo.png` | Nombre completo y RUT de quien está en sesión |
| `firmas/firmar.png` | Nombre completo de quien solicita la firma |
| `firmas/mis-firmas.png` | Nombre completo de quien solicita la firma y de quien está en sesión |

**Hay que revisar las 88.** Solo abrí 8: las seis de arriba, `firmas/historial.png` y
`guia-inicio/enrolamiento-pin.png`. En esas dos últimas no vi nombres ni RUT.

### El script: `npm run capturas`

Genera las capturas de firma y PIN con la app real y la API simulada: datos inventados y sin salir a
internet, salvo las tipografías. Hace falta tener Chromium para Playwright, una vez por equipo:
`./node_modules/.bin/playwright install chromium`.

```bash
cd Frontend
npm run capturas                         # deja las imágenes en test-results/capturas
npm run capturas -- -g firmas/firmar     # solo una
CAPTURAS_PUBLICAR=1 npm run capturas     # reemplaza las de public/manual-img
```

- **Salida:** cada captura sale en escritorio (`<archivo>.png`, 1440x900) y a 360 px
  (`<archivo>-360.png`). El manual muestra una sola imagen por captura, así que hay que decidir dónde
  usar las de 360 px.
- **Qué cubre:** solo lo que está en `Frontend/tests/capturas/catalogo.mjs`: cinco imágenes de
  `firmas/` y tres de `guia-inicio/`, más tres nuevas. No cubre `personas/menu-persona.png` ni el
  resto de las 88. Para sumar una, se agrega una entrada al catálogo; los datos están en
  `api-simulada.mjs`.
- **Las nuevas (`por-enviar`, `no-se-valido`, `en-revision`):** se omiten hasta que la firma sin
  conexión llegue a `tours`, y desde ahí corren solas. Las imágenes nuevas no están enlazadas en el
  manual todavía.
- **Falla a propósito** si lo marcado en rojo está tapado o si la app da un error. Contra `pruebas`
  (`8d95d6b`), `firmas/por-enviar` falla porque el encabezado de la página tapa el aviso de firmas por
  enviar en Mis Firmas y Actividades; ese error ya está avisado a la otra sesión.
- **Mira las imágenes** antes de publicar: que la corrida pase no garantiza que la captura sirva.

## Pendiente: "Firmar mi asistencia" según un permiso

En `pages/Activities.tsx`, el botón **Firmar mi asistencia** se muestra según el nombre del rol
(`canSelfSign = user?.rol === 'trabajador'`), no según un permiso. La regla del proyecto es
segmentar por permiso: un rol personalizado de la empresa que asiste a charlas no ve el botón, y
un trabajador al que le dan más permisos lo sigue viendo por su nombre de rol. Debería depender
de un permiso (por ejemplo, uno de "firmar mi asistencia", o `actividades.ver` sin
`actividades.crear`).

Lo mismo pasa en `pages/DocumentsRepository.tsx` (`canViewGeneral = user?.rol !== 'trabajador'`,
que decide si se ve la pestaña General o solo "Mis documentos").

El recorrido `mis-actividades` (pendiente, ver abajo) se segmenta con "ve actividades y no las
crea", que es lo más cercano mientras tanto. Decisión de Adrean (8 de noviembre de 2026):
anotarlo aquí para Benja.

## Pendiente: recorridos que esperan la firma sin conexión

Aprobados el 8 de noviembre de 2026, pero se escriben cuando la firma sin conexión llegue a
`pruebas` (cambia el registro de asistencia y Mis firmas). Los textos propuestos están en
`fase-5-propuesta-pasos-nuevos.md`:

- `registrar-asistencia` (2b): lo de hoy, quién falta, historial.
- `mis-actividades` (2c): firmar la asistencia y el atraso.
- `mis-firmas`: el paso 1 con el comprobante y el paso nuevo "Tu PIN es tu firma".

## Direcciones viejas

Las 33 direcciones anteriores siguen funcionando y llevan a la página nueva, con su sección
(`Frontend/src/manual/redirecciones.ts`). Si renombras una página nueva, agrega la redirección ahí:
`npm test` falla si una dirección vieja queda sin destino o si un enlace del manual se rompe.
