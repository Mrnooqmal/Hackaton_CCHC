# Gestionar incidentes y ver estadísticas

Lo que se reporta en **Incidentes** se gestiona desde el mismo módulo: cada reporte es un **caso**, que se clasifica, junta sus papeles y se cierra. Cómo se reporta: [Reportar un hallazgo o un incidente](/terreno/reportar).

## El listado

Busca por descripción y filtra por **gravedad**, **estado de cierre** (abiertos o cerrados) y
**etapa**. Cada evento muestra su estado: **Reportado**, **En investigación**, **En proceso**,
**Abierto** o **Cerrado**.

Al tocar un evento se abre la **página del caso**, que se explica más abajo.

:::: solo incidentes.reportar incidentes.calificar_accidente
### Gestionar un evento

Quien tiene permiso ve la sección **Gestionar**:

- **Editar gobernanza** — define el **Responsable** del seguimiento (Prevencionista, Jefe
  directo o Comité paritario), el **Plazo de respuesta**, el **Responsable de cierre**, el
  **Estado de cierre** y un comentario de cierre.
- **Marcar como accidente** — califica un incidente como accidente. Requiere el permiso
  **Calificar accidente**.
::::

## La página del caso

Arriba ves **Qué sigue**: el paso que toca dar (**clasificar**, **juntar los papeles** o
**cerrar**) y a quién le toca. Si te toca a ti, lo dice (*"Te toca: …"*) con lo que falta.
Debajo está lo que se reportó: fecha y hora, obra, etapa constructiva, descripción, medidas
inmediatas y fotos. Mientras el caso no esté cerrado, quien lo reportó y quien lo gestiona pueden
**agregar fotos**.

Según tus permisos, más abajo aparecen las secciones para clasificar, juntar los papeles y cerrar.
Cada acción actualiza **Qué sigue**. Si dos personas trabajan el mismo caso a la vez y una guarda
primero, a la otra le pide recargar y volver a intentar: no se pisa lo que la primera guardó.

:::: solo incidentes.calificar_accidente
### Clasificar el reporte

Quien tiene el permiso **Calificar accidente** confirma de qué se trata en **Clasificar el
reporte**:

- **Qué es** — **Hallazgo** (condición o acción subestándar), **Incidente** (sin lesión, pudo ser
  grave) o **Accidente** (hubo lesión). Es la única forma de cambiar el tipo: el reporte original
  no se edita.
- **Gravedad** — **Leve**, **Grave** o **Fatal**, solo en incidentes y accidentes. Un hallazgo no
  tiene gravedad: si un accidente se reclasifica como hallazgo, la gravedad se quita.
- **Alto potencial** — solo en incidentes, con dos preguntas: *"Si alguna condición hubiera sido
  distinta, ¿esto pudo causar un daño mayor o la muerte?"* y *"¿Generó un gran susto en quienes lo
  presenciaron?"*. Basta un **Sí** para que el incidente sea de alto potencial y exija su informe
  de investigación.
- **Quién lo corrige** y **Plazo para corregirlo** — solo en hallazgos y opcionales. Se elige a una
  persona activa que tenga **Ver historial**, para que pueda abrir el caso. Una asignación anterior
  se conserva aunque esa persona no lo tenga.

Reclasificar es posible mientras el caso esté abierto: la clasificación anterior queda guardada en
el historial del caso.
::::

### Los papeles del caso

La sección **Papeles del caso** (para quien tiene **Ver historial**) muestra qué papeles exige el
caso, cuáles faltan y el avance. Lo que se exige depende del tipo:

| Caso | Papeles |
| --- | --- |
| Hallazgo | Una foto, responsable y plazo, y el comentario de cierre |
| Incidente | Informe de investigación, solo si es de alto potencial |
| Accidente | DIAT, informe de investigación y plan de medidas correctivas |
| Accidente grave o fatal | Lo del accidente, más la constancia del aviso a la Inspección del Trabajo y a la SEREMI de Salud |

Un incidente que no es de alto potencial no exige papeles: aparece como *"no exige papeles"*. La
**DIEP** se puede subir como respaldo, pero no se exige en ningún caso.

:::: solo incidentes.reportar
**Subir un papel.** Elige el tipo de papel, la fecha del documento (opcional) y el archivo (PDF
o imagen JPG, PNG o WebP, hasta 15 MB; hasta 30 archivos vigentes por caso; los anulados no cuentan, con un máximo de 60 guardados) y toca **Subir papel**. Si el
archivo ya llegó pero no se pudo registrar, aparece **Reintentar registro**: no hace falta subirlo
de nuevo. Los archivos se acumulan: subir una segunda DIAT no reemplaza a la primera. También se
pueden subir papeles a un caso ya cerrado, para completar su respaldo.

**Anular un papel.** Si subiste el archivo con el tipo equivocado, o no era el archivo, toca
**Anular** y escribe el motivo. El papel deja de contar para el caso y queda en la lista marcado
como **Anulado**; el archivo se conserva. Después sube el correcto. En un caso cerrado no se anula:
primero hay que reabrirlo.
::::

La plataforma **guarda** los archivos; no tramita ni envía la DIAT ni la DIEP.

