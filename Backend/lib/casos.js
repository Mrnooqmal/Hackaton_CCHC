/**
 * Los papeles de un caso: qué documentos y qué datos exige cada tipo de reporte,
 * y cuánto falta (fase 2 del rediseño de incidentes, docs/incidentes-rediseno.md).
 *
 * ESPEJO de Frontend/src/utils/casos.ts — mantener sincronizados. Una prueba
 * (tests/casos.test.js) corre los dos con los mismos casos y exige que den lo
 * mismo.
 *
 * FUENTE ÚNICA de las reglas, como `fuf.js` lo es de los ítems: la pantalla del
 * caso, el cierre (fase 3) y el enlace con el FUF (fase 4) preguntan acá. Si cada
 * uno armara su propia lista de "qué falta", el mismo caso saldría completo en
 * una pantalla e incompleto en otra.
 *
 * Es lógica PURA: recibe el incidente tal como se guarda y devuelve datos. No lee
 * archivos ni les cree nada: la plataforma es un repositorio, guarda los papeles
 * y muestra cuáles faltan; no tramita la DIAT ni la DIEP, que son archivos que se
 * adjuntan.
 *
 * ── Qué lee del incidente ────────────────────────────────────────────────────
 *   tipo, clasificacion, gravedad, altoPotencial (lo agrega la fase 3),
 *   evidencias (claves de las fotos), gobernanza.{responsableId, plazoRespuestaISO,
 *   comentarioCierre}, medidasCorrectivas y papeles (los archivos subidos al
 *   caso: `[{ tipo, … }]`, ver `incidents.repository.js`).
 */

/**
 * Tipos de documento que se pueden subir a un caso.
 *
 * `salud`: el documento trae datos de salud de una persona identificable (la DIAT
 * y la DIEP llevan RUT, lesiones y diagnóstico). Su entrega queda en la auditoría
 * de acceso a datos de salud (lib/gobernanza/auditoriaSalud.js).
 *
 * `otro` es un respaldo libre (una foto de la declaración de un testigo, un
 * correo): nunca es obligatorio.
 */
const TIPOS_PAPEL = {
    diat: { etiqueta: 'DIAT (denuncia individual de accidente del trabajo)', salud: true },
    diep: { etiqueta: 'DIEP (denuncia individual de enfermedad profesional)', salud: true },
    informe_investigacion: { etiqueta: 'Informe de investigación', salud: false },
    constancia_aviso_autoridad: { etiqueta: 'Constancia del aviso a la Inspección del Trabajo y a la SEREMI de Salud', salud: false },
    otro: { etiqueta: 'Otro respaldo', salud: false },
};

/** Orden en que se ofrecen en pantalla. */
const ORDEN_TIPOS_PAPEL = ['diat', 'diep', 'informe_investigacion', 'constancia_aviso_autoridad', 'otro'];

const esTipoPapel = (tipo) => typeof tipo === 'string' && Object.prototype.hasOwnProperty.call(TIPOS_PAPEL, tipo);
const etiquetaTipoPapel = (tipo) => (esTipoPapel(tipo) ? TIPOS_PAPEL[tipo].etiqueta : 'Documento');
/** ¿Este tipo de documento trae datos de salud? */
const tipoPapelConSalud = (tipo) => esTipoPapel(tipo) && TIPOS_PAPEL[tipo].salud;

// ── Archivos aceptados ───────────────────────────────────────────────────────

/** PDF e imágenes; la extensión de la clave sale de acá, no del nombre que trae el archivo. */
const EXTENSION_POR_MIME = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};
const MIME_PAPELES = Object.keys(EXTENSION_POR_MIME);
/** 15 MB: cabe un PDF escaneado de varias hojas y una foto de celular. */
const MAX_BYTES_PAPEL = 15 * 1024 * 1024;
/** Tope de archivos por caso: evita que un caso se vuelva un depósito. */
const MAX_PAPELES_POR_CASO = 30;

// ── Qué exige cada caso ──────────────────────────────────────────────────────

const HALLAZGOS = ['condicion_subestandar', 'accion_subestandar'];

/**
 * ¿Es un hallazgo? Los incidentes guardados antes de la clasificación no la
 * tienen: se deriva del tipo, igual que al crearlos.
 */
const esHallazgo = (inc) => (inc?.clasificacion ? inc.clasificacion === 'hallazgo' : HALLAZGOS.includes(inc?.tipo));

