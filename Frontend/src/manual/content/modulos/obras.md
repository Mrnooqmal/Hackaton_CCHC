# Obras

Una **obra** es cada proyecto de construcción. Dentro de ella viven su equipo, sus documentos,
sus actividades, sus incidentes y el seguimiento del cumplimiento del DS 44.

> **¿Quién puede crear obras?** Quien tenga el permiso **Crear obra** y pueda entrar a la
> **vista de empresa** (permiso **Ver Mi Empresa**). Con la configuración de fábrica, eso es
> solo el **Administrador**. Ver [Roles](/roles/#la-vista-de-empresa).

## El listado de obras

El listado está en la **vista de empresa**: en el menú lateral, **Obras**. Muestra todas las
obras de la empresa, con el subtítulo *"Proyectos activos, documentos DS44 y personal
asignado"*.

![Listado de obras con el botón Nueva obra](/img/obras/listado.png)

Cada obra muestra su foto, nombre, ubicación y un estado de color: **Activa**, **Pausada** o
**Finalizada**. Arriba puedes **buscar** por nombre, código o dirección, **filtrar por estado**
y alternar entre vista de **tarjetas** y de **tabla**.

Si todavía no hay obras, verás *"Sin obras registradas"* con un botón para crear la primera.

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

## La ficha de la obra

Con la obra elegida, entra a **Detalle de obra** en el menú lateral. Arriba ves la foto, el
nombre y dos pestañas: **Resumen** y **Cumplimiento DS 44**. A la derecha están **Editar obra**
y el botón para **exportar** el reporte imprimible del Formulario Único de Fiscalización.

### Resumen

![Pestaña Resumen de la obra](/img/obras/resumen.png)

- **Identificación** — mandante, código, fecha de registro y plano referencial.
- **Ubicación**, con un enlace para abrirla en el mapa.
- **Dotación** — cuántas personas trabajan en la obra y qué órgano preventivo le corresponde
  por eso:

  | Personas en la obra | Órgano que exige el DS 44 |
  | --- | --- |
  | 1 a 9 | Ninguno obligatorio |
  | 10 a 25 | Delegado de Seguridad y Salud en el Trabajo |
  | Más de 25 | Comité Paritario de Higiene y Seguridad |

  Si la empresa declaró una dotación para la obra, se usa esa; si no, la de personas
  asignadas en la plataforma.
- **Accesos** al **Equipo**, a los **Incidentes** y a los **Documentos de la obra**.
- **Condiciones de la faena** — las tres características DS 44, con su respuesta.

### Cumplimiento DS 44

Es el corazón de la obra. Muestra, requisito por requisito, qué exige el DS 44 a esta obra y en
qué estado está cada uno.

![Pestaña Cumplimiento DS 44 con las cuatro fases](/img/obras/cumplimiento.png)

Arriba ves el **Avance DS 44 de la obra** (en porcentaje) y las **cuatro fases** del ciclo de
mejora: **Planificar**, **Hacer**, **Verificar** y **Actuar**. Cada fase muestra su avance y
cuántos requisitos están completados. La fase marcada **En curso** es en la que está la obra.

::: info La fase avanza sola
No hay que apretar nada para pasar de fase: cuando una fase queda completa, la obra pasa sola
a la siguiente. Puedes ir resolviendo requisitos de cualquier fase en cualquier momento.
:::

Debajo están los **Requisitos** de la fase elegida. Si son muchos, se agrupan por tema (MIPER y
mapa de riesgos, Programa de Trabajo Preventivo, Equipos y EPP, Emergencias…), y se abre solo el
primer grupo con algo por resolver. Puedes **filtrar por estado**: Vencido, Pendiente,
Incompleto, Pendiente de firma o Completado.

Cada fila dice qué es el requisito, su número en el formulario (por ejemplo *FUF 8 · Art. 8
inc. 1*) y, si falta algo, **qué falta**, en palabras. A la derecha, una sola acción según lo
que se necesite:

| Acción | Qué hace |
| --- | --- |
| **Cargar** | Subir el documento que acredita el requisito (ver más abajo). |
| **Firmantes** | Elegir quiénes deben firmar un documento ya cargado. |
| **Recordar** | Volver a avisar a quienes todavía no firman. |
| **Solicitar** | Pedir la firma de una persona puntual, como el representante legal. |
| **Nueva versión** | Renovar un documento cuya revisión venció. |
| **Designar** | Ir a [Mi Empresa](/modulos/tenants) a designar al representante legal. |
| **Registrar** | Dejar constancia de un envío que el DS 44 exige (ver más abajo). |
| **Sí / No** | Responder si una condición aplica a la obra. Con **No**, el requisito pasa a *No aplica*. |
| **Ver** | Abrir el documento que ya lo acredita, o el módulo donde se gestiona. |

En las capacitaciones aparece además **o prográmala en la plataforma**: en vez de subir el
certificado de una capacitación externa, puedes programarla en
[Actividades](/modulos/actividades).

Los estados se explican en [Estados de cumplimiento](/ds44/fases-obra#estados-de-cada-requisito).

### Cargar un documento y pedir las firmas

Al tocar **Cargar** en un requisito:

1. Selecciona o arrastra el **Archivo** (PDF o imagen, hasta 10 MB).
2. Indica la **Fecha del hecho**: cuándo ocurrió lo que el documento acredita (la
   capacitación, el simulacro), no el día en que lo subes. Y su fecha de **caducidad**.
3. Elige a **quiénes firman**. Cada persona elegida lo recibe en
   [Mis firmas](/modulos/firmas) y lo firma con su PIN.

**Subir el archivo no es firmarlo**: mientras falten firmas, el requisito queda como
*Pendiente de firma*.

### Módulos de cada fase

Al lado de los requisitos están los **Módulos de la fase**: las herramientas donde se registra
el trabajo diario que después acredita los requisitos. Se abren en un panel sin salir de la
obra.

| Fase | Módulos |
| --- | --- |
| **Planificar** | **Estructura preventiva** — comité paritario o delegado de la obra. Ver [Estructura preventiva](/modulos/estructura-preventiva). |
| **Hacer** | **Registro de actividad preventiva** (Art. 72), **Onboarding de la obra**, **Registros de gestión** y **Eventos sobrevinientes** (registros que solo existen si ocurre el hecho; no cuentan como faltante). |
| **Verificar** | **Consolidado del período** (siniestralidad, investigaciones, medidas, vigilancia) e **Investigaciones AT/EP** (informes de incidentes graves y fatales, Art. 71). |
| **Actuar** | **Medidas correctivas**, **Actualizaciones hacia Planificar** (MIPER, programa y reglamento que toca revisar) y **Prescripciones** (Art. 70). |

### Registrar un envío

Algunos documentos no basta con tenerlos: el DS 44 exige **remitirlos** a ciertos destinatarios
(personas trabajadoras, comité paritario o delegado, organizaciones sindicales, línea de mando o
departamento de prevención, según el documento). Por ejemplo, el reglamento interno se remite
con anticipación a su entrada en vigencia.
En esos requisitos, **Registrar** abre las **Constancias de envío**: para cada destinatario
anotas el **medio**, la **fecha del envío**, una observación y el **respaldo** (el acuse de
recibo, el acta o la captura del correo).

## El equipo de la obra

El equipo no se arma en la ficha: está en **Personas**, con la obra elegida. Ver
[Personas](/modulos/personas#el-equipo-de-una-obra).

## Editar, pausar o finalizar

Con **Editar obra** cambias el nombre, el **Estado** y las características DS 44:

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
