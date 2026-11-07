# Personas

El módulo **Personas** es el registro de quienes trabajan en tu empresa. Aquí das de alta a
cada persona, defines su **rol** (qué puede hacer en la plataforma) y su **cargo** (qué hace en
obra), y armas el equipo de cada obra.

## Dos vistas del mismo módulo

Lo que ves en **Personas** depende de dónde estás:

- **En la vista de empresa** — el **directorio completo** de la empresa. Aquí se **da de alta**
  a la gente (una a una o con **Carga masiva**). Puedes buscar por nombre o RUT y filtrar por
  rol y cargo.
- **Dentro de una obra** — el **equipo de esa obra**, ordenado por cuadrillas. Aquí solo se suma
  a personas **que ya existen en la empresa**.

![Directorio de personas con los botones Nueva persona y Carga masiva](/img/personas/listado.png)

:::: solo personas.crear
## Agregar una persona

1. En la vista de empresa, toca **Nueva persona**.
2. Completa las secciones:
   - **Datos personales** — **RUT** y **Nombre** *(obligatorios)*, apellidos, fecha de
     nacimiento, correo y teléfono.
   - **Acceso y rol** — el **Rol** *(obligatorio)*, el **Cargo** (define qué le exige el DS 44)
     y el nivel de escolaridad.
   - **Asignación a obras** *(opcional)* — al asignarla a una obra empieza su **onboarding DS
     44** en esa obra. Si elegiste una obra al entrar, aparece marcada. Si la obra tiene
     supervisores, puedes elegir su **cuadrilla**.
   - **Contacto de emergencia** *(opcional)* — va al expediente del trabajador.
3. Guarda. Verás **Persona creada**.

![Formulario de nueva persona](/img/personas/nueva-persona.png)

::: info Su primer acceso
Toda persona registrada puede entrar a la plataforma con su **RUT** y, como **contraseña
inicial, los cuatro primeros dígitos de su RUT**. Al entrar se le pide cambiarla y crear su PIN
de firma. Si no tiene correo, no recibe ningún aviso: **díselo en persona**.
:::

> **Rol ≠ Cargo.** El **rol** es el nivel de acceso en la plataforma. El **cargo** es su oficio
> en obra y define qué documentos y capacitaciones de seguridad le corresponden. Una persona
> tiene un rol y puede tener uno o más cargos.
::::

:::: solo personas.crear
## Carga masiva

Para registrar a muchas personas de una vez, en la vista de empresa toca **Carga masiva**. Son
tres pasos:

1. **Subir** — toca **Descargar plantilla Excel**: trae los roles, cargos y obras de tu empresa
   como desplegables. Complétala (una fila por persona; el supervisor de la cuadrilla se indica
   por su RUT), arrástrala o búscala en tu equipo y toca **Revisar el archivo**. **Subir el
   archivo no crea a nadie todavía.**
2. **Revisar y corregir** — ves cada fila marcada como **Listo**, **Con advertencia** o **Con
   error**. Con **Solo con problemas** te enfocas en lo que hay que arreglar. Si quieres, marca
   **Enviar credenciales por email**.
3. **Resultado** — la carga se procesa por partes y muestra cuántas personas se **crearon**,
   cuántas están **pendientes** y cuántas **fallaron**, con el motivo. Lo que falló por un
   problema pasajero se puede reintentar; las filas con datos inválidos o duplicados se
   corrigen en la planilla y se vuelven a cargar.

Abajo, **Cargas recientes** muestra las cargas anteriores.

![Carga masiva: descargar la plantilla y subir el archivo](/img/personas/carga-masiva.png)
::::

## La ficha de una persona

Al tocar a una persona se abre su **ficha**, con su foto, nombre, cargo y estado, y dos
pestañas:

- **Datos** — datos personales, **contacto de emergencia**, **vigilancia de salud**,
  **entregas de EPP** y su **PIN de firma**.
- **Asignaciones** — su **onboarding DS 44** (qué está completado, pendiente o no aplica), sus
  **obras** actuales y anteriores, el **historial de cumplimiento** con todas sus firmas, sus
  **cursos y certificaciones** y sus **evidencias vigentes** (examen de altura, certificados).

Arriba están **Editar** y **Exportar ficha**.

![Ficha de una persona](/img/personas/ficha.png)

:::: solo persona.vigilancia_salud
### Vigilancia de salud

Quien tiene el permiso **Editar vigilancia de salud** registra si la persona está **En
vigilancia**, sus **Protocolos** (por ejemplo PLANESI, ruido, sílice), el **Último examen**, su
**Aptitud laboral** y sus **Restricciones**. Son datos de salud: los ve solo quien tiene ese
permiso.
::::

:::: solo persona.restablecer_pin
### Restablecer el PIN

Si la persona olvidó su PIN, quien tiene el permiso **Restablecer PIN de firma** (por defecto,
solo el administrador) toca **Restablecer PIN** en la ficha y escribe el **motivo**. La persona
recibe un aviso con tu nombre y el motivo, y crea uno nuevo desde **Configuración**.
::::

:::: solo persona.desvincular
### Eliminar a alguien de la empresa

**Eliminar persona** la desvincula de la empresa y de todas sus obras. **No se puede
deshacer**, y por eso pide escribir una confirmación. Sus firmas y documentos se conservan para
una eventual fiscalización.
::::

## Preguntas frecuentes

**¿Qué diferencia hay entre rol y cargo?**
El **rol** define qué puede hacer en la plataforma. El **cargo** define su trabajo en obra y,
con eso, qué documentos y capacitaciones necesita.

**Creé a la persona, pero no puede entrar.**
Su contraseña inicial son los cuatro primeros dígitos de su RUT. Si ya la cambió y no la
recuerda, puede usar **¿Olvidaste tu contraseña?** (si tiene correo registrado).

**¿Puedo asignar una persona a varias obras?**
Sí. Puede trabajar en varias obras a la vez, con su cargo en cada una.

**No puedo agregar a alguien a la obra: no aparece.**
Dentro de una obra solo aparecen personas que ya existen en la empresa. Dala de alta primero en
la vista de empresa.

**¿Quién puede crear o editar personas?**
Quien tenga los permisos **Añadir personas** y **Ver detalle**. Por defecto, administración y
jefatura de obra crean; prevención y supervisión ven y gestionan el onboarding.

**Una persona dejó una obra pero sigue en la empresa.**
Usa **Dar de baja** en el equipo de esa obra, o **Transferir** si se va a otra. **Eliminar
persona** es para quien deja la empresa.
