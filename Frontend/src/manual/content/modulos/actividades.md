# Actividades y capacitación

El módulo de **Actividades** te permite programar y registrar todo lo que reúne a los
trabajadores en torno a la seguridad: **capacitaciones**, **charlas de inicio de jornada**,
**ART**, **inspecciones**, **simulacros** y otras actividades preventivas. Lo más importante
es que aquí queda el **registro de asistencia firmado**, que es la prueba de que la
capacitación efectivamente se realizó (una exigencia clave del DS 44, Art. 16).

## Entrar al módulo

En el menú lateral, haz clic en **Actividades**. Se abrirá la pantalla **"Actividades y
capacitación"**.

> Las actividades se gestionan **por obra**. Si ves el mensaje *"Seleccione una obra para
> ver sus actividades"*, elige primero la obra con la que quieres trabajar (en el selector de
> obra, normalmente arriba). Una vez seleccionada, verás sus actividades.

La pantalla ofrece **dos vistas**, que alternas con los botones **Lista** y **Calendario**:

- **Lista** — *Actividades de Hoy* (lo programado para el día, listo para registrar
  asistencia) e *Historial de Actividades* (lo ya realizado).
- **Calendario** — el mes completo de un vistazo, para coordinar la planificación
  (ver [El calendario mensual](#el-calendario-mensual)).

![Pantalla de Actividades mostrando las actividades de hoy y el historial](/img/actividades/inicio.png)

## Tipos de actividad

| Tipo | Uso |
| --- | --- |
| Charla 5 Minutos | Charla diaria de inicio de jornada |
| Análisis de Riesgos (ART) | Análisis de riesgos en terreno |
| Capacitación | Capacitaciones DS 44 (con subtipo normativo) |
| Inducción | Inducción de ingreso |
| Inspección | Inspecciones de seguridad (andamios, EPP, etc.) |
| Reunión Comité Paritario | Reuniones del CPHS |
| Simulacro de Emergencia | Simulacros programados |
| Otra actividad | Casos no contemplados; el detalle va en el título y la descripción |

## Programar una actividad nueva

1. Haz clic en el botón **Nueva actividad**.
2. Completa el formulario:
   - **Tipo de Actividad** *(obligatorio)* — según la tabla anterior.
   - **Tipo de capacitación (DS44)** *(obligatorio si es capacitación)* — el tipo específico
     que exige la normativa.
   - **Título** *(obligatorio)* — un nombre claro (ej.: *"Uso correcto de EPP"*).
   - **Descripción** *(opcional)* — de qué tratará.
   - **Relator** *(obligatorio)* — quién dictará la actividad.
   - **Fecha** *(obligatorio)* — cuándo se realizará.
   - **Periodicidad** — si es una actividad **única** o se **repite** (en cuyo caso indicas
     hasta cuándo).
   - **Hora inicio** *(obligatorio)* y **Hora fin** *(opcional)*.
   - **Ubicación** *(opcional)* — dónde se hará (ej.: *"Frente de obra, sala de charlas"*).
   - **Trabajadores** — marca quiénes deben asistir (solo aparecen los asignados a la obra).
3. Guarda. La actividad quedará programada y aparecerá en la agenda de la obra.

![Formulario de Nueva Actividad con los campos de tipo, relator y fecha](/img/actividades/nueva-actividad.png)

> Por defecto el selector de asistentes muestra **el grupo del relator** (su cuadrilla o
> las cuadrillas de sus supervisores vinculados). Si necesitas convocar a más personas,
> activa la opción de **ver toda la obra**.

### Planificación diaria (charlas y ART)

Cuando el tipo es **Charla 5 Minutos** o **ART**, el formulario agrega la sección de
**planificación diaria**, que estructura el contenido de la jornada:

- **Tema tratado** *(obligatorio)* — desplegable estandarizado (fraguado, hormigonado,
  trabajos en altura, etc.), con opción **"Otro"** para temas fuera del catálogo.
- **Recursos utilizados** *(opcional)* — equipos y herramientas (betonera, andamio,
  esmeril angular…).
- **Riesgos comunes** *(opcional)* — caída a desnivel, contacto eléctrico, exposición a
  sílice, etc.
- **Medidas de prevención** — uso de EPP, señalización, bloqueo de energías (LOTO), etc.
- **Tipo de trabajo** (interior/exterior) y **condición climática**. Si el trabajo es
  **exterior**, aparece el campo de **aplicación de protector solar** (entre septiembre y
  marzo verás además un aviso de temporada de alta radiación UV).
- **Observaciones o participación y consulta** — disponible en todos los tipos; en las
  reuniones del Comité Paritario toma el nombre *"Participación y consulta"*.

> Los desplegables de tema, recursos, riesgos y medidas se alimentan de los
> [catálogos configurables de tu empresa](#catalogos-de-actividad).

### Permisos de trabajo especiales

En la misma sección puedes marcar si la jornada involucra **trabajos en altura**,
**espacios confinados** o **trabajo en caliente**. Al marcar uno, se despliega
automáticamente su **formulario de permiso de trabajo** con:

- Checklist específico del riesgo (ej. altura: arnés inspeccionado, puntos de anclaje
  definidos, examen de altura vigente…).
- **Responsable** del permiso, horario y ubicación.

El permiso queda embebido en la actividad y aparece en el reporte posterior.

## Planificar el mes completo

En lugar de crear las actividades una a una, quien tenga el permiso de **planificación**
(Prevencionista, Jefe de Obra o quien la empresa designe) puede armar el **esqueleto del
mes** con el botón **Planificar mes**:

1. Define el **rango de fechas** (por defecto, el mes visible del calendario).
2. Agrega uno o más **ítems**, cada uno con:
   - **Tipo de actividad** y **periodicidad** (diaria de lunes a viernes, semanal o mensual).
   - **Tipo de trabajo** (etapa constructiva: excavación, obra gruesa, terminaciones,
     entrega) — para diferenciar la planificación según el trabajo real de cada supervisor.
   - **Responsables** — solo las personas a las que corresponde esa actividad (ej.: la
     inspección de andamios se asigna únicamente a quienes la realizan). Puedes seleccionar
     varios supervisores a la vez.
   - **Título base**, **hora** y **ubicación** por defecto *(opcionales)* — quedan
     pre-llenados en cada día.
3. Haz clic en **Generar planificación**.

El sistema crea una actividad en estado **borrador** por cada día hábil y responsable.
Los **sábados y domingos se excluyen automáticamente** (días no trabajados).

> Cada borrador es **independiente**: el detalle de un día no se copia a los demás. Así,
> la charla del lunes puede tratar un tema distinto a la del martes. Si vuelves a generar el
> plan sobre el mismo rango, los días ya planificados no se duplican.

### Completar un borrador (el responsable)

Los responsables ven sus borradores pendientes en la sección **"Planificadas por
completar"** y en el calendario (con borde punteado y el símbolo ◌). Para completar uno:

1. Ábrelo desde la lista, el calendario o el panel del día.
2. Rellena el detalle de la jornada: título, tema del día, **relator**, horario, ubicación y
   asistentes.
3. Guarda. El borrador pasa a **programada** y los asistentes convocados reciben el aviso
   en su bandeja de entrada.

El campo **Relator** viene precargado con la persona que la planificación mensual asignó a
ese día, pero **puedes cambiarlo** si quien dicta la charla es otro (licencia, vacaciones,
reemplazo). Al elegir a alguien distinto, bajo el campo aparece un aviso indicando a quién
lo asignaba el plan: ese dato **queda guardado** como constancia del reemplazo, y la
planificación del mes no vuelve a generar el borrador del responsable original.

> El relator solo se puede cambiar **mientras la actividad no tenga firmas**. Una vez que
> alguien firmó, el relator forma parte del acta y queda congelado junto con el resto del
> contenido.

> Un supervisor también puede **crear sus propias actividades** cuando trabaja solo o tiene
> tareas adicionales no contempladas en la planificación (botón **Nueva actividad** o click
> en un día del calendario).

## El calendario mensual

La vista **Calendario** muestra el mes completo:

- Cada actividad aparece como una **etiqueta de color según su tipo** (la leyenda está al
  pie del calendario).
- Los **borradores por completar** se distinguen con borde punteado y el símbolo ◌.
- Las **actividades vencidas** (que pasaron su día sin realizarse) se marcan con un **anillo
  rojo** (ver la leyenda al pie).
- Los **fines de semana** aparecen atenuados (no se planifican actividades).
- Navega entre meses con las flechas o vuelve al mes actual con **Hoy**.

Al hacer **clic en un día**, se abre el panel **"Actividades del día"** con todo lo de esa
fecha: las pendientes por completar aparecen primero (con una alerta que indica cuántas
faltan), y desde ahí puedes **completar** un borrador, **ver el detalle** de una actividad
o **crear una nueva** para ese día.

## Registrar la asistencia

Una actividad solo cuenta como **realizada** cuando queda registrada la asistencia de los
trabajadores. Hay dos formas:

- **Registrar Asistencia** (el relator o gestor) — abre la lista de trabajadores y marca
  quiénes asistieron. Cada asistente confirma con su firma. Los que ya están registrados se
  muestran con la etiqueta **"Ya registrado"**.
- **Registrar mi asistencia** (el propio trabajador) — cada persona puede confirmar su
  asistencia y firmar desde su cuenta.

> La firma de asistencia es la evidencia legal de la capacitación. Sin asistencia firmada,
> la actividad queda como pendiente y **no cuenta** para el cumplimiento de la obra.

En la lista de trabajadores, **los convocados aparecen primero, resaltados con la etiqueta
"Convocado"**, para que sea fácil identificar a quién corresponde firmar. Igual puedes
registrar a alguien no convocado (quedará marcado como *"no convocado"* en el reporte).

### Se firma durante todo el día

La asistencia **se puede firmar durante todo el día** de la actividad: no hay una hora de
cierre automática. Esto permite registrar a los **trabajadores que llegan más tarde**
(rezagados), incluso después de haber cerrado la actividad. Las firmas que se registran
**después de la hora de inicio** de la charla quedan marcadas con la etiqueta **"Atraso"**
(con los minutos) en el reporte, sin bloquear el registro.

## Cerrar la actividad

Registrar asistencia y **cerrar** la actividad son dos acciones distintas. Firmar ya no la
cierra sola: cuando terminas, el relator o gestor la cierra a propósito con el botón
**Cerrar actividad** (en el detalle de la actividad). Al cerrarla pasa a **Realizada**.

Para poder cerrar, la actividad debe cumplir dos condiciones (si no, el botón aparece
deshabilitado e indica el motivo):

- Tener **al menos una firma** registrada.
- Tener el **registro con contenido** (descripción, tema, convocados o permisos): no se
  puede cerrar una actividad completamente vacía.

> Cerrar la actividad **no impide** seguir sumando firmas ese mismo día: si llega un
> rezagado después del cierre, igual puedes registrar su asistencia (quedará con la etiqueta
> de atraso).

## Seguimiento del día: pendientes, ausencias y alertas

Para que ninguna charla quede sin firmar, el módulo ayuda al supervisor a hacer seguimiento:

**Semáforo de estado.** En el historial, el calendario y las actividades de hoy, cada
actividad muestra su estado con color:

- **Verde (Realizada)** — cerrada con su asistencia.
- **Amarillo (Pendiente)** — programada, aún dentro del plazo (hoy o a futuro).
- **Rojo (Vencida)** — pasó su día sin realizarse. En el calendario se marca con un
  **anillo rojo**.

**Pendientes de firmar hoy.** Arriba de las actividades de hoy aparece un panel que cruza,
por cada charla, **quiénes fueron convocados y todavía no firman**. Desde ahí puedes
**Registrar asistencia** de inmediato o **marcar ausencias**.

**Marcar ausentes / permisos.** Si un convocado no va a asistir (permiso, licencia médica,
falta, vacaciones, etc.), haz clic en su nombre dentro del panel y elige el **motivo**.
Quedará registrado como ausente **y dejará de contar como pendiente** (ya no aparece en
rojo). Puedes **quitar** la ausencia si te equivocaste.

**Avisos automáticos.** El sistema envía avisos a la **bandeja de entrada** de los
responsables cuando:

- Una charla superó su **hora de término** y aún no ha sido cerrada.
- Llega el **mediodía** y todavía hay convocados sin firmar (los ausentes no cuentan).

> Estos avisos llegan a la bandeja interna (no por SMS) y sirven de recordatorio para cerrar
> el día con todo firmado.

## Reporte post-charla

En el **detalle** de una actividad realizada encontrarás el **reporte de asistencia**:

- Número de convocados, número de asistentes y **porcentaje de asistencia**.
- Tabla por persona con **Asistió (Sí/No)**, hora de firma y la etiqueta **"Atraso"** cuando
  la firma se hizo después de la hora de inicio.
- El **acta completa** de la jornada: planificación diaria (tema, recursos, riesgos,
  medidas, protector solar, observaciones) y los permisos de trabajo con su checklist.

Con el botón de **descarga** se abre una vista imprimible que puedes guardar como PDF desde
el navegador.

### Completar el registro después de la charla

Las observaciones y los permisos suelen terminarse de anotar después de la charla. El botón
**Completar registro** (visible para el relator o quien pueda crear actividades) permite
editar la **planificación diaria y los permisos de trabajo** de una actividad ya realizada.

> Las **asistencias y firmas nunca se modifican** por esta vía: son registro de
> auditoría. Una vez que hay firmas, el resto del contenido de la actividad queda congelado
> (solo puede completarse la descripción y el acta).

## Catálogos de actividad

Los desplegables de **temas, recursos, riesgos y medidas** vienen con un set de fábrica y
son **configurables por empresa** en el menú lateral → **Catálogos** (requiere permiso de
gestión de la empresa). Ahí puedes agregar, renombrar o eliminar opciones de cada lista;
los cambios se reflejan de inmediato en los formularios de actividad.

## Ver el detalle de una actividad

Haz clic sobre cualquier actividad para abrir su **Detalle**, donde verás la fecha, el
horario, el relator, la descripción, la planificación diaria, los permisos de trabajo y la
lista de **asistentes** con su estado de firma.

## Preguntas frecuentes

**No veo ninguna actividad.**
Probablemente no has seleccionado una obra. Las actividades se muestran **por obra**: elige
una en el selector de obra y aparecerán sus actividades.

**Programé la actividad pero no aparece como cumplida.**
Una actividad se considera cumplida cuando tiene **asistencia registrada y firmada**.
Mientras nadie firme la asistencia, quedará pendiente.

**¿Quién puede crear actividades?**
Los roles de gestión (Administrador, Prevencionista, Jefe de Obra, Supervisor). El relator
asignado es quien la dicta. La **planificación mensual** requiere además el permiso de
planificar, que la empresa puede delegar a otros roles (por ejemplo, representantes del
Comité Paritario) desde **Mi Empresa → Roles**. Consulta [Roles de Usuario](/roles/).

**¿Qué diferencia hay entre un borrador y una actividad programada?**
El **borrador** lo genera la planificación mensual: tiene fecha, tipo y responsable, pero
le falta el detalle del día. Cuando el responsable lo **completa**, pasa a **programada** y
recién entonces se convoca a los asistentes.

**El supervisor que tenía asignada la charla está con licencia. ¿Puede dictarla otro?**
Sí. Al **completar el borrador**, cambia el campo **Relator** por quien la va a dictar.
Queda registrado que era un reemplazo y a quién la asignaba el plan originalmente. Si la
actividad ya tiene firmas, el relator no se puede cambiar: en ese caso corresponde dejar
constancia en la descripción o en el acta.

**¿Por qué el plan no generó actividades en sábado o domingo?**
Es intencional: los fines de semana se consideran días no trabajados y se excluyen
automáticamente del rango de planificación.

**Un trabajador faltó a la capacitación. ¿Qué hago?**
Si tiene un motivo (permiso, licencia, falta, vacaciones), **márcalo como ausente** en el
panel *Pendientes de firmar hoy*: dejará de aparecer como pendiente y quedará registrado el
motivo. Si simplemente no asistió, no lo marques como asistente: quedará con **"No"** en el
reporte y podrás reprogramarle la capacitación.

**Firmé a la hora correcta pero el reporte dice "Atraso". ¿Está bien?**
La etiqueta de atraso compara la hora de la firma con la **hora de inicio** de la charla en
horario de Chile. Si firmaste antes o justo a esa hora, no debería marcar atraso. Si ves un
desfase raro, avísale al administrador.

**¿Por qué no puedo cerrar la actividad?**
El botón **Cerrar actividad** exige **al menos una firma** y un **registro con contenido**.
Si está deshabilitado, te indicará cuál de las dos condiciones falta.

**Llegó un trabajador tarde y ya cerré la charla. ¿Puedo firmarlo?**
Sí. Se puede firmar **durante todo el día**, incluso después de cerrada. La firma quedará
con la etiqueta de **atraso**.

**¿Qué significa que una actividad esté en rojo?**
Está **vencida**: pasó su día sin realizarse (sin cerrarse con asistencia). Es una señal
para regularizarla o reprogramarla.

**¿La asistencia se puede firmar en terreno sin señal?**
La firma de asistencia usa el mismo sistema de PIN de las firmas. Si no hay conexión, revisa
las opciones de [Firmas Offline](/modulos/firmas) para recolectarlas y sincronizarlas luego.

**¿Cómo programo la charla diaria que se repite todos los días?**
Usa **Planificar mes**: un ítem de tipo *Charla 5 Minutos* con periodicidad *diaria* genera
un borrador por cada día hábil, y cada día puede tratar su propio tema. (La opción de
**periodicidad** del formulario de actividad individual sigue disponible para repeticiones
simples.)