**Descargar.** Cada archivo tiene su botón **Descargar**. Al tocarlo se prepara un enlace que
dura **15 minutos**; abrir la página del caso no descarga nada. La **DIAT** y la **DIEP** traen
el RUT y datos de salud de la persona afectada: llevan la etiqueta **Datos de salud** y **cada
descarga queda registrada** (quién, cuándo y de qué caso, sin el contenido). El archivo se baja con
un nombre neutro (el tipo de papel y la fecha), no con el que tenía al subirlo.

### Plan de medidas correctivas

Las medidas correctivas de un accidente **ya no se escriben una por una** en la página del caso:
se definen en un documento, el **Plan de medidas correctivas**, que se sube junto a los demás
papeles (la DIAT, el informe de investigación). Para cerrar un **accidente** hace falta ese plan.
En un incidente o un hallazgo no se exige, pero se puede subir como respaldo.

Los casos que ya tenían medidas registradas las siguen mostrando, solo para consulta, bajo
**Medidas registradas antes**; con ellas, el accidente cuenta como si ya tuviera su plan.

:::: solo incidentes.calificar_accidente
### Cerrar y reabrir un caso

Cuando el caso está clasificado aparece **Cerrar el caso**. Escribe el **Comentario de cierre**
(qué se hizo y cómo se verificó) y toca **Cerrar caso**. Si falta algo —clasificar, un papel, la
foto o el responsable de un hallazgo— el cierre no se hace y te lista exactamente qué falta.

Un caso cerrado **no admite cambios**, salvo seguir completando sus papeles. Para corregirlo,
toca **Reabrir el caso** y escribe el **motivo**: es obligatorio y queda registrado junto con el
cierre anterior. Al reabrir un hallazgo se borra su comentario de cierre (el anterior queda en el
historial) y habrá que escribir uno nuevo al volver a cerrarlo.
::::

### Investigaciones

Los incidentes **graves y fatales** requieren una **investigación** (Art. 71). Se firma desde
**Detalle de obra → Cumplimiento DS 44 → Verificar → Investigaciones AT/EP**, con **Cerrar y
firmar informe**: genera el informe con tu PIN, lo guarda como documento de la obra y **cierra el
caso**. Por eso exige el mismo permiso que cerrarlo (**Calificar accidente**) y las mismas
condiciones: el caso tiene que estar clasificado y tener el resto de sus papeles (la DIAT y el plan
de medidas correctivas); si falta algo, te lo dice y no se firma nada. El informe firmado cuenta
como el informe de investigación del caso: aparece en **Archivos subidos** como **Informe firmado
desde la obra**, con su botón **Descargar**, y cada descarga queda registrada. En la lista de
investigaciones pendientes se ve si el accidente tiene el plan de medidas subido. Ver [Obras](/obra/cumplimiento#módulos-de-cada-fase).

Las medidas **ya no se siguen** en **Actuar → Medidas correctivas**: ahí solo quedan las que se
registraron antes del plan de medidas. El plan de cada caso nuevo está en su página.

:::: solo incidentes.estadisticas
## Estadísticas

La pestaña **Estadísticas** muestra el **Consolidado estadístico** de la obra:

- Totales de **Hallazgos**, **Incidentes** y **Accidentes**.
- **Tasa de accidentabilidad**.
- **% Hallazgos cerrados** y **Índice proactivo** (hallazgos sobre el total de eventos: cuanto
  más alto, más se está previniendo).
- Gráficos de **Tendencia mensual** y **Por etapa constructiva**, y un **Calendario** con los
  días que tuvieron eventos.

Puedes descargar el consolidado en **CSV** o **PDF**.

![Pestaña Estadísticas de Incidentes](/img/incidentes/estadisticas.png)
::::

## Si solo reportas

Quien no tiene **Ver historial** (un trabajador, por ejemplo) ve en **Incidentes** el botón para
reportar y la lista **Mis reportes**, con lo que reportó y su estado. Al tocar un reporte abre su
página: ve **Qué sigue** en palabras simples (por ejemplo, que prevención de riesgos lo está
revisando o que hay una persona a cargo de corregirlo) y puede **agregar fotos** mientras no esté
cerrado. No ve los papeles del caso ni la clasificación.

## Preguntas frecuentes

**No veo la pestaña Estadísticas (o Listado).**
Cada una depende de un permiso (**Ver estadísticas** y **Ver historial**). Consulta con el
administrador.

**Los datos de salud del afectado, ¿quién los ve?**
La DIAT y la DIEP los traen. Solo los ve quien tiene **Ver historial**, y cada descarga queda
registrada. Trátalos con reserva y compártelos solo con quien participa en la investigación.

**No puedo cerrar el caso.**
Al intentarlo te dice qué falta: clasificarlo, algún papel (en un accidente, la DIAT, el informe y
el plan de medidas correctivas) o, en un hallazgo, la foto, el responsable con plazo y el comentario
de cierre. Ver [Los papeles del caso](#los-papeles-del-caso).

**Cerré un caso por error.**
Quien tiene **Calificar accidente** puede reabrirlo con un motivo.
