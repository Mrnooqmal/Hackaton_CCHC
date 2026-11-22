# Rediseño del módulo de incidentes y hallazgos

Decisiones tomadas el 15 de noviembre de 2026. Rama de trabajo: `incidentes-rediseño`.

Origen: el artefacto "Gestión de Casos SST" (propuesta de diseño de octubre de 2026), aterrizado sobre el código real y ajustado por las decisiones de este documento. Donde el artefacto y este documento se contradicen, manda este documento.

## 1. Enfoque

**El caso es el reporte más sus papeles.**

- La plataforma es un repositorio: guarda los documentos de cada caso, muestra cuáles faltan y ayuda a cumplir con el FUF. La empresa tiene sus papeles a mano.
- **Mutual no interviene en la plataforma.** No hay etapa de validación de Mutual, ni estado "devuelto por Mutual", ni registro de sus respuestas.
- **La DIAT es un archivo que se adjunta al caso.** La plataforma no la tramita ni la envía. Lo mismo vale para la DIEP.
- La prioridad es que **reportar un incidente o un hallazgo funcione de punta a punta**.

## 2. Qué se descartó del artefacto

- La etapa "validación de Mutual" y los retornos por observaciones de Mutual.
- El envío de la DIAT o de cualquier documento a Mutual.
- La DIAT como paso del flujo.
- La ficha del caso firmada con PIN: queda como opcional para más adelante.
- El rol "Mutual" del prototipo.

## 3. Flujo

1. **Reportar** el hallazgo o incidente. Cualquier persona, en terreno.
2. **Clasificar.** El prevencionista confirma el tipo y, si es accidente, la gravedad.
3. **Juntar los papeles** que ese tipo de caso exige.
4. **Medidas** con responsable y plazo.
5. **Cerrar** cuando los papeles y las medidas estén completos.

### Papeles por tipo de caso

| Tipo | Papeles del caso |
|---|---|
| Hallazgo | Reporte con foto, responsable y plazo, comentario de cierre |
| Incidente | Lo anterior, más el informe de investigación si es de alto potencial |
| Accidente | DIAT, informe de investigación, medidas correctivas |
| Accidente grave o fatal | Lo anterior, más la constancia del aviso a la Inspección del Trabajo y a la SEREMI de Salud |
| Enfermedad profesional | DIEP e informe de investigación |

El avance del caso es: papeles y medidas completos, sobre los que aplican a su tipo.

## 4. Arquitectura

- **Sin tabla ni función nueva.** El stack del backend usa 458 de 500 recursos de CloudFormation (D-16). El módulo de incidentes ya recibe todo `/incidents/*` en una sola Lambda con un enrutador interno: una ruta nueva cuesta 0 recursos.
- **El caso vive dentro del incidente**, en la tabla de incidentes. Los incidentes existentes no se migran: lo que falte se deriva al leerlos.
- **Una sola fuente para las reglas** (papeles por tipo, avance, siguiente paso): un módulo en `Backend/lib` con su espejo en `Frontend/src/utils`, como ya hacen `fuf.js` y `prescripciones.js`.
- **Pantallas nuevas en vez de agrandar `Incidents.tsx`**, que ya tiene más de 1.800 líneas.

## 5. Datos

### Reusar lo que la plataforma ya tiene

- **Persona afectada, responsables e investigadores:** se eligen desde Personas y se guarda el `personaId`, no nombres escritos a mano.
- **RUT, sexo y días perdidos del afectado:** el incidente ya los guarda. No se piden de nuevo.
- **Medidas correctivas:** se usa el campo `medidasCorrectivas` que ya existe y que la obra ya muestra.
- **Papeles del caso:** deben verse en el repositorio de documentos de la obra.

### Reglas de datos personales

- **Lo sensible va aparte y cifrado.** La identidad del afectado y cualquier dato de salud se guardan en el elemento `#traza` (`lib/traza-sensible.js`), para que ningún índice los copie.
- **Quién lee qué.** Sin el permiso `incidentes.historial`, cada persona ve solo lo que reportó. Eso se mantiene.
- **La DIAT y la DIEP traen RUT y datos de salud.** Se guardan en el almacenamiento de incidentes, visibles solo para quien tiene permiso de historial, con la descarga auditada.
- **La plataforma no lee ni interpreta los archivos.** Los guarda con su tipo y su fecha.
- **Retención.** Al vencer la retención de un incidente, sus papeles y los campos nuevos se borran o anonimizan con él. Hay que mantener al día el inventario de datos y la exportación para el titular.
- **Logs.** Solo identificadores: nunca el relato ni el RUT.
- **Sin destinatario nuevo.** Como no se envía nada a Mutual, el aviso de privacidad no cambia.

## 6. Huecos encontrados en el código

Salieron de leer el código el 15 de noviembre. La fase 1 debe confirmarlos antes de corregirlos.

1. **Las fotos de un trabajador probablemente se pierden.** `IncidentReportar.tsx` crea el reporte y después adjunta las fotos con `PUT /incidents/{id}`, que exige `incidentes.reportar`. Un trabajador que reporta un hallazgo no tiene ese permiso. La pantalla no revisa la respuesta y muestra "reportado correctamente".
2. **Después de reportar no hay "qué sigue".** La pantalla vuelve al listado.
3. **La DIAT ya se puede guardar, pero ninguna pantalla lo usa.** Existen `POST` y `GET /incidents/{id}/documents` (tipos `diat` y `diep`). Tampoco se usan desde la interfaz las investigaciones, el reporte rápido ni completar el reporte flash.
4. **El enlace de descarga de esos documentos es una URL directa al bucket**, sin firma.
5. **No hay pantalla para crear medidas correctivas.** Solo se cambia su estado desde la obra.

