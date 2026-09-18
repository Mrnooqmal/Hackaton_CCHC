/**
 * Dónde vive cada archivo.
 *
 * ── La regla ─────────────────────────────────────────────────────────────────
 *
 * **Si se puede regenerar o reemplazar sin perder prueba, es trabajo. Si es lo
 * que se le muestra a un fiscalizador, es evidencia.**
 *
 * De ahí salen dos buckets, y la diferencia entre ellos no es de orden sino de
 * consecuencias:
 *
 *   - `evidencia`: bloqueo de objetos (Object Lock) en modo gobernanza con piso
 *     de 5 años desde la carga. Lo que entra ahí **no se puede borrar** durante
 *     ese plazo, ni por error ni a propósito, salvo con un permiso explícito de
 *     excepción. Es la contraparte técnica de la obligación de conservar la
 *     evidencia de cumplimiento (ver D-2 en docs/gobernanza-y-seguridad-de-datos.md).
 *   - `trabajo`: versionado, sin bloqueo, con expiración de versiones antiguas.
 *     Logos, plantillas, fotos y los PDF estampados, que se rehacen cuando hace
 *     falta.
 *
 * Meter algo reemplazable en `evidencia` no es un detalle de prolijidad: una
 * empresa que cambia su logo cinco veces dejaría cinco versiones inmovilizadas
 * por cinco años. Y al revés es peor: un acta en `trabajo` se puede borrar.
 *
 * ── Por qué una categoría desconocida se rechaza ─────────────────────────────
 *
 * La alternativa era elegir un bucket por defecto. Si el defecto fuera
 * `evidencia`, cualquier subida nueva que nadie clasificó queda imborrable por
 * cinco años; si fuera `trabajo`, una evidencia real queda desprotegida. Las dos
 * equivocaciones son caras y silenciosas, así que subir exige decir qué se está
 * subiendo. Agregar una categoría acá es una línea, y obliga a pensar de qué
 * lado cae.
 */

const EVIDENCIA_BUCKET = process.env.EVIDENCIA_BUCKET;
const TRABAJO_BUCKET = process.env.TRABAJO_BUCKET;

const EVIDENCIA = 'evidencia';
const TRABAJO = 'trabajo';

/**
 * Categoría de subida → carpeta y clase de almacenamiento.
 *
 * La carpeta es el segundo tramo de la clave (`tenants/{empresa}/{carpeta}/…`) y
 * es la que permite deducir después en qué bucket vive un archivo, sin tener que
 * consultar nada ni guardar el nombre del bucket junto al documento.
 */
const CATEGORIAS = {
    // ── Evidencia de cumplimiento ──
    documentos: { carpeta: 'documentos', clase: EVIDENCIA },
    trabajadores: { carpeta: 'documentos', clase: EVIDENCIA },
    solicitudes: { carpeta: 'documentos', clase: EVIDENCIA },
    evidencia: { carpeta: 'documentos', clase: EVIDENCIA },
    evaluaciones: { carpeta: 'documentos', clase: EVIDENCIA },
    epp: { carpeta: 'documentos', clase: EVIDENCIA },
    'registros-indicadores': { carpeta: 'documentos', clase: EVIDENCIA },
    // Órganos preventivos: actas, acuerdos y programas de trabajo (Arts. 23 a 47).
    'estructura-preventiva': { carpeta: 'estructura', clase: EVIDENCIA },
    'actas-cphs': { carpeta: 'estructura', clase: EVIDENCIA },
    'acuerdos-cphs': { carpeta: 'estructura', clase: EVIDENCIA },
    'programa-cphs': { carpeta: 'estructura', clase: EVIDENCIA },
    // Escritos por el servidor, no por el navegador.
    incidentes: { carpeta: 'incidentes', clase: EVIDENCIA },
    registros: { carpeta: 'registros', clase: EVIDENCIA },

    // ── Material de trabajo ──
    // Las plantillas del catálogo de cargos se reemplazan al actualizarlas; lo
    // que acredita es la COPIA firmada por cada persona, que va a evidencia.
    plantilla: { carpeta: 'plantillas', clase: TRABAJO },
    'plantilla-obra': { carpeta: 'plantillas', clase: TRABAJO },
    obras: { carpeta: 'obras', clase: TRABAJO },
    logos: { carpeta: 'logos', clase: TRABAJO },
    perfil: { carpeta: 'perfil', clase: TRABAJO },
    // PDF con el anexo de firmas: es una renderización del original más las
    // firmas, reproducible en cualquier momento. Ver `claveEstampado`.
    estampados: { carpeta: 'estampados', clase: TRABAJO },
};

