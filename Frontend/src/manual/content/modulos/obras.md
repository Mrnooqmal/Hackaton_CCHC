# Obras

Una **obra** es cada proyecto de construcción que gestionas dentro de la plataforma.
Es el punto de partida de todo tu trabajo: dentro de una obra viven sus documentos de
seguridad, las personas asignadas, las actividades, los incidentes y el seguimiento del
cumplimiento del DS 44.

Piensa en la obra como la "carpeta madre" de un proyecto. Mientras no tengas al menos
una obra creada, no podrás cargar documentos, asignar trabajadores ni registrar
capacitaciones. Por eso, **lo primero que harás al empezar es crear tu obra**.

> 💡 **¿Quién puede crear obras?** Solo los roles **Administrador** y **Prevencionista**.
> Si tu rol es Jefe de Obra, Supervisor o Trabajador, podrás ver y trabajar dentro de las
> obras a las que te asignen, pero no crear nuevas. Revisa [Roles de Usuario](/roles/)
> para ver el detalle de permisos.

## Entrar al módulo de Obras

1. Inicia sesión en la plataforma.
2. En el **menú lateral izquierdo**, haz clic en **Obras**.
3. Se abrirá la pantalla **Obras**, con el subtítulo *"Proyectos activos, documentos DS44
   y personal asignado"*.

![Listado de obras en vista de tarjetas, con el botón Nueva obra arriba a la derecha](/img/obras/listado.png)

Aquí verás todas las obras de tu empresa. Cada obra se muestra como una **tarjeta** con:

- La **foto** de la obra (si se cargó una; si no, aparece una imagen por defecto).
- El **nombre** del proyecto.
- Una etiqueta de **estado** de color: verde (**Activa**), amarillo (**Pausada**) o gris
  (**Finalizada**).
- La **comuna y región** donde se ubica.
- Un indicador rojo de **DS44 pendientes** cuando a la obra le faltan documentos
  obligatorios. Si está todo al día, no aparece la alerta.

### Buscar y filtrar obras

Cuando tengas muchas obras, usa las herramientas de la parte superior del listado:

- **Buscador:** escribe en el campo *"Buscar por nombre, código o dirección…"* para
  filtrar al instante.
- **Filtro por estado:** el desplegable te permite mostrar **Todos los estados**,
  **Activas**, **Pausadas** o **Finalizadas**.
- **Vista:** puedes alternar entre **vista de tarjetas** (con foto) y **vista de tabla**
  (más compacta, ideal para revisar muchas obras de un vistazo).

> 📌 Si recién creaste tu empresa y todavía no hay obras, verás el mensaje
> *"Sin obras registradas"* con un botón directo para crear la primera.

## Crear una obra nueva

1. En la pantalla **Obras**, haz clic en el botón **+ Nueva obra** (arriba a la derecha).
2. Se abrirá el formulario **Nueva obra**, dividido en secciones. Complétalas de arriba
   hacia abajo.

![Formulario de creación de obra con las secciones Identificación, Ubicación y Características DS44](/img/obras/nueva-obra.png)

### Sección "Identificación"

- **Nombre de obra** *(obligatorio)* — el nombre con el que identificarás el proyecto.
  Por ejemplo: *"Torre Costanera Norte"*.
- **Código** *(opcional)* — un código interno de tu empresa, si usas alguno (ej.: *"OBR-001"*).
- **Mandante** — se completa **automáticamente** con el nombre de tu empresa. Normalmente
  no necesitas modificarlo.
- **Estado** — elige entre **Activa**, **Pausada** o **Finalizada**. Al crear una obra
  nueva, lo habitual es dejarla en **Activa**.

### Sección "Ubicación"

- **Región** *(obligatorio)* — selecciona la región desde el desplegable (puedes escribir
  para buscarla más rápido).
- **Comuna** *(obligatorio)* — se habilita una vez que eliges la región, y muestra solo las
  comunas de esa región.
- **Dirección** *(obligatorio)* — empieza a escribir y el sistema te sugerirá direcciones
  para que selecciones la correcta.

### Sección "Características DS44"

Aquí marcas las casillas que correspondan a tu obra. **Estas respuestas definen qué
exigencias del DS 44 aplican**, para que la plataforma no te pida documentos que tu obra
no necesita:

- ☐ **Comparte sitio con otra(s) entidad(es)** — faena compartida (Art. 20).
- ☐ **Hay máquinas / herramientas motrices** (Art. 10).
- ☐ **Existen agentes físicos, químicos o biológicos** (Art. 2).

> ✅ Tómate un momento para responder bien estas casillas: de ellas depende qué
> procedimientos y documentos te pedirá el sistema más adelante. Si tu situación cambia,
> podrás ajustarlas después desde la obra.

### Sección "Imagen de referencia" (opcional)

Haz clic en **Seleccionar imagen** para subir una foto del terreno o de la obra. Es solo
referencial (te ayuda a identificarla en el listado), pero no es obligatoria.

### Sección "Trabajadores asignados" (opcional)

Verás la lista de personas registradas en tu empresa. **Marca las casillas** de quienes
trabajarán en esta obra desde el inicio. No te preocupes si todavía no lo tienes claro:
podrás agregar o quitar personas en cualquier momento desde la ficha de la obra.

### Guardar

