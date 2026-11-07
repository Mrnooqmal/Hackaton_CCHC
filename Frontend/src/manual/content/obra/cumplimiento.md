# Seguir el cumplimiento del FUF en la obra

La ficha de cada obra muestra, requisito por requisito del **Formulario Único de Fiscalización
(FUF)**, qué se le exige a esa obra y en qué estado está. La plataforma no certifica que la obra
cumpla: muestra qué evidencia hay registrada y qué falta. Lo ves en **Detalle de obra →
Cumplimiento DS 44**.

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

Arriba ves el **Avance DS 44 de la obra** (en porcentaje) y las **cuatro fases** en que la
plataforma ordena los requisitos: **Planificar**, **Hacer**, **Verificar** y **Actuar**. Cada fase muestra su avance y
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
| **Designar** | Ir a [Mi Empresa](/empresa) a designar al representante legal. |
| **Registrar** | Dejar constancia de un envío que el DS 44 exige (ver más abajo). |
| **Sí / No** | Responder si una condición aplica a la obra. Con **No**, el requisito pasa a *No aplica*. |
| **Ver** | Abrir el documento que ya lo acredita, o el módulo donde se gestiona. |

En las capacitaciones aparece además **o prográmala en la plataforma**: en vez de subir el
certificado de una capacitación externa, puedes programarla en
[Actividades](/obra/actividades).

