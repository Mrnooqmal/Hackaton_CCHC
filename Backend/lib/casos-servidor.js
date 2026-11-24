/**
 * Lo que solo usa el servidor sobre los casos de incidentes: leer un incidente tal como
 * está guardado (medidas antiguas sin número, `viewedBy` como conjunto), el resumen sin
 * datos personales para el FUF y el repositorio, y las reglas para cerrar un caso.
 *
 * Va aparte de `lib/casos.js` a propósito: `casos.js` tiene su ESPEJO en
 * `Frontend/src/utils/casos.ts` y una prueba los compara; lo que está acá no tiene
 * espejo y no entra en esa comparación.
 */
const {
    estaCerrado, esHallazgo, pendientesDeCierre, papelesRequeridos, avanceDelCaso, tieneInforme, hayTexto, hayLista,
    MAX_COMENTARIO_CIERRE,
} = require('./casos');

/**
 * Las medidas anteriores a la fase 3 pueden no traer `numero`, y todo lo que actúa sobre
 * una medida la busca por número: con `undefined`, una acción sobre una de ellas caía sobre
 * TODAS las que no lo tenían. Esto devuelve el incidente con cada medida sin número
 * numerada, sin tocar lo guardado: se asigna a partir del mayor número que ya existe, en el
 * orden de la lista (que solo crece), así que el mismo caso da siempre los mismos números y
 * no choca con los existentes. Al guardar la lista, los números quedan escritos.
 * Devuelve el mismo objeto si no hay nada que numerar.
 */
const sinNumero = (m) => m?.numero === undefined || m?.numero === null || m?.numero === '';
function conMedidasNumeradas(inc) {
    const medidas = inc?.medidasCorrectivas;
    if (!Array.isArray(medidas) || !medidas.some((m) => m && typeof m === 'object' && sinNumero(m))) return inc;
    let siguiente = medidas.reduce((mayor, m) => Math.max(mayor, Number(m?.numero) || 0), 0);
    return { ...inc, medidasCorrectivas: medidas.map((m) => (m && typeof m === 'object' && sinNumero(m) ? { ...m, numero: ++siguiente } : m)) };
}

/**
 * Quién ha visto el caso (`viewedBy`) llega al frontend siempre como arreglo. En la tabla
 * conviven listas (la forma actual), conjuntos de texto (los casos en que el primer
 * `ADD` creó el campo) y el campo ausente; un conjunto, que el cliente de DynamoDB
 * entrega como `Set` de JS, `JSON.stringify` lo serializa como `{}`.
 * Devuelve el mismo objeto si ya es un arreglo.
 */
function conVistoPor(inc) {
    if (!inc || Array.isArray(inc.viewedBy)) return inc;
    const v = inc.viewedBy;
    return { ...inc, viewedBy: v instanceof Set ? [...v] : [] };
}

/**
 * ¿Tiene una investigación registrada con el flujo anterior al rediseño
 * (`POST /incidents/{id}/investigations`, que guarda `investigaciones.prevencionista`,
 * `jefeDirecto` o `comiteParitario`)? Cuenta la que tiene contenido: hallazgos,
 * recomendaciones o medidas con texto. Es de lectura nada más, como `documentos`.
 */
const INVESTIGADORES_ANTERIORES = ['prevencionista', 'jefeDirecto', 'comiteParitario'];
const investigacionAnterior = (inc) => INVESTIGADORES_ANTERIORES.some((quien) => {
    const i = inc?.investigaciones?.[quien];
    return Boolean(i) && typeof i === 'object' && [i.hallazgos, i.recomendaciones, i.medidas].some((v) => hayTexto(v) || hayLista(v));
});

// ── Resumen del caso para el FUF y el repositorio (fase 4) ───────────────────

