# Actividades y capacitación

El módulo de **Actividades** te permite programar y registrar todo lo que reúne a los
trabajadores en torno a la seguridad: **capacitaciones**, **charlas de inicio de jornada**,
**ART**, **inspecciones**, **simulacros** y otras actividades preventivas. Lo más importante
es que aquí queda el **registro de asistencia firmado**, que es la prueba de que la
capacitación efectivamente se realizó (una exigencia clave del DS 44, Art. 16).

## Entrar al módulo

En el menú lateral, haz clic en **Actividades**. Se abrirá la pantalla **"Actividades y
capacitación"**.

> Las actividades son **de una obra**. Esta pantalla no tiene un botón para cambiar de obra: si
> ves *"No hay una obra activa"*, abre el menú de **tres puntos** abajo en el menú lateral (junto
> a tu nombre) y toca **Cambiar de obra**.

La pantalla ofrece **dos vistas**, que alternas con **Lista** y **Calendario**:

- **Lista** — tres secciones: **Del plan, por completar** (borradores de la planificación
  mensual a los que les falta el detalle del día), **Hoy** (lo programado para hoy, listo para
  registrar asistencia) e **Historial** (lo ya realizado, con filtros por fecha: 7 días, 30
  días o un rango).
- **Calendario** — el mes completo de un vistazo. Toca el botón **Calendario** (ver
  [El calendario mensual](#el-calendario-mensual)).

Arriba están **Planificar mes** y **Nueva actividad**, y un buscador para hoy y el
calendario.

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

1. Toca **Nueva actividad**. Se abre una pantalla completa con varias secciones.
2. **Tipo y detalle**:
   - **Tipo de actividad** *(obligatorio)* — según la tabla anterior.
   - **Tipo de capacitación (DS44)** *(obligatorio si es capacitación)* — el tipo que exige la
     norma. De él sale la **duración mínima** (ver [Duración](#duración-de-las-capacitaciones)).
   - **Título** *(obligatorio)* y **Descripción**.
   - En capacitaciones, **Con evaluación de aprendizaje** y su **Nota mínima de aprobación**:
     70 % en general, 90 % en altura y SPDC.
3. **Horario** — la fecha, la **Periodicidad** (única o repetida, con **Repetir hasta**), la
   **Hora inicio** y, si quieres, la **Hora fin** y la **Ubicación**.
4. **Responsable** — el **Relator**, que queda como primer responsable de la actividad.
5. **Planificación del día** y **Permisos de trabajo especiales**, si corresponden (ver más
   abajo).
6. **Asistentes requeridos** *(opcional)* — los convocados. Reciben el aviso al programarse.
7. Toca **Crear actividad**.

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
> [catálogos configurables de tu empresa](#catálogos-de-actividad).

### Permisos de trabajo especiales

En la misma sección puedes marcar si la jornada involucra **trabajos en altura**,
**espacios confinados** o **trabajo en caliente**. Al marcar uno, se despliega
automáticamente su **formulario de permiso de trabajo** con:

- Checklist específico del riesgo (ej. altura: arnés inspeccionado, puntos de anclaje
  definidos, examen de altura vigente…).
- **Responsable** del permiso, horario y ubicación.

El permiso queda embebido en la actividad y aparece en el reporte posterior.

## Planificar el mes completo

En lugar de crear las actividades una a una, quien tenga el permiso **Planificar el mes**
(por defecto Administrador, Prevencionista y Jefe de Obra, o quien la empresa designe) puede
armar el **esqueleto del mes** con **Planificar mes**, que abre la pantalla **Planificar el
mes**:

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
3. Toca **Generar planificación**.

El sistema crea una actividad en estado **borrador** por cada día hábil y responsable.
Los **sábados y domingos se excluyen automáticamente** (días no trabajados).

> Cada borrador es **independiente**: el detalle de un día no se copia a los demás. Así,
> la charla del lunes puede tratar un tema distinto a la del martes. Si vuelves a generar el
> plan sobre el mismo rango, los días ya planificados no se duplican.

### Completar un borrador (el responsable)

Los responsables ven sus borradores en la sección **Del plan, por completar** y en el
calendario (con borde punteado y el símbolo ◌). Para completar uno:

1. Toca **Completar** en la lista, o ábrelo desde el calendario o el panel del día.

   ![Borradores del plan con el botón Completar](/img/actividades/completar-borrador.png)

2. Se abre **Completar actividad planificada**. Rellena el detalle de la jornada: título, tema
   del día, **relator**, horario, ubicación y asistentes.

   ![Formulario Completar actividad planificada con el campo Relator](/img/actividades/completar-formulario.png)

3. Toca **Guardar y programar**. El borrador pasa a **programada** y los asistentes convocados
   reciben el aviso en sus notificaciones.

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

Toca **Calendario**, arriba junto a **Lista**, para ver el mes completo:

![Vista Calendario de Actividades, con el botón Calendario marcado](/img/actividades/calendario.png)


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

- **Registrar asistencia** (el relator o quien gestiona) — abre la lista de convocados y
  cada trabajador firma con **su propio PIN**, uno por uno, en ese mismo equipo. Puedes
  saltar a quien no esté presente. Cuando todos firmaron, verás *"Todos los convocados
  firmaron."*
- **Firmar mi asistencia** (el propio trabajador) — cada persona confirma su asistencia con
  su firma desde su cuenta.

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

Registrar asistencia y **cerrar** la actividad son dos acciones distintas: firmar no la
cierra. Cuando terminas, el relator o quien gestiona la cierra con **Cerrar actividad**, en el
detalle de la actividad. Al cerrarla pasa a **Realizada**.

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

**Quién falta por firmar.** En cada actividad de hoy, **Ver pendientes** muestra a los
convocados que todavía no firman. Desde ahí puedes **Registrar asistencia** de inmediato o
**justificar ausencias**.

**Justificar ausencias.** Si un convocado no va a asistir, toca su nombre, toca **Justificar**
y elige el **motivo**: Permiso, Licencia médica, Falta, Vacaciones u Otro.
Quedará registrado como ausente **y dejará de contar como pendiente** (ya no aparece en
rojo). Puedes **quitar** la ausencia si te equivocaste.

**Avisos automáticos.** El sistema avisa en las **Notificaciones** de los responsables
cuando:

- Una charla superó su **hora de término** y aún no ha sido cerrada.
- Llega el **mediodía** y todavía hay convocados sin firmar (los ausentes no cuentan).

> Estos avisos llegan a las notificaciones de la plataforma y sirven de recordatorio para
> cerrar el día con todo firmado.

## Reporte post-charla

En el **detalle** de una actividad realizada encontrarás el **reporte de asistencia**:

- Número de convocados, número de asistentes y **porcentaje de asistencia**.
- Tabla por persona con **Asistió (Sí/No)**, hora de firma y la etiqueta **"Atraso"** cuando
  la firma se hizo después de la hora de inicio.
- El **acta completa** de la jornada: planificación diaria (tema, recursos, riesgos,
  medidas, protector solar, observaciones) y los permisos de trabajo con su checklist.

Usa **Ver reporte** para verlo en pantalla y **Descargar reporte** para bajarlo en PDF.

### Completar el registro después de la charla

Las observaciones y los permisos suelen terminarse de anotar después de la charla. El botón
**Completar registro** (visible para el relator o quien pueda crear actividades) permite
editar la **planificación diaria y los permisos de trabajo** de una actividad ya realizada.

> Las **asistencias y firmas nunca se modifican** por esta vía: son registro de
> auditoría. Una vez que hay firmas, el resto del contenido de la actividad queda congelado
> (solo puede completarse la descripción y el acta).

## Duración de las capacitaciones

El DS 44 fija un mínimo de horas a algunas capacitaciones:

| Capacitación | Mínimo |
| --- | --- |
| Uso y mantención de EPP (Art. 13) | 1 hora |
| Prevención de riesgos laborales (Art. 16) | 8 horas |
| Orientación del Comité Paritario | 8 horas |
| Curso del Comité Paritario | 20 horas |

En el detalle de la capacitación, la sección **Duración** muestra el **Mínimo exigido** y lo
**Declarado**. Escribe los **minutos que dice el certificado** y adjunta el certificado. Verás
**Cumple**, **No alcanza el mínimo** o **Sin declarar**, y si el certificado está cargado.

> La duración **no se calcula con el reloj** de la plataforma: se declara lo que dice el
> certificado. Así también se acreditan las capacitaciones que dicta un organismo externo.
> Una capacitación sin horas declaradas **no cuenta como completa** en el cumplimiento.

La duración y el certificado se pueden completar **después** de cerrar la actividad, porque el
certificado suele llegar días más tarde.

## Evaluación de aprendizaje

Si la capacitación se creó **con evaluación de aprendizaje**, su detalle muestra la sección
**Evaluación de aprendizaje** con la nota mínima exigida y si el respaldo está cargado.

La evaluación la toma y la corrige el relator **fuera de la plataforma**. Acá se guarda **un
documento** con las evaluaciones de esa capacitación: toca **Subir evaluaciones**. Puedes
**Ver**, **Reemplazar** o quitar el respaldo después. Como el certificado, se puede subir días
después de la charla.

## Catálogos de actividad

Los desplegables de **temas, recursos, riesgos y medidas** vienen con un set de fábrica y son
**configurables por empresa** en la vista de empresa → **Catálogos** (requiere el permiso
**Gestionar cargos y kits**). Cada cambio se guarda al hacerlo, y renombrar un ítem no afecta
a las actividades ya registradas. Ver [Catálogos](/modulos/catalogos).

## Ver el detalle de una actividad

Haz clic sobre cualquier actividad para abrir su **Detalle**, donde verás la fecha, el
horario, el relator, la descripción, la planificación diaria, los permisos de trabajo y la
lista de **asistentes** con su estado de firma.

## Preguntas frecuentes

**No veo ninguna actividad.**
Las actividades se muestran **por obra**. Revisa en la barra superior en qué obra estás y, si
no es la correcta, usa **Cambiar de obra** en el menú de tres puntos, abajo en el menú lateral.

**Programé la capacitación pero no aparece como cumplida.**
Necesita **asistencia firmada** y, si es una capacitación con mínimo de horas, la **duración
declarada**. Si exige evaluación, también el respaldo de las evaluaciones.

**¿Quién puede crear actividades?**
Quien tenga el permiso **Crear actividad**: por defecto Administrador, Prevencionista, Jefe de
Obra y Supervisor. La **planificación mensual** requiere además **Planificar el mes**, que la
empresa puede delegar a otros roles (por ejemplo, al Comité Paritario) desde
**Mi Empresa → Roles y permisos**. Ver [Roles](/roles/).

**¿Qué diferencia hay entre un borrador y una actividad programada?**
El **borrador** lo genera la planificación mensual: tiene fecha, tipo y responsable, pero
le falta el detalle del día. Cuando el responsable lo **completa**, pasa a **programada** y
solo entonces se convoca a los asistentes.

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

**¿La asistencia se puede firmar sin señal?**
No por ahora: firmar requiere conexión. Ver [Firmas](/modulos/firmas#sin-conexión).

**¿Cómo programo la charla diaria que se repite todos los días?**
Usa **Planificar mes**: un ítem de tipo *Charla 5 Minutos* con periodicidad *diaria* genera
un borrador por cada día hábil, y cada día puede tratar su propio tema. (La opción de
**periodicidad** del formulario de actividad individual sigue disponible para repeticiones
simples.)
