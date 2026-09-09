# Levantamiento previo — Ítems 1, 50, 58 y repositorio seccionado

Fecha: 2026-09-09 · Commit base: b0b52a9 · Rama: pruebas

Notas exigidas por la regla 0.1. Recogen lo que EXISTE, no lo que debería.
Donde el encargo asume algo que el código contradice, gana el código (regla 0.2).

## 1. Hallazgo que cambia el entregable B

**Ya existe un mecanismo de difusión documental**, construido por otra persona en
el commit `9ef58fa`:

- `Document.difusiones[]`: `{ fecha, version, motivo, publicadaPor, destinatarios:
  { mando[], representantes[], firmantes[] }, totales }`.
- Lo escribe `EventBus.js:423` al publicar una nueva versión de un documento.
- `Frontend/src/utils/difusion.ts` tiene `ultimaDifusion`,
  `difundidoARepresentantes`, `totalInformados` y **`estadoPlazoReglamento`**, que
  implementa los 30 días corridos del Art. 57 inc. 2, o sea el núcleo del ítem 50.

**Dos problemas concretos:**

1. `estadoPlazoReglamento` es **código muerto**: ningún componente lo llama.
2. Aunque lo llamaran, recibe `fechaEntradaVigencia` como parámetro y **ese campo
   no existe en el modelo de Documento**. La función siempre devolvería
   `'sin_vigencia'`. El plazo del Art. 57 no se puede medir hoy.

**Además, los destinatarios no cubren lo que exige el Art. 57 inc. 2.** El
mecanismo actual reparte en `mando`, `representantes` y `firmantes`, que sirve
para los ítems 4 y 11 (MIPER y PTP). El ítem 50 exige otros tres:
personas trabajadoras, comité o delegado, y **organizaciones sindicales**.

## 2. Estado por entregable

| Entregable | Qué existe | Qué falta |
|---|---|---|
| **A** Ítem 1 SGSST | Los 4 componentes referenciados existen: estructura preventiva (`resumenAmbito`), MIPER, PTP (`lib/ptp.js`), evaluación anual | La vista agregadora y el tipo de documento de la Política de SST |
| **B** Ítem 50 | `difusiones` + cálculo de 30 días (muerto) | `fechaEntradaVigencia`, destinatarios del Art. 57, evidencia por destinatario, cablear el cálculo |
| **C** Ítem 58 | Nada | Todo |
| **D** Repositorio | Carpeta `ds44` que agrupa por `doc.fase` (fase Deming) | Seccionado por las 15 secciones del FUF |

## 3. Contradicción con la sección D.3 del encargo

El encargo pide **un solo catálogo de secciones e ítems del FUF**, con las 15
secciones que lista.

Hoy existe `BLOQUE_FUF` en `lib/completitud.js`: **10 bloques temáticos que yo
mismo definí** en el encargo anterior y que NO corresponden a las secciones del
formulario. `completitud-estructura.js` cubre además solo los ítems 30 a 48.

Hay que reemplazar `BLOQUE_FUF` por las 15 secciones reales y reasignar los
ítems 30-48 a las secciones 8 y 9. Es un cambio en código ya entregado.

## 4. RIOHS (duda D3) — resuelto por el código

`REGLAMENTO_INTERNO` **sí está versionado**: entró a `TIPOS_PROCEDIMIENTO` en el
commit `9ef58fa`, con nota sobre el Art. 57 inc. 5 y el FUF 51. Publicar una
versión archiva la anterior, re-informa y re-firma.

Lo que falta es solo `fechaEntradaVigencia` en el documento, que es contra lo que
se miden los 30 días.

## 5. Organizaciones sindicales (duda D1) — no existen

Cero apariciones en el repositorio. Confirma el supuesto por defecto del encargo.

## 6. Repositorio DS 44 (duda D7)

`DocumentsRepository.tsx` (770 líneas) agrupa en 7 carpetas por `clasificacion` y
`fase`: `empresa`, `obra`, `ds44`, `repositorio`, `diario`, `trabajador`, `otros`.
Un documento cae en `ds44` si tiene `fase`.

**No hay documentos huérfanos en el sentido estricto**: todos tienen tipo y caen
en alguna carpeta. Lo que no existe es el vínculo documento → ítem del FUF, que
es lo que este encargo debe construir.

## 7. Modelo de Documento — campos disponibles

`documentId, tenantId, obraId, clasificacion, fase, tipo, tipoDescripcion,
obligatorio, titulo, contenido, descripcion, relatorId, s3Key, archivoUrl,
archivoNombre, fechaCaducidad, periodo, fecha, createdBy, creatorName, firmas[],
asignaciones[], difusiones[], versiones[], estado, version`.

`periodo` (mío, ítems 38/46/47) y `fecha` (del otro encargo: fecha del hecho que
el documento acredita) ya cubren buena parte de lo que este encargo necesita.

## 8. Patrones a respetar

- Entidad nueva: `EppCatalogoService` / `EstructuraPreventivaService`, clave
  `tenantId` + sort key con prefijo. La tabla de estructura ya admite prefijos
  nuevos (`DIS#`, `PRE#`) sin crear tabla.
- Módulo de dominio: `lib/ptp.js`, `lib/estructura-preventiva.js` — puro, espejado
  en `utils/`, con tests `node --test`.
- Completitud: `lib/completitud.js` + definiciones por módulo. El repositorio
  debe consumir esto, no calcular.

## 9. Suite al iniciar

224 tests / 0 fallas. `npm run build` verde.
