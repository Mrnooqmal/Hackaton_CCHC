# Incidentes y hallazgos

El módulo de **Incidentes** registra lo que ocurre en materia de seguridad en la obra: desde un
**hallazgo** (una condición o acción insegura detectada a tiempo) hasta un **incidente** o un
**accidente**.

Registrarlos es la base para que no se repitan, y alimenta las **estadísticas** de la obra y los
registros que exige el DS 44.

## Entrar al módulo

En el menú lateral, toca **Incidentes**. Es de la obra elegida: si ves *"No hay una obra
activa"*, usa **Cambiar de obra**. También puedes reportar desde el acceso **Reportar
incidente** de [Inicio](/modulos/dashboard).

La pantalla **Incidentes y hallazgos** tiene dos pestañas, según tus permisos:

- **Listado** — los eventos registrados, con su gravedad y estado.
- **Estadísticas** — el consolidado de la obra.

![Pantalla de Incidentes con el listado de eventos](/img/incidentes/inicio.png)

## Reportar un hallazgo o un incidente

1. Toca **Reportar hallazgo** o **Reportar incidente**. Se abre la pantalla **Reportar**.
2. Arriba, elige **Hallazgo** o **Incidente**.
   - **Cualquier persona puede reportar un hallazgo.**
   - Reportar un incidente requiere el permiso **Reportar incidente**; si no lo tienes, esa
     opción aparece deshabilitada.
3. Completa:
   - **Tipo de hallazgo** *(en hallazgos)* — **Condición subestándar** o **Acción subestándar**.
   - **Etapa constructiva** en la que ocurrió.
   - **Gravedad** *(obligatorio)* — **Leve**, **Grave** o **Fatal**.
   - **Trabajador(es) afectado(s)** *(opcional)* — búscalos por nombre o RUT y toca **Agregar
     afectado**.
   - **Detalle** *(obligatorio)* — qué pasó, con la mayor claridad posible. Puedes tocar
     **Dictar** y contarlo en voz alta: la plataforma lo transcribe a texto.
   - **Evidencia fotográfica** *(opcional)* — sube fotos (PNG o JPG, hasta 10 MB) o tómalas con la
     cámara del teléfono.
4. Revisa la **Confirmación de envío** y envía.

![Pantalla Reportar con las opciones Hallazgo e Incidente](/img/incidentes/reportar.png)

> El reporte queda registrado **con tu nombre** (*Reportado por*), y quienes gestionan la obra
> pueden verificarlo.

> **Reporta los hallazgos aunque parezcan menores.** Una herramienta en mal estado o una
> protección faltante, detectadas a tiempo, evitan el accidente de mañana y son evidencia de tu
> gestión preventiva.

## El listado

Busca por descripción y filtra por **gravedad**, **estado de cierre** (abiertos o cerrados) y
**etapa**. Cada evento muestra su estado: **Reportado**, **En investigación**, **En proceso**,
**Abierto** o **Cerrado**.

Al tocar un evento ves su detalle: etapa, días perdidos, trabajador afectado, evidencias
fotográficas, quién lo reportó y las investigaciones asociadas.

### Gestionar un evento

Quien tiene permiso ve la sección **Gestionar**:

- **Editar gobernanza** — define el **Responsable** del seguimiento (Prevencionista, Jefe
  directo o Comité paritario), el **Plazo de respuesta**, el **Responsable de cierre**, el
  **Estado de cierre** y un comentario de cierre.
- **Marcar como accidente** — califica un incidente como accidente. Requiere el permiso
  **Calificar accidente**.

### Investigaciones

Los incidentes **graves y fatales** requieren una **investigación** con árbol de causas y
medidas correctivas (Art. 71). Se registran desde **Detalle de obra → Cumplimiento DS 44 →
Verificar → Investigaciones AT/EP**, y sus medidas se siguen en **Actuar → Medidas
correctivas**. Ver [Obras](/modulos/obras#módulos-de-cada-fase).

## Estadísticas

La pestaña **Estadísticas** muestra el **Consolidado estadístico** de la obra:

- Totales de **Hallazgos**, **Incidentes** y **Accidentes**.
- **Tasa de accidentabilidad**.
- **% Hallazgos cerrados** y **Índice proactivo** (hallazgos sobre el total de eventos: cuanto
  más alto, más se está previniendo).
- Gráficos de **Tendencia mensual** y **Por etapa constructiva**, y un **Calendario** con los
  días que tuvieron eventos.

Puedes descargar el consolidado en **CSV** o **PDF**.

## Preguntas frecuentes

**¿Cuál es la diferencia entre hallazgo, incidente y accidente?**
Un **hallazgo** es una condición o acción insegura detectada *antes* de que cause daño. Un
**incidente** es un evento que ocurrió, con o sin lesión. Un **accidente** es un incidente que
causó lesión a un trabajador; lo califica quien tiene ese permiso.

**¿Cualquier persona puede reportar?**
Un hallazgo, sí. Un incidente, quien tenga el permiso **Reportar incidente**.

**Reporté algo por error.**
Avisa al prevencionista o al administrador. Los registros se conservan para no perder la
trazabilidad, pero se pueden aclarar en la gestión del evento.

**No veo la pestaña Estadísticas (o Listado).**
Cada una depende de un permiso (**Ver estadísticas** y **Ver historial**). Consulta con el
administrador.

**Los datos de salud del afectado, ¿quién los ve?**
Los datos de un accidente incluyen información de la persona afectada. Trátalos con reserva y
compártelos solo con quien participa en la investigación.
