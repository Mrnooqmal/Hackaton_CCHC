# Cargos, kits de incorporación y catálogos

El DS 44 exige que cada persona, según su oficio, reciba cierta información, capacitación y
elementos de protección **antes de trabajar**. En la plataforma eso es el **kit de onboarding**
de cada cargo: la lista de lo que se le exige a un carpintero, a un jornal o a un trazador.

Cuando sumas a una persona a una obra con su cargo, la plataforma le genera ese kit, y en su
ficha ves qué tiene completo y qué le falta para quedar **apta para ingresar a terreno**.

Está en la **vista de empresa**: en el menú lateral, **Onboarding** (o en
**Mi Empresa → Cargos → Onboarding por cargo**). Requiere el permiso **Gestionar cargos y
kits**, además de poder entrar a la vista de empresa.

![Onboarding por cargo con el catálogo de cargos y el kit de uno de ellos](/img/onboarding/cargos.png)

## Documentos de empresa

Arriba están los **Documentos de empresa**: los que **aplican a todos los cargos** y se envían a
cada trabajador nuevo, sin importar la obra (por ejemplo, el reglamento interno y la política de
seguridad). Se suben o renuevan aquí **una sola vez**.

## El kit de un cargo

A la izquierda está la lista de cargos. Al elegir uno ves su kit: cada **ítem** es algo que el
DS 44 exige a ese cargo. Puedes **Agregar ítem**, editarlo o eliminarlo.

![Edición de un ítem del kit de onboarding](/img/onboarding/item.png)

Cada ítem tiene:

- **Título** y, si lo usas, un **Código EBCO** (por ejemplo *PR-PO-08*).
- **Naturaleza** — *Procedimiento corporativo*, *Derivado del MIPER* o *Evidencia individual*.
- **Acción de onboarding** — qué tiene que pasar para darlo por cumplido:

  | Acción | Qué significa |
  | --- | --- |
  | **Difusión + firma** | La persona recibe el documento y firma que lo conoce. |
  | **Capacitación + evaluación** | Se le capacita y se evalúa, con **nota mínima** de 70 % (general) o 90 % (altura y SPDC). |
  | **Entrega de EPP** | Se le entregan los elementos de la **matriz de EPP** del cargo. |
  | **Evidencia externa** | Un certificado o examen que viene de fuera (por ejemplo, el examen de altura). |
  | **Ingreso a vigilancia (MINSAL)** | Su ingreso a un programa de vigilancia de la salud. |
  | **Encuesta** | Una encuesta que debe responder. |

- **Alcance del documento** — de dónde sale el archivo:
  - **Empresa** — un documento para todas las obras.
  - **Obra** — uno propio de cada obra (por ejemplo, derivado de su matriz de riesgos); se
    configura en cada obra, no aquí.
  - **Persona** — una evidencia individual de cada trabajador.
- **Bloqueante para ingresar a la obra** — si está marcado, la persona no queda **apta para
  terreno** hasta completarlo. No impide registrarla.
- **Matriz de EPP** *(en ítems de entrega de EPP)* — los elementos que corresponden al cargo.
  Marca como **Crítico** el que debe entregarse antes de entrar a la obra.

Guarda el ítem con **Guardar ítem**. Con **Subir documento** cargas el archivo de un ítem de
alcance empresa.

## Crear, duplicar y eliminar cargos

- **Nuevo cargo** — escribe el **Nombre del cargo** (por ejemplo *Enfierrador*). Después cargas
  su información de riesgos (IRL) y sus documentos.
- **Duplicar** — copia el kit de un cargo para crear uno parecido.
- **Eliminar** — quita el cargo y su kit del catálogo.

Cuando haces cambios aparece **Cambios sin guardar**: guarda para que queden en la empresa.

## Restablecer el catálogo

**Restablecer catálogo** reemplaza todos los cargos por el catálogo predefinido. Se pierden los
cargos personalizados y los documentos subidos quedan sin referencia. Úsalo con cuidado.

## Cargos

El catálogo de **cargos** de la empresa (carpintero, jornal, maestro albañil, trazador…). Cada
uno aparece como **Predefinido** (viene de fábrica), **Personalizado** (lo creó la empresa) o
**Heredado**, con cuántas personas lo tienen.

Lo que el DS 44 exige a cada cargo (su **kit de onboarding**) se edita en **Onboarding por
cargo**, el botón de esta pestaña. Ver [Onboarding por cargo](/empresa/cargos).

![Pestaña Cargos con el botón Onboarding por cargo](/img/tenants/cargos.png)

## EPP

El catálogo de **elementos de protección personal** de la empresa. Las entregas de EPP solo
pueden incluir elementos de este catálogo.

![Pestaña EPP con el catálogo y el botón Nuevo elemento](/img/tenants/epp.png)

1. Toca **Nuevo elemento**.
2. Escribe el **Nombre del elemento** y, si quieres, una descripción.
3. Sube los **respaldos obligatorios del DS 44**:
   - **Certificado de calidad o registro ISP**.
   - **Instructivo de uso y mantención** (uso, mantenimiento, reposición o recambio).

Toca **Guardar elemento**. Puedes guardarlo sin sus respaldos, pero quedará marcado como
**incompleto** en el catálogo y en cada entrega que lo incluya.

![Nuevo elemento de EPP con sus respaldos obligatorios](/img/tenants/epp-nuevo.png)

## Catálogos de actividades

Los **catálogos** son las listas desplegables que se usan al planificar una charla o un ART:
**temas tratados**, **recursos y equipos**, **riesgos comunes** y **medidas de prevención**.
Vienen con un conjunto de fábrica y cada empresa los puede adaptar. Aplican a **todas las obras**
de la empresa.

Están en la **vista de empresa**: en el menú lateral, **Catálogos**. Requiere el permiso
**Gestionar cargos y kits**, además de poder entrar a la vista de empresa.

![Catálogos de actividades con sus cuatro listas](/img/catalogos/inicio.png)

### Editar un catálogo

En cada una de las cuatro listas puedes:

- **Agregar** una opción: escribe en el último campo de la lista (*Agregar tema…*, *Agregar
  recurso…*) y presiona **Enter**.
- **Renombrar** una opción: toca su texto, corrígelo y presiona **Enter** o sal del campo.
  **Escape** descarta el cambio.
- **Eliminar** una opción con el ícono del basurero.

**Cada cambio se guarda al hacerlo**: arriba verás *Guardando…* y luego *Cambios guardados*. Si
te equivocas, tienes unos segundos para **Deshacer**. Si aparece *No se guardó el último cambio*,
revisa tu conexión y repítelo.

> Renombrar o eliminar una opción **no cambia las actividades ya registradas**: conservan el
> texto con que se guardaron.

Ver cómo se usan en [Actividades](/obra/actividades#planificación-diaria-charlas-y-art).

## Preguntas frecuentes

**Cambié el kit de un cargo. ¿Se actualiza en quienes ya están en obra?**
El kit se genera cuando la persona se suma a una obra o cambia de cargo. Si una persona cambia de
cargo, se archivan los documentos no firmados del cargo anterior y se generan los del nuevo; lo
ya firmado se conserva.

**Una persona tiene dos cargos.**
Recibe la unión de los dos kits, sin repetir ítems y quedándose con la exigencia más estricta
(la nota mínima más alta, bloqueante si alguno lo es).

**¿El examen de altura se pide en cada obra?**
No. Las evidencias externas vigentes de la persona se reutilizan entre obras.
