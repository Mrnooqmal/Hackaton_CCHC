# Encuestas

El módulo de **Encuestas** te permite consultar a los trabajadores de forma rápida y dejar
registro de sus respuestas. Sirve para muchas cosas: encuestas de clima de seguridad,
verificación de comprensión tras una capacitación, levantamiento de condiciones inseguras o
cualquier consulta que quieras documentar.

Hay dos miradas del módulo:

- **Mis encuestas asignadas** — las que te asignaron a ti, para responderlas. La ve
  **cualquier persona**, sin importar su rol: a un administrador o a un jefe de obra también
  se le puede asignar una encuesta.
- **Encuestas creadas** — la vista de gestión: creas encuestas, eliges a quién van dirigidas
  y revisas los resultados. La ven los roles con permiso para crear encuestas.

## Responder una encuesta

1. Cuando te asignan una encuesta, te llega un aviso a tu
   [Bandeja de Entrada](/modulos/bandeja-entrada). El aviso te lleva directo a la encuesta.
2. También la encuentras en **Encuestas → Mis encuestas asignadas**, en el grupo
   **Pendientes**. Cada fila dice cuántas preguntas tiene y hace cuánto te la asignaron.
3. Tócala para abrir la pantalla de respuesta. Responde cada pregunta; las marcadas como
   **Obligatoria** no se pueden dejar en blanco.
4. Toca **Firmar y enviar** e ingresa tu **PIN**. La respuesta queda firmada a tu nombre.

Las que ya respondiste pasan al grupo **Respondidas**. Si abres una, ves tus respuestas y
puedes **actualizar tu respuesta** (se vuelve a firmar).

![Mis encuestas asignadas, con los grupos Pendientes y Respondidas](/img/encuestas/mis-encuestas.png)

> Las encuestas pendientes también aparecen en tu [Dashboard](/modulos/dashboard) y como
> un número junto a **Encuestas** en el menú lateral.

::: tip Sin conexión
Si en terreno no tienes señal, puedes responder igual una encuesta que ya hayas abierto
antes con conexión. La respuesta queda guardada en el equipo y se envía sola cuando vuelve
la señal; mientras tanto verás el aviso **"por sincronizar"** arriba de la lista.
:::

## Crear una encuesta (gestor)

1. Entra a **Encuestas** y haz clic en **Nueva encuesta**.
2. Completa las tres secciones:
   - **Información general** — el **Título** *(obligatorio)* y una **Descripción**
     *(opcional)* que diga para qué sirve.
   - **Audiencia destino** — a quién le llega:
     - **Toda la organización**: todas las personas de la empresa.
     - **Por cargo**: todas las personas con el cargo que elijas.
     - **Lista personalizada**: eliges a las personas una por una.
   - **Preguntas** — al menos una. Para cada pregunta eliges el **tipo de respuesta**:
     **Selección múltiple** (con sus opciones; escribe una nueva en *"+ Agregar opción"*),
     **Escala 1–N** (defines el valor máximo) o **Pregunta abierta** (respuesta libre).
     Marca **Obligatoria** si no se puede dejar en blanco.
3. Toca **Crear encuesta**. Cada destinatario recibe el aviso en su bandeja.

![Nueva encuesta con información general, audiencia y preguntas](/img/encuestas/nueva-encuesta.png)

## Revisar resultados

En **Encuestas creadas** verás un resumen con indicadores:

- **Encuestas creadas** — cuántas hay y cuántas siguen activas.
- **Trabajadores alcanzados** — a cuántas personas llegaron.
- **Tasa de respuesta** — qué porcentaje ya respondió.

Cada tarjeta muestra cuántas **Preguntas** tiene la encuesta, cuántos **Destinatarios**,
cuántas **Respondidas** y el porcentaje de respuesta. Con **"Todas / Creadas por mí"** filtras
las tuyas, y con el buscador encuentras una específica.

Toca **Ver detalles** para abrir la encuesta: ahí están sus preguntas, los resultados de cada
una (cuántos eligieron cada opción, el promedio de las escalas y las respuestas abiertas) y
la lista de destinatarios con quién respondió y cuándo.

## La Ficha Básica de Salud

Si tu empresa la habilitó (en **Mi Empresa**), la **Ficha Básica de Salud** aparece como una
encuesta más, marcada con la etiqueta **Ficha de salud**. Se asigna sola a las personas de la
empresa.

Sus respuestas son **datos de salud**, así que tienen un resguardo extra: en el detalle,
quien gestiona encuestas ve **quién respondió**, pero **qué respondió** solo lo ve quien tiene
el permiso de **vigilancia de la salud**. Cada persona siempre puede ver lo que ella misma
declaró.

## Preguntas frecuentes

**¿Quién puede crear encuestas?**
Los roles de gestión (Administrador, Prevencionista, Jefe de Obra). Consulta
[Roles de Usuario](/roles/).

**Me asignaron una encuesta y no la veo.**
Revisa la pestaña **Mis encuestas asignadas** (si gestionas encuestas, la vista parte en
**Encuestas creadas**). También puedes abrirla desde el aviso de tu bandeja.

**Asigné la encuesta pero nadie responde.**
Los destinatarios la ven en **Mis encuestas asignadas**, en su Dashboard y en su Bandeja de
Entrada. Si la **tasa de respuesta** está baja, puedes recordarles por la
[Bandeja de Entrada](/modulos/bandeja-entrada).

**¿Quién ve las respuestas?**
Quien gestiona encuestas ve los resultados de cada una. Un trabajador solo ve sus propias
respuestas, nunca las de sus compañeros.

**¿Las respuestas son anónimas?**
No: quedan firmadas por cada persona para poder dar seguimiento (saber quién respondió).
Si necesitas una consulta anónima, indícalo en la descripción y plantea las preguntas en
consecuencia.

**¿Una encuesta puede cerrar un ítem de capacitación?**
Sí. Cuando una encuesta está vinculada a un ítem de onboarding de un trabajador, responderla
da por cumplido ese ítem. Lo verás reflejado en la ficha de la obra y en la del trabajador.
