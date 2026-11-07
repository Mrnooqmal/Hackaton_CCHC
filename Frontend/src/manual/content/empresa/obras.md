# Crear y administrar obras

Una **obra** es cada proyecto de construcción. Dentro de ella viven su equipo, sus documentos,
sus actividades, sus incidentes y el seguimiento del cumplimiento del DS 44.

> **¿Quién puede crear obras?** Quien tenga el permiso **Crear obra** y pueda entrar a la
> **vista de empresa** (permiso **Ver Mi Empresa**). Con la configuración de fábrica, eso es
> solo el **Administrador**. Ver [Roles](/empresa/roles#la-vista-de-empresa).

## El listado de obras

El listado está en la **vista de empresa**: en el menú lateral, **Obras**. Muestra todas las
obras de la empresa, con el subtítulo *"Proyectos activos, documentos DS44 y personal
asignado"*.

![Listado de obras con el botón Nueva obra](/img/obras/listado.png)

Cada obra muestra su foto, nombre, ubicación y un estado de color: **Activa**, **Pausada** o
**Finalizada**. Arriba puedes **buscar** por nombre, código o dirección, **filtrar por estado**
y alternar entre vista de **tarjetas** y de **tabla**.

Si todavía no hay obras, verás *"Sin obras registradas"* con un botón para crear la primera.

:::: solo obras.crear
## Crear una obra

1. En **Obras**, toca **Nueva obra**.
2. Completa el formulario, de arriba hacia abajo:
   - **Identificación** — **Nombre de obra** *(obligatorio)*, **Código** interno *(opcional)*,
     **Empresa mandante** (se completa con tu empresa) y **Estado** (normalmente *Activa*).
   - **Ubicación** — busca la **Dirección** y elígela de la lista: la plataforma completa la
     **Región** y la **Comuna**; confírmalas.
   - **Características DS44** — marca lo que corresponda. **De esto depende qué requisitos del
     DS 44 se le exigen a la obra**:
     - *Comparte sitio con otra(s) entidad(es) — faena compartida* (Art. 20).
     - *Hay máquinas/herramientas motrices* (Art. 10).
     - *Existen agentes físicos/químicos/biológicos* (Art. 2).
   - **Imagen de referencia** *(opcional)* — la foto que encabeza la obra y su tarjeta.
   - **Trabajadores asignados** *(opcional)* — busca por nombre o RUT y marca a quienes trabajarán
     ahí desde el inicio. Puedes cambiarlo después.
3. Toca **Crear obra**.

![Formulario de creación de obra](/img/obras/nueva-obra.png)

> Si una característica cambia, la puedes corregir después: desde **Editar obra** o
> respondiendo **Sí / No** en el requisito correspondiente del DS 44.
::::

:::: solo empresa.ver obras.crear
## Poner una obra en marcha

Este es el orden recomendado la primera vez. Los pasos 1 y 2 se hacen en la **vista de
empresa**; el resto, **dentro de la obra**.

1. **Revisa tu empresa** en [Mi Empresa](/empresa): logo y color, **representante
   legal**, roles, cargos y el catálogo de **EPP**.
2. **Registra a las personas** en [Personas](/empresa/personas), una a una o con **Carga
   masiva**. Para cada una defines su **rol** (qué puede hacer en la plataforma) y su **cargo**
   (su oficio en obra, que define qué le exige el DS 44).
3. **Crea la obra** en [Obras](/empresa/obras). Al guardarla, la plataforma prepara los
   requisitos del DS 44 que le corresponden.
4. **Arma el equipo de la obra** en **Personas** (con la obra elegida): suma a quienes
   trabajan ahí y ordénalos por cuadrilla. Al sumarlos empieza su **onboarding**: los
   documentos y capacitaciones que su cargo exige.
5. **Sube los documentos** de la obra en **Detalle de obra** (matriz de riesgos, programa de
   trabajo preventivo, procedimientos…) y asígnalos a quienes deben firmarlos.
6. **Programa las actividades** del mes en [Actividades](/obra/actividades): charlas
   diarias, capacitaciones e inspecciones, con su asistencia firmada.
7. **Haz seguimiento**: el **Detalle de obra** muestra el avance del cumplimiento requisito
   por requisito, e **Inicio** muestra a cada persona lo que tiene pendiente.

```
Mi Empresa → Personas → Crear obra → Equipo de la obra
   → Documentos y firmas → Actividades → Seguimiento del cumplimiento
```
::::

## El equipo de la obra

El equipo no se arma en la ficha: está en **Personas**, con la obra elegida. Ver
[Personas](/obra/equipo#el-equipo-de-una-obra).

## Editar, pausar o finalizar

Con **Editar obra** cambias el **Nombre**, el **Estado** y las características DS 44, y guardas
con **Guardar cambios**:

![Editar obra: nombre, estado y características DS 44](/img/obras/editar.png)

- **Pausada** — los trabajos se detienen temporalmente. Se conserva todo.
- **Finalizada** — el proyecto terminó. Se conserva todo para consulta.

## Preguntas frecuentes

**No veo el botón "Nueva obra".**
Tu rol no tiene el permiso para crear obras. Pídeselo a un administrador.

**¿Cómo avanzo de fase?**
No se avanza a mano: la obra pasa sola a la siguiente fase cuando la actual queda completa.

**Un requisito dice "No aplica". ¿Lo puedo marcar yo?**
No a mano: lo decide la plataforma según la dotación de la obra y sus condiciones. Si una
condición está mal, corrígela respondiendo **Sí / No** o editando la obra.

**Subí el documento, pero el requisito sigue incompleto.**
Lee la línea **Falta…** del requisito: muchas veces falta una firma, una fecha o una constancia
de envío, no otro archivo.

**¿Qué diferencia hay entre pausar y finalizar?**
**Pausar** es temporal; **finalizar** marca el cierre del proyecto. En ambos casos la
información se conserva.
