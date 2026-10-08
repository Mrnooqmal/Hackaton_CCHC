# Datos personales

La **Ley 21.719** de protección de datos personales da a cada persona (el **titular**) derechos
sobre sus datos: saber qué se guarda, corregirlo, pedir que se borre, oponerse a su uso o
llevárselo. La empresa tiene que **registrar** esas solicitudes y **responderlas dentro de
plazo**. En la plataforma eso se hace en **Mi Empresa**, en dos pestañas:

- **Datos personales** — las solicitudes de los titulares.
- **Supresiones** — el borrado de datos, con control de dos personas.

| Pestaña | Permiso necesario | Por defecto |
| --- | --- | --- |
| Datos personales | **Derechos de los titulares** | Solo el administrador |
| Supresiones | **Aprobar y ejecutar supresiones** | Solo el administrador |

Ambos permisos se pueden delegar, por ejemplo a Recursos Humanos, desde
[Mi Empresa → Roles y permisos](/modulos/tenants#roles-y-permisos).

## Solicitudes de los titulares

![Solicitudes de los titulares](/img/tenants/datos-personales.png)

### Registrar una solicitud

Cuando una persona pide algo sobre sus datos (por correo, carta, en persona en obra), regístralo:

1. Toca **Registrar solicitud**.
2. Completa:
   - **Titular** — la persona.
   - **Qué pide** — el derecho que ejerce: **acceso**, **rectificación**, **supresión**,
     **oposición**, **portabilidad** o **bloqueo**.
   - **Por dónde llegó** — por ejemplo *correo a rrhh@empresa.cl* o *en persona en obra*.
   - **Cuándo llegó** — el plazo de respuesta parte **cuando llegó la solicitud**, no cuando se
     registra. **Esta fecha no se puede corregir después.**
   - **Detalle** *(opcional)* — qué pide, en sus palabras.
3. Guarda.

::: warning Algunas solicitudes bloquean los datos
Si la persona pide **rectificar**, **suprimir**, **oponerse** o **bloquear**, sus datos quedan
**bloqueados** desde que se registra: sale de los listados, no se la convoca ni se le avisa y
**no puede firmar** hasta que se responda. Los datos **no se borran**, y se sigue contando en la
dotación y en los informes a la autoridad.
:::

### Plazos

- La empresa responde dentro de **30 días** desde que llegó la solicitud.
- Puede **prorrogar una sola vez** (30 días más), y **solo si se lo comunicó al titular antes
  del primer vencimiento**. Pasado ese plazo, la plataforma ya no permite registrar la
  prórroga.
- Quien gestiona recibe **avisos** cuando se acerca un vencimiento.

Con los filtros de arriba ves las solicitudes **Abiertas**, **Resueltas** o **Todas**. Cada una muestra cuándo se
recibió, por qué canal, su plazo de respuesta y si tiene datos bloqueados.

### Responder

1. En la solicitud, toca **Responder**.
2. Indica el **Resultado** (acogida, acogida en parte o rechazada) y **qué se hizo y con qué
   fundamento**: es lo que se le comunica al titular. Si se conserva algo, di hasta cuándo y
   por qué.
3. Indica **cuándo** y **por qué medio** se le comunicó.

Si la respuesta implica borrar datos, toca **Proponer lote de supresión**: los datos siguen
bloqueados hasta que el borrado se ejecute en un lote aprobado por dos personas.

El **Historial** de cada solicitud registra cada paso y **no se puede editar ni borrar**.

## Supresiones

Borrar datos personales es **irreversible**, incluidos los archivos y todas sus versiones. Por
eso exige **dos personas**: una **aprueba** el lote viendo exactamente qué se va a borrar, y
**otra distinta** lo **ejecuta**.

1. Se **propone** un lote. Las supresiones que pide un titular se proponen desde su solicitud;
   las que corresponden porque venció el plazo de conservación de los datos las propone la
   plataforma.
2. Quien aprueba revisa las **personas afectadas** y el contenido, y toca **Aprobar este
   contenido**.
3. **Otra persona** toca **Ejecutar la supresión** y escribe la confirmación.

Los estados de un lote son: **Por aprobar**, **Aprobado, por ejecutar**, **Ejecutándose**,
**Ejecutado** (con el resultado: cuántas operaciones y versiones de archivos se suprimieron) o
**Ejecutado con errores**.

> Si los datos **cambian** entre que se propone y se ejecuta, el lote queda **Desactualizado**:
> no se puede aprobar ni ejecutar, y hay que proponer uno nuevo. Así se borra exactamente lo
> que se aprobó.

## Preguntas frecuentes

**¿Cómo sé qué se va a borrar?**
Antes de aprobar, el lote muestra exactamente qué se suprime: las personas afectadas, cada dato y
cada versión de archivo. Lo que está bajo **retención legal** no entra. Después de ejecutarlo,
el resultado dice qué se borró.

**Aprobé un lote y no me deja ejecutarlo.**
Es intencional: quien aprueba no puede ejecutar. Lo tiene que hacer otra persona con el permiso.

**Registré la solicitud con la fecha equivocada.**
La fecha de recepción no se puede corregir, porque de ella depende el plazo legal. Deja la
aclaración en el detalle o en la respuesta.