/**
 * Lo que se puede decir de un caso sin entregar nada de él: ni el afectado, ni
 * el relato, ni los archivos. Es lo que alimenta el ítem 66 del FUF y la lista de
 * casos del repositorio de la obra.
 *
 * Existe porque los papeles (`incidente.papeles`, con la clave de S3 y el nombre
 * de cada archivo) no salen del módulo de incidentes salvo por la ruta de
 * papeles, que firma y audita la descarga. Quien necesita saber "falta el informe"
 * o "van 3 de 4" pregunta acá y recibe un sí o un no, nunca el archivo.
 *
 * Qué lleva cada campo, a propósito:
 *  - `requeridos`: solo `{ clave, etiqueta, cumplido }`. No `tipoDocumento` (es
 *    para ofrecer "subir" en la pantalla del caso, que no es esta).
 *  - `informeInvestigacion`: si el caso está investigado: tiene el informe subido o el
 *    informe Art. 71 firmado (exija o no el informe su tipo) o una investigación registrada con el flujo
 *    anterior (`investigaciones.*` con contenido). Es el dato del ítem 66.
 *  - `clasificado`: si el prevencionista ya lo clasificó (triaje).
 * La clasificación y la gravedad salen como las lee todo lo demás (`esHallazgo`:
 * los incidentes anteriores al triaje no la traen guardada).
 */
function resumenDelCaso(incidente) {
    const inc = incidente || {};
    const hallazgo = esHallazgo(inc);
    return {
        incidentId: inc.incidentId,
        tipo: inc.tipo || null,
        clasificacion: hallazgo ? 'hallazgo' : 'incidente',
        gravedad: hallazgo ? null : (inc.gravedad || null),
        fecha: inc.fecha || null,
        estado: estaCerrado(inc) ? 'cerrado' : 'abierto',
        clasificado: Boolean(inc.triaje),
        avance: avanceDelCaso(inc),
        requeridos: papelesRequeridos(inc).map(({ clave, etiqueta, cumplido }) => ({ clave, etiqueta, cumplido })),
        informeInvestigacion: tieneInforme(inc) || investigacionAnterior(inc),
    };
}

// ── Cierre ───────────────────────────────────────────────────────────────────

/**
 * Reglas para cerrar un caso, las mismas desde cualquier ruta: que no esté ya cerrado,
 * que traiga comentario de cierre (hasta `MAX_COMENTARIO_CIERRE` caracteres) y que no
 * quede nada pendiente (clasificado y papeles completos).
 *
 * `conInforme`: la ruta de la obra genera el informe Art. 71 al cerrar, así que el caso se
 * evalúa como si ya lo tuviera; si no, un accidente nunca podría cerrarse por ahí.
 *
 * Devuelve `{ comentario }` si se puede cerrar, o `{ estado, error, pendientes? }` con el
 * código HTTP y el mensaje listo para mostrar.
 */
function evaluarCierre(incidente, comentarioCierre, { conInforme = false } = {}) {
    if (estaCerrado(incidente)) return { estado: 409, error: 'El caso ya está cerrado.' };
    const comentario = typeof comentarioCierre === 'string' ? comentarioCierre.trim() : '';
    if (!comentario) return { estado: 400, error: 'El comentario de cierre es obligatorio.' };
    if (comentario.length > MAX_COMENTARIO_CIERRE) {
        return { estado: 400, error: `El comentario de cierre admite hasta ${MAX_COMENTARIO_CIERRE} caracteres.` };
    }
    const evaluado = conInforme && !tieneInforme(incidente) ? { ...incidente, informeDocumentId: 'por-generar' } : incidente;
    const pendientes = pendientesDeCierre(evaluado, comentario);
    if (pendientes.length > 0) {
        return { estado: 409, error: `Todavía no se puede cerrar el caso. ${pendientes.join(' ')}`, pendientes };
    }
    return { comentario };
}

module.exports = { conMedidasNumeradas, conVistoPor, investigacionAnterior, resumenDelCaso, evaluarCierre };
