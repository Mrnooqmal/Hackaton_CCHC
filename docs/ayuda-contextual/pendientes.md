# Recorridos guiados y manual: pendientes y reglas

Estado al 11 de noviembre de 2026, después de mezclar `pruebas` (`6fe165a`, firma sin conexión con
D-37) en `tours`. Los 11 recorridos están publicados. El resto del contexto está en esta carpeta:
`como-escribir-un-recorrido.md` (cómo se hace uno), `fase-5-propuesta-pasos-nuevos.md` (los textos
aprobados) y `fase-4-para-benja.md` (revisión del manual y capturas).

## Pendientes

### 1. Tres recorridos que esperaban la firma sin conexión

La firma sin conexión ya llegó, así que estos se pueden hacer. Los textos aprobados están en
`fase-5-propuesta-pasos-nuevos.md` (secciones 2b, 2c y 4). Hay que releerlos contra la app actual
antes de implementarlos: se escribieron cuando todavía existían "Preparar cuadrilla sin señal" y
el aviso para habilitar la firma, y las dos cosas se quitaron.

- **`registrar-asistencia`** (2b): pantalla Actividades, `actividades.crear`, ámbito obra. Es nuevo y
  entra en borrador.
- **`mis-actividades`** (2c): pantalla Actividades, para quien tiene `actividades.ver` y no
  `actividades.crear`, ámbito obra. Es nuevo y entra en borrador. Depende además de que el botón
  "Firmar mi asistencia" se muestre según un permiso y no según el nombre del rol (hoy usa
  `rol === 'trabajador'`; ver `fase-4-para-benja.md`).
- **Pasos nuevos de `mis-firmas`** (4): "Pendientes e historial" con el comprobante, y "Tu PIN es tu
  firma". Está publicado, en la versión 2: al cambiarlo sube a la 3.

### 2. Revisión normativa de la sección FUF y DS 44

Las 4 páginas de `Frontend/src/manual/content/fuf/` llevan `revision: pendiente-normativa`. Las
revisa alguien con criterio normativo, y la revisión la coordina Adrean. Mientras tengan la marca, no
entran al build de prod (en dev se ven): no aparecen en el menú ni en el buscador, los enlaces a ellas
se muestran como texto y la fila de la portada no se muestra.

Para publicarlas, después de la revisión:
- Quitar de cada página el frontmatter y el aviso `:::warning[Pendiente de revisión normativa]`.
- Ajustar `Frontend/tests/e2e/manual-prod.spec.mjs`, que hoy exige que FUF no esté en prod.
- Revisar que `fuf/firmas.md` siga calzando con la firma sin conexión y con Firmas en revisión.

### 3. Capturas del manual (Benja)

Las resuelve Benja; no se regeneran ni se publican sin él. El detalle está en `fase-4-para-benja.md`,
en "Capturas del manual: datos y cómo rehacerlas":
- Hay capturas con nombres y RUT que pueden ser de personas reales. Hay que revisar las 88.
- Faltan las de las pantallas nuevas.
- El script `npm run capturas` las genera con datos inventados.

## Cómo revisar los recorridos en local

```bash
cd Frontend
VITE_API_URL=<API de dev> npm run dev -- --port 5173 --strictPort
npm run recorridos:listar                # cada recorrido con su ruta de vista previa
```

- **API:** la URL de la API de dev es una salida del stack de dev; es la misma que usa
  `infra/desplegar-frontend.sh`. El CORS de dev acepta `http://localhost:5173`, por eso el puerto es
  fijo.
- **Usuarios:** se entra con una empresa de prueba, nunca con datos reales. QA nunca prueba en la URL
  de prod.
- **Vista previa:** se abre con `<ruta>?recorrido=<id>&previa=1`. Muestra también los borradores y no
  guarda progreso.

## Comprobaciones antes de entregar

- **Verificación de recorridos:** `npm run recorridos:verificar`. Si cambió el contenido de un
  recorrido, primero `VITE_AMBIENTE=dev npm run recorridos:huellas`.
- **Pruebas del frontend:** `npm test` en `Frontend` y `npm run test:e2e`.
- **Pruebas del backend:** `npm test` en `Backend`. Ahí hay pruebas de los recorridos
  (`ayuda-recorridos-iniciales.test.js`).
- **Una a la vez:** en la máquina de Adrean, los builds en paralelo se cortan por falta de memoria.

## Reglas acordadas

- **Borradores.** Un recorrido nuevo entra en `estado: 'borrador'`. Queda fuera del build de prod,
  y en dev se revisa con la vista previa. Se publica cuando Adrean (y Benja, si toca) lo revisan en
  dev. Mientras es borrador, se corrige sin subir la versión.
- **Versiones.** Si cambia el contenido de un recorrido publicado, sube su `version`; la verificación
  no deja pasar el build si no. Con `reiniciarAlPublicar: false`, quien ya lo vio no lo vuelve a ver.
- **Ámbito obra.** Si la pantalla solo muestra su contenido dentro de una obra (`requiereObra` en el
  registro), el recorrido va con `ambito: 'obra'`. La validación lo exige.
- **Solo lo de la pantalla.** Un recorrido específico muestra solo las partes de su pantalla que
  sirven para esa tarea. La barra lateral, el encabezado y lo general van solo en las tres
  introducciones de Inicio.
- **Por permiso, no por rol.** `visibleSi` usa permisos; cada empresa ajusta sus roles.
- **Anclas.** Siempre con `ancla('pantalla.elemento')` del registro; nunca `data-tour` a mano. Los
  textos van en texto plano, sin HTML, y no prometen cumplimiento legal.
- **Datos.** El progreso de los recorridos es dato personal (D-33). En el backend, `tenantId` y
  `personaId` salen de `conSesion`, nunca del cuerpo ni de la consulta. No se suman recursos al
  backend sin avisar a Adrean. Las pruebas no llaman a AWS real.
- **Git.** Las sesiones no commitean ni pushean: lo hace Adrean.