Aparecieron al implementar la fase 1:

6. **El aviso a prevención no salía.** En `incidents.repository.js`, el mensaje de la bandeja y el de SNS leían `incident.trabajador.nombre`, que no existe en el incidente guardado. El error se atrapaba en silencio. Una prueba lo confirmó.
7. **`POST /incidents/upload-evidence` firmaba una subida para la carpeta de cualquier incidente de la empresa.**
8. **El listado no enlazaba al detalle nuevo.**

Corregidos en la fase 1: los huecos 1, 2, 6, 7 y 8.

Decisión sobre el aviso a prevención: lleva solo el tipo, la obra, la fecha, la gravedad y el enlace al caso. No lleva el nombre ni el RUT del afectado, ni el relato. No se avisa a quien reportó.

Decididos el 15 de noviembre:

9. **El aviso va solo a personas en estado `activo`.** Quien no terminó de enrolarse no lo recibe. Se queda así.
10. **A quién se avisa: el prevencionista siempre, y además quien tenga el permiso.** Recibe el aviso quien tiene el rol prevencionista o el permiso `incidentes.calificar_accidente`, el de quien clasifica el caso (constantes `ROL_AVISO_SIEMPRE` y `PERMISO_AVISO_REPORTE` en `incidents.repository.js`).
    - El prevencionista lo recibe aunque su empresa le haya quitado ese permiso (decisión del 22 de noviembre). Antes, quitarle el permiso lo dejaba sin aviso.
    - Con los roles por defecto lo reciben prevencionista, jefe de obra y admin. No lo reciben supervisor ni trabajador.
    - Un rol personalizado con ese permiso lo recibe. Uno con otro nombre (por ejemplo "prevencionista_senior") no cuenta como prevencionista: solo lo recibe si tiene el permiso.
    - El admin lo recibe siempre, aunque la empresa haya editado sus permisos.
    - Si no se pueden leer los roles de la empresa, se usan los permisos por defecto de cada rol.
11. **El reporte rápido guarda el `personaId` de quien reporta en el campo del nombre del trabajador.** No se toca.

## 7. Fases

1. **Que reportar funcione de punta a punta.**
   - Corregir el adjunto de fotos.
   - Agregar el campo de medidas inmediatas.
   - Al enviar, llevar al detalle del reporte con su estado.
2. **Carpeta del caso.**
   - Detalle con la lista de papeles según el tipo, y cuáles faltan.
   - Subir DIAT, DIEP, informe de investigación y constancias, reutilizando las rutas que ya existen.
   - Descarga con enlace firmado y auditada.
3. **Clasificación, medidas y cierre.**
   - Triaje simple: tipo, alto potencial y gravedad.
   - Crear medidas con responsable y plazo.
   - Cierre que exige los papeles completos.
4. **Enlace con el FUF y el repositorio.**
   - Los papeles del caso aparecen en el repositorio de la obra.
   - Alimentan la completitud del registro (ítem 60) y de la investigación de accidentes, que hoy figura como ítem 66, "fuera del formulario".

Cada fase termina con sus pruebas pasando.

## 8. Cómo se trabaja

- La implementación la hace un agente (Opus 5.5, esfuerzo medio como máximo). Claude orquesta y verifica cada entrega.
- Las pruebas del backend se corren en Linux (WSL) con finales de línea LF: en Windows fallan por CRLF y por las barras de las rutas.
- Se despliega solo desde commits pusheados, con los scripts de `infra/`.

## 9. Estado

| Fase | Estado |
|---|---|
| 1. Reportar de punta a punta | Implementada el 15 de noviembre (1520 pruebas pasan después de traer `pruebas` del 21 de noviembre; build y lint sin errores). Falta probarla en el navegador |
| 2. Carpeta del caso | Implementada el 22 de noviembre (1552 pruebas pasan). Falta probarla en el navegador y contra S3 real |
| 3. Clasificación, medidas y cierre | Pendiente |
| 4. FUF y repositorio | Pendiente |

### Decisiones de la fase 2 (22 de noviembre)

- Los papeles del caso viven en `incidente.papeles`, una lista que solo crece. Las reglas de qué papel exige cada tipo de caso están en `Backend/lib/casos.js`, con su espejo en `Frontend/src/utils/casos.ts`.
- La subida es en dos pasos: primero se pide la URL y se sube el archivo, y después se confirma. El backend comprueba que el archivo exista antes de registrarlo.
- Sube papeles quien tiene `incidentes.reportar`. Los ve y descarga quien tiene `incidentes.historial`. La descarga es con enlace firmado de 15 minutos, y la de la DIAT y la DIEP queda en la auditoría de datos de salud.
- Ninguna otra respuesta del módulo entrega los papeles: solo la ruta de papeles.
- La DIEP se puede subir, pero no se exige (no hay tipo "enfermedad profesional").
- Un caso sin papeles requeridos cuenta como 100 %.

Riesgos conocidos de la fase 2, sin resolver:

- Un archivo que se sube y no se confirma queda en el bucket de evidencia, que no permite borrar durante 5 años. Lo mismo pasa con un archivo de más de 15 MB subido por un cliente que mienta sobre el tamaño. Una alternativa es subir primero al bucket de trabajo y copiar al de evidencia al confirmar.
- El nombre del archivo se guarda en claro en el incidente y puede traer el nombre de una persona. Se borra al anonimizar, pero no está cifrado.

## 10. Pendientes de decisión

- Plazos internos para clasificar e investigar: no son normativos.
- Indicadores por sexo: tocan `RegistroService`, compartido con los ítems 46 y 47. Acordarlo antes de cambiarlo.
- Qué criterios marcan un incidente como de alto potencial: el artefacto propone las dos preguntas de la guía de Mutual.