const bucketDe = (clase) => (clase === EVIDENCIA ? EVIDENCIA_BUCKET : TRABAJO_BUCKET);

/** Carpetas que viven en el bucket con bloqueo, para resolver una clave existente. */
const CARPETAS_EVIDENCIA = new Set(
    Object.values(CATEGORIAS).filter((c) => c.clase === EVIDENCIA).map((c) => c.carpeta)
);

/**
 * Resuelve una categoría de subida. Devuelve `null` si no está declarada: quien
 * llama responde 400 en vez de adivinar (ver el encabezado).
 */
const categoria = (nombre) => CATEGORIAS[String(nombre || '').trim()] || null;

/** Prefijo de una empresa dentro de un bucket. Todo cuelga de acá. */
const prefijoDeEmpresa = (tenantId) => `tenants/${tenantId}/`;

/**
 * Bucket donde vive una clave ya existente.
 *
 * Se deduce de la carpeta (`tenants/{empresa}/{carpeta}/…`), que es parte de la
 * clave. Guardar el nombre del bucket junto a cada documento habría significado
 * migrar la base entera el día que un bucket cambie de nombre.
 */
const claseDeClave = (clave) => {
    const partes = String(clave || '').split('/');
    const carpeta = partes.length > 2 ? partes[2] : null;
    return CARPETAS_EVIDENCIA.has(carpeta) ? EVIDENCIA : TRABAJO;
};

const bucketDeClave = (clave) => bucketDe(claseDeClave(clave));

/** ¿Esta clave pertenece a la empresa de la sesión? */
const esDeLaEmpresa = (clave, tenantId) =>
    Boolean(clave) && String(clave).startsWith(prefijoDeEmpresa(tenantId));

/**
 * Clave del PDF estampado, derivada del ESTADO de las firmas.
 *
 * Acá está la diferencia con el diseño anterior. Antes el estampado se guardaba
 * en una clave fija por documento y había que acordarse de invalidarlo en cada
 * lugar que reemplazaba el archivo o reabría las firmas —eran tres, y bastaba
 * con que alguien agregara un cuarto para servir como "documento firmado" un PDF
 * que correspondía a otra versión: evidencia incorrecta presentada como válida.
 *
 * Ahora la clave incluye una huella del archivo original y de las firmas
 * vigentes, así que **el caché se invalida por construcción**: si entra una
 * firma, o se publica una versión nueva, la clave cambia sola y el archivo viejo
 * simplemente deja de pedirse (y expira por política del bucket). Si diez
 * personas descargan el mismo documento sin cambios, las diez piden la misma
 * clave y se reutiliza el mismo archivo.
 *
 * La huella usa los *tokens* de las firmas, que son únicos e inmutables, y no su
 * cantidad: dos conjuntos distintos de firmas pueden tener el mismo tamaño.
 */
const claveEstampado = ({ tenantId, documentId, s3KeyOriginal, firmas = [] }) => {
    const crypto = require('crypto');
    const huella = crypto.createHash('sha256')
        .update(String(s3KeyOriginal || ''))
        .update('|')
        .update((firmas || []).map((f) => f.token || '').join(','))
        .digest('hex')
        .slice(0, 16);
    return `${prefijoDeEmpresa(tenantId)}${CATEGORIAS.estampados.carpeta}/${documentId}-${huella}.pdf`;
};

module.exports = {
    EVIDENCIA,
    TRABAJO,
    CATEGORIAS,
    categoria,
    bucketDe,
    // Para decidir QUÉ se puede hacer con un archivo, se pregunta por su clase y
    // no por el nombre del bucket: dos variables de entorno sin definir hacen que
    // cualquier comparación por nombre dé verdadera, y "todo es evidencia" o
    // "nada lo es" son las dos formas de equivocarse.
    claseDeClave,
    bucketDeClave,
    prefijoDeEmpresa,
    esDeLaEmpresa,
    claveEstampado,
    nombreBucketEvidencia: () => EVIDENCIA_BUCKET,
    nombreBucketTrabajo: () => TRABAJO_BUCKET,
};