const hayTexto = (v) => typeof v === 'string' && v.trim() !== '';
const hayLista = (v) => Array.isArray(v) && v.length > 0;
const hayPapel = (inc, tipo) => Array.isArray(inc?.papeles) && inc.papeles.some((p) => p?.tipo === tipo);

/**
 * Papeles que el caso exige, cada uno con si ya está cumplido.
 *
 * Cada elemento: `{ clave, etiqueta, cumplido, tipoDocumento }`. `tipoDocumento`
 * es el tipo de archivo que lo cumple (para ofrecer "subir" en pantalla) y es
 * null cuando se cumple con un dato del reporte (foto, responsable y plazo,
 * comentario de cierre, medidas) y no con un archivo subido al caso.
 *
 * | Caso                    | Papeles                                                        |
 * |-------------------------|----------------------------------------------------------------|
 * | Hallazgo                | foto, responsable y plazo, comentario de cierre                |
 * | Incidente               | informe de investigación, solo si `altoPotencial === true`     |
 * | Accidente               | DIAT, informe de investigación, una medida correctiva          |
 * | Accidente grave o fatal | lo del accidente + constancia del aviso a la autoridad         |
 *
 * La DIEP no se exige en ningún caso: el modelo no tiene el tipo "enfermedad
 * profesional" (hoy los tipos son accidente, incidente y los dos de hallazgo),
 * así que no hay un caso al que exigírsela. Queda disponible para subir como
 * respaldo de cualquiera; el día que exista ese tipo, se agrega su regla acá.
 *
 * `altoPotencial` lo agrega la fase 3 (triaje). Mientras el campo no exista, un
 * incidente no exige el informe: ausente cuenta como no requerido.
 */
function papelesRequeridos(incidente) {
    const inc = incidente || {};
    const lista = [];
    const exigir = (clave, etiqueta, cumplido, tipoDocumento = null) => lista.push({ clave, etiqueta, cumplido: Boolean(cumplido), tipoDocumento });

    if (esHallazgo(inc)) {
        exigir('foto', 'Al menos una foto del hallazgo', hayLista(inc.evidencias));
        exigir('responsable_plazo', 'Responsable y plazo', Boolean(inc.gobernanza?.responsableId) && Boolean(inc.gobernanza?.plazoRespuestaISO));
        exigir('comentario_cierre', 'Comentario de cierre', hayTexto(inc.gobernanza?.comentarioCierre));
        return lista;
    }

    const informe = () => exigir('informe_investigacion', etiquetaTipoPapel('informe_investigacion'), hayPapel(inc, 'informe_investigacion'), 'informe_investigacion');

    if (inc.tipo === 'accidente') {
        exigir('diat', 'DIAT', hayPapel(inc, 'diat'), 'diat');
        informe();
        exigir('medida_correctiva', 'Al menos una medida correctiva', hayLista(inc.medidasCorrectivas));
        if (inc.gravedad === 'grave' || inc.gravedad === 'fatal') {
            exigir('constancia_aviso_autoridad', 'Constancia del aviso a la Inspección del Trabajo y a la SEREMI de Salud',
                hayPapel(inc, 'constancia_aviso_autoridad'), 'constancia_aviso_autoridad');
        }
        return lista;
    }

    // Incidente peligroso (u otro tipo que no sea accidente ni hallazgo).
    if (inc.altoPotencial === true) informe();
    return lista;
}

/**
 * Avance del caso: papeles cumplidos sobre los requeridos.
 *
 * Un caso sin papeles requeridos (un incidente que no es de alto potencial) tiene
 * `total` 0 y `porcentaje` 100: no tiene nada pendiente, está al día. No se divide
 * por cero ni se muestra 0 % —que leería "no se ha hecho nada"—. La pantalla debe
 * decir "no exige papeles" cuando `total` es 0, en vez de "0 de 0".
 */
function avanceDelCaso(incidente) {
    const requeridos = papelesRequeridos(incidente);
    const total = requeridos.length;
    const cumplidos = requeridos.filter((p) => p.cumplido).length;
    return { cumplidos, total, porcentaje: total === 0 ? 100 : Math.round((cumplidos / total) * 100) };
}

module.exports = {
    TIPOS_PAPEL, ORDEN_TIPOS_PAPEL, esTipoPapel, etiquetaTipoPapel, tipoPapelConSalud,
    EXTENSION_POR_MIME, MIME_PAPELES, MAX_BYTES_PAPEL, MAX_PAPELES_POR_CASO,
    esHallazgo, papelesRequeridos, avanceDelCaso,
};