Los estados se explican en [Estados de cumplimiento](#estados-de-cada-requisito).

:::: solo obra.subir_documentos
### Cargar un documento y pedir las firmas

Al tocar **Cargar** en un requisito:

1. Selecciona o arrastra el **Archivo** (PDF o imagen, hasta 10 MB).
2. Indica la **Fecha del hecho**: cuándo ocurrió lo que el documento acredita (la
   capacitación, el simulacro), no el día en que lo subes. Y su fecha de **caducidad**.
3. *(Opcional)* Elige **quiénes deben firmarlo**: personas de la obra, una por una, o **Todas
   las personas de la obra**. Cada persona elegida lo recibe en [Mis firmas](/terreno/firmar) y
   lo firma con su PIN.
4. Toca **Cargar documento**.

![Cargar el documento de un requisito, con fecha y firmantes](/img/obras/cargar.png)

**Subir el archivo no es firmarlo**: mientras falten firmas, el requisito queda como
*Pendiente de firma*.
::::

### Módulos de cada fase

Al lado de los requisitos están los **Módulos de la fase**: las herramientas donde se registra
el trabajo diario que después acredita los requisitos. Se abren en un panel sin salir de la
obra.

| Fase | Módulos |
| --- | --- |
| **Planificar** | **Estructura preventiva** — comité paritario o delegado de la obra. Ver [Estructura preventiva](/obra/estructura). |
| **Hacer** | **Registro de actividad preventiva** (Art. 72), **Onboarding de la obra**, **Registros de gestión** y **Eventos sobrevinientes** (registros que solo existen si ocurre el hecho; no cuentan como faltante). |
| **Verificar** | **Consolidado del período** (siniestralidad, investigaciones, medidas, vigilancia) e **Investigaciones AT/EP** (informes de incidentes graves y fatales, Art. 71). |
| **Actuar** | **Medidas correctivas**, **Actualizaciones hacia Planificar** (MIPER, programa y reglamento que toca revisar) y **Prescripciones** (Art. 70). |

![Panel de un módulo de la fase Hacer](/img/obras/modulo-fase.png)

:::: solo obra.subir_documentos
### Registrar un envío

Algunos documentos no basta con tenerlos: el DS 44 exige **remitirlos** a ciertos destinatarios
(personas trabajadoras, comité paritario o delegado, organizaciones sindicales, línea de mando o
departamento de prevención, según el documento). Por ejemplo, el reglamento interno se remite
con anticipación a su entrada en vigencia.
En esos requisitos, **Registrar** abre las **Constancias de envío**:

- **Vigencia** — con **Declarar fecha** indicas desde cuándo rige el documento; de esa fecha
  depende el plazo de anticipación del envío.
- **Destinatarios** — cada uno aparece como *Sin constancia*, *Enviado*, *Fuera de plazo* o *No
  aplica*. Con el botón de enviar de cada uno anotas el **medio**, la **fecha del envío**, una
  observación y el **respaldo** (el acuse de recibo, el acta o la captura del correo).

![Constancias de envío de un documento](/img/obras/registrar-envio.png)
::::

## Las cuatro fases

Para ordenar el trabajo, la plataforma agrupa los requisitos del FUF de cada obra en cuatro fases.
Es un **esquema propio de la plataforma**, no una estructura del decreto: el FUF no fiscaliza por
fases, y un requisito cuenta igual en cualquier fase en que se resuelva.

| Fase | Qué se hace | Ejemplos de requisitos |
| --- | --- | --- |
| **Planificar** | Identificar los riesgos y planificar cómo controlarlos. | Matriz de riesgos (MIPER), Programa de Trabajo Preventivo, plan de emergencias, reglamento interno, mapa de riesgos, estructura preventiva. |
| **Hacer** | Ejecutar lo planificado. | Entrega de EPP, información de riesgos al trabajador (IRL), capacitaciones, procedimientos de trabajo seguro, simulacro anual, comité paritario y sus reuniones, vigilancia de la salud. |
| **Verificar** | Revisar si se cumplió. | Evaluación anual del programa, registro de la actividad preventiva, investigación de accidentes, indicadores. |
| **Actuar** | Corregir y mejorar. | Revisión periódica del reglamento interno, implementación de las medidas prescritas, actualización de la MIPER y del programa. |

Los requisitos son los del **Formulario Único de Fiscalización (FUF)** con que fiscaliza la
Dirección del Trabajo: cada fila muestra su número (por ejemplo *FUF 8*) y el artículo del
decreto. Algunos requisitos que el DS 44 exige pero el formulario no numera aparecen por su
artículo.

## La fase avanza sola

La obra tiene siempre una fase **En curso**. **No hay un botón para avanzar**: cuando todos los
requisitos exigibles de la fase quedan completados, la obra pasa sola a la siguiente.

Puedes resolver requisitos de **cualquier fase en cualquier momento**: no hace falta esperar a
llegar a ella.

## Estados de cada requisito

| Estado | Qué significa | ¿Cuenta en el porcentaje? |
| --- | --- | --- |
| **Completado** | La evidencia existe y está completa (firmada, si se exige). | Sí, completo. |
| **Pendiente de firma** | El documento está cargado, pero faltan firmas de las personas asignadas. | Sí, a medias. |
| **Incompleto** | La evidencia existe, pero le falta algo: una fecha, una constancia de envío, un participante. La fila dice qué. | Sí, a medias. |
| **Pendiente** | No hay evidencia, pero todavía hay plazo. | Sí, como faltante. |
| **Vencido** | No hay evidencia vigente y el plazo pasó, o la revisión venció. | Sí, como faltante. |
| **No aplica** | El requisito no se le exige a esta obra (por su dotación o sus condiciones). | **No**: sale del cálculo. |

::: info "No aplica" lo decide la plataforma
Un requisito pasa a **No aplica** según la dotación de la obra y sus condiciones (faena
compartida, maquinaria, agentes físicos, químicos o biológicos). **No se puede marcar a mano**:
así el sistema nunca certifica una exención que nadie comprobó. Si una condición está mal,
corrígela respondiendo **Sí / No** en el requisito.
:::

## El porcentaje de avance

El **Avance DS 44 de la obra** se calcula solo sobre los requisitos **exigibles**: lo que no
aplica no castiga. Un requisito **Pendiente de firma** o **Incompleto** suma medio punto.

## Exportar el formulario

Desde la ficha de la obra (y desde el Repositorio) puedes abrir el **reporte imprimible del
FUF**, con cada requisito, su estado y su evidencia, para presentarlo en una fiscalización.

## Preguntas frecuentes

**¿Cómo paso a la siguiente fase?**
No se pasa a mano: cuando la fase en curso queda completa, la obra avanza sola.

**Un requisito de la fase Hacer ya está completo, pero estoy en Planificar.**
Está bien: se puede resolver en cualquier momento, y cuenta cuando la obra llegue a esa fase.

**Subí el documento y sigue sin completarse.**
Lee la línea **Falta…** del requisito: muchas veces falta una firma, una fecha o una constancia,
no otro archivo.

**¿Puede la empresa cambiar qué requisitos se exigen?**
No. Los requisitos son los del DS 44 y del formulario de fiscalización. Lo que sí se configura
es lo que se exige a cada cargo en el onboarding. Ver
[Onboarding por cargo](/empresa/cargos).