Cuando completes los campos obligatorios, haz clic en **Crear obra** (mientras se procesa
verás *"Creando…"*). Si prefieres descartar, usa **Cancelar**.

> ⚙️ **Qué pasa al guardar:** la plataforma **prepara automáticamente los documentos
> obligatorios** que el DS 44 exige según las características que marcaste. No tienes que
> crearlos uno por uno: ya quedan listos, esperando que subas los archivos correspondientes.

## Abrir la ficha de una obra

Haz clic sobre cualquier obra del listado para abrir su **ficha de detalle**. Dentro
encontrarás tres pestañas en la parte superior:

![Ficha de detalle de una obra mostrando las pestañas Resumen, DS44 — Cumplimiento y Equipo](/img/obras/ficha-detalle.png)

- **Resumen** — una vista rápida del estado de la obra: firmas pendientes, documentos
  DS44 pendientes, actividades del mes e incidentes abiertos.
- **DS44 — Cumplimiento** — el corazón de la obra. Aquí gestionas todo el cumplimiento
  normativo paso a paso (ver más abajo).
- **Equipo (N)** — las personas asignadas a la obra. El número entre paréntesis indica
  cuántas hay activas. Desde aquí asignas o quitas trabajadores y revisas su onboarding.

> 📋 Junto al nombre de la obra hay un pequeño botón para **copiar su identificador**.
> Solo lo necesitarás si algún día el soporte te lo pide; en el uso diario puedes ignorarlo.

## La pestaña "DS44 — Cumplimiento" (el ciclo de mejora)

El cumplimiento de una obra **no avanza por etapas de construcción**, sino por un **ciclo
de mejora continua** dividido en cuatro fases que se completan en orden:

```
PLANIFICAR  →  HACER  →  VERIFICAR  →  ACTUAR
```

- **Planificar** — cargas los documentos base de la obra (política, reglamento, matrices
  de riesgo, etc.). Cuando están todos, la obra avanza sola a la siguiente fase.
- **Hacer** — ejecutas lo planificado: onboarding de los trabajadores, procedimientos,
  capacitaciones y firmas.
- **Verificar** — revisas que todo se haya cumplido y dejas el registro consolidado.
- **Actuar** — das seguimiento a las medidas correctivas surgidas de incidentes.

Para pasar de una fase a la siguiente, completa lo que la fase pide y usa el botón de
**avanzar fase** que aparece en pantalla. El sistema **no te dejará avanzar dejando
pendientes obligatorios**, para que no queden vacíos de cumplimiento.

> ⚠️ Avanzar de fase es un paso importante del proceso. Asegúrate de haber completado
> realmente lo que corresponde antes de confirmar.

## Asignar personas a la obra

1. Abre la ficha de la obra y entra a la pestaña **Equipo**.
2. Usa la opción de **asignar trabajadores** para sumar personas de tu empresa a la obra.
3. Al asignar a alguien, podrás indicar su **cargo** dentro de esta obra. El cargo define
   qué documentos y capacitaciones de onboarding necesitará esa persona.

Cada trabajador asignado muestra su **avance de onboarding** y si ya está **apto para
ingresar a terreno** (es decir, si completó todos sus requisitos obligatorios).

## Editar, pausar o finalizar una obra

Desde la ficha de la obra puedes:

- **Editar** sus datos (nombre, ubicación, características DS44, etc.) con el botón de
  edición (ícono de lápiz).
- **Pausar** la obra cambiando su estado a *Pausada*, si los trabajos se detienen
  temporalmente. La obra conserva toda su información.
- **Finalizar** la obra cambiando su estado a *Finalizada* cuando el proyecto concluye.

## Preguntas frecuentes

**¿Puedo tener varias obras al mismo tiempo?**
Sí. Tu empresa puede gestionar todas las obras que necesites de forma simultánea, cada una
con su propio cumplimiento, equipo y documentos.

**No veo el botón "+ Nueva obra".**
Ese botón solo aparece para los roles **Administrador** y **Prevencionista**. Si no lo ves,
es porque tu rol no tiene permiso para crear obras. Pídele a un administrador que la cree y
te asigne.

**Creé la obra pero no veo los documentos.**
Los documentos obligatorios se generan solos al guardar la obra. Ábrela, entra a la pestaña
**DS44 — Cumplimiento** y los verás listados, esperando que subas cada archivo.

**¿Por qué a mi obra le aparece una alerta roja de "DS44 pendientes"?**
Significa que faltan documentos obligatorios por cargar. El número indica cuántos. Entra a
la pestaña **DS44 — Cumplimiento** para completarlos; cuando estén todos, la alerta desaparece.

**Me equivoqué al marcar las características DS44 al crear la obra.**
Puedes corregirlas editando la obra desde su ficha. Ten en cuenta que cambiarlas puede
modificar qué documentos te exige el sistema.

**El sistema no me deja avanzar de fase.**
Es intencional: quedan requisitos obligatorios sin completar en la fase actual. Revisa qué
está pendiente en la pestaña **DS44 — Cumplimiento**, complétalo y vuelve a intentar.

**¿Qué diferencia hay entre pausar y finalizar una obra?**
**Pausar** es temporal: la obra se detiene pero puedes retomarla. **Finalizar** marca el
cierre del proyecto. En ambos casos la información se conserva y puedes consultarla.
