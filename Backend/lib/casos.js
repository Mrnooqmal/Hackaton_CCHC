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
 *   comentarioCierre}, informeDocumentId (el informe Art. 71 firmado), medidasCorrectivas (solo las guardadas antes: ya no se crean) y papeles (los archivos subidos al
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
    plan_medidas: { etiqueta: 'Plan de medidas correctivas', salud: false },
    constancia_aviso_autoridad: { etiqueta: 'Constancia del aviso a la Inspección del Trabajo y a la SEREMI de Salud', salud: false },
    otro: { etiqueta: 'Otro respaldo', salud: false },
};

/** Orden en que se ofrecen en pantalla. */
const ORDEN_TIPOS_PAPEL = ['diat', 'diep', 'informe_investigacion', 'plan_medidas', 'constancia_aviso_autoridad', 'otro'];

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
const MAX_PAPELES_GUARDADOS = 60;
const admiteOtroPapel = (papeles) => {
    const lista = Array.isArray(papeles) ? papeles.filter((p) => p && !p.legado && !p.firmado) : [];
    return lista.length < MAX_PAPELES_GUARDADOS && lista.filter((p) => !p.anulado).length < MAX_PAPELES_POR_CASO;
};

// ── Qué exige cada caso ──────────────────────────────────────────────────────

/** Tipos de caso: los dos de hallazgo y los dos de incidente. Los usa todo el módulo (handler, repositorio, pantallas). */
const TIPOS_HALLAZGO = ['condicion_subestandar', 'accion_subestandar'];
const TIPOS_INCIDENTE = ['accidente', 'incidente'];
const GRAVEDADES = ['leve', 'grave', 'fatal'];

/** Clasificación que corresponde a un tipo: los dos de hallazgo son hallazgos, el resto son incidentes. */
const clasificacionDelTipo = (tipo) => (TIPOS_HALLAZGO.includes(tipo) ? 'hallazgo' : 'incidente');

/**
 * ¿Es un hallazgo? Los incidentes guardados antes de la clasificación no la
 * tienen: se deriva del tipo, igual que al crearlos.
 */
const esHallazgo = (inc) => (inc?.clasificacion ? inc.clasificacion === 'hallazgo' : TIPOS_HALLAZGO.includes(inc?.tipo));

// ── Topes de texto y de fotos (los mismos en el servidor y en las pantallas) ──

/** Qué se hizo en el momento para contener el riesgo: un párrafo, no un informe. */
const MAX_MEDIDAS_INMEDIATAS = 1000;
const MAX_COMENTARIO_CIERRE = 1000;
const MAX_MOTIVO_REAPERTURA = 500;
const MAX_MOTIVO_ANULACION = 500;
const PAPEL_INFORME_FIRMADO = 'informe-firmado';
/** Fotos por envío: cubre una ráfaga en terreno. Más que eso falla entero al adjuntar. */
const MAX_EVIDENCIAS_POR_ENVIO = 10;
/** Fotos por caso: evita que un caso se vuelva un depósito de archivos. */
const MAX_EVIDENCIAS_TOTAL = 20;

/**
 * Fotos del caso: imágenes. Incluye HEIC/HEIF, el formato de las cámaras de iPhone,
 * que un selector `image/*` entrega tal cual. La extensión de la clave de S3 sale de
 * acá y no del nombre del archivo.
 */
const EXTENSION_POR_MIME_FOTO = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
};
const MIME_FOTOS = Object.keys(EXTENSION_POR_MIME_FOTO);

const hayTexto = (v) => typeof v === 'string' && v.trim() !== '';
const hayLista = (v) => Array.isArray(v) && v.length > 0;

/**
 * Los papeles del caso: los de la lista `papeles` y, de lectura nada más, los que se
 * guardaron con el contrato anterior (`documentos.diat` y `documentos.diep`, un archivo
 * por tipo). Sin esto, la DIAT que ya estaba subida dejaba de verse y de contar, y el
 * caso volvía a pedirla. No se migra ningún dato: se leen donde están.
 *
 * Un papel anterior se acepta solo si su clave es de ESTA empresa y de ESTE incidente
 * (el contrato anterior dejaba escribir `documentos` desde el cliente: sin esta
 * comprobación, `getDocuments` firmaría la descarga de un archivo ajeno). Sale marcado
 * `legado: true`, con la forma de un papel nuevo.
 *
 * Hubo dos formatos de clave: el de septiembre de 2026 en adelante,
 * `tenants/{empresa}/incidentes/{id}/…`, y el anterior (diciembre de 2025 a septiembre
 * de 2026), `{id}/documents/{diat|diep}-….pdf`, sin empresa. El segundo trae el id del
 * incidente (un uuid generado por el servidor), así que no puede ser de otro caso: se
 * acepta con el prefijo `{id}/documents/`.
 */
const TIPOS_PAPEL_ANTERIORES = ['diat', 'diep'];
function papelesDelCaso(inc) {
    const nuevos = Array.isArray(inc?.papeles) ? inc.papeles.filter(Boolean) : [];
    const documentos = inc?.documentos;
    if (!documentos || typeof documentos !== 'object' || !inc?.tenantId || !inc?.incidentId) return nuevos;
    const prefijos = [`tenants/${inc.tenantId}/incidentes/${inc.incidentId}/`, `${inc.incidentId}/documents/`];
    const anteriores = [];
    for (const tipo of TIPOS_PAPEL_ANTERIORES) {
        const d = documentos[tipo];
        const clave = d?.s3Key;
        if (typeof clave !== 'string' || !prefijos.some((p) => clave.startsWith(p)) || clave.includes('..')) continue;
        if (nuevos.some((p) => p.s3Key === clave)) continue;
        anteriores.push({
            papelId: `anterior-${tipo}`,
            tipo,
            nombreArchivo: typeof d.fileName === 'string' ? d.fileName : '',
            tipoMime: typeof d.fileType === 'string' ? d.fileType : '',
            s3Key: clave,
            subidoPor: null,
            subidoEn: typeof d.uploadedAt === 'string' ? d.uploadedAt : null,
            fechaDocumento: null,
            tamano: null,
            huella: null,
            legado: true,
        });
    }
    return [...nuevos, ...anteriores];
}

const hayPapel = (inc, tipo) => papelesDelCaso(inc).some((p) => p?.tipo === tipo && !p.anulado);

/**
 * ¿Tiene el informe de investigación? Lo cumple el papel subido o el informe del Art. 71
 * que la obra firma con PIN al cerrar la investigación (`informeDocumentId`): es el mismo
 * informe, generado por otra vía.
 */
const tieneInforme = (inc) => hayPapel(inc, 'informe_investigacion') || hayTexto(inc?.informeDocumentId);

/**
 * Papeles que el caso exige, cada uno con si ya está cumplido.
 *
 * Cada elemento: `{ clave, etiqueta, cumplido, tipoDocumento }`. `tipoDocumento`
 * es el tipo de archivo que lo cumple (para ofrecer "subir" en pantalla) y es
 * null cuando se cumple con un dato del reporte (foto, responsable y plazo,
 * comentario de cierre) y no con un archivo subido al caso.
 *
 * | Caso                    | Papeles                                                        |
 * |-------------------------|----------------------------------------------------------------|
 * | Hallazgo                | foto, responsable y plazo, comentario de cierre                |
 * | Incidente               | informe de investigación, solo si `altoPotencial === true`     |
 * | Accidente               | DIAT, informe de investigación, plan de medidas correctivas    |
 * | Accidente grave o fatal | lo del accidente + constancia del aviso a la autoridad         |
 *
 * Las medidas correctivas ya no son datos del caso: se definen subiendo el "Plan de
 * medidas correctivas" (`plan_medidas`), un papel más. Solo el accidente lo exige; en un
 * incidente o un hallazgo se puede subir como respaldo, sin exigirse.
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

    const informe = () => exigir('informe_investigacion', etiquetaTipoPapel('informe_investigacion'), tieneInforme(inc), 'informe_investigacion');

    if (inc.tipo === 'accidente') {
        exigir('diat', 'DIAT', hayPapel(inc, 'diat'), 'diat');
        informe();
        // Un accidente con medidas guardadas antes del cambio (`medidasCorrectivas`, que ya no
        // se crean) cuenta como cumplido: si no, esos casos quedarían trabados sin poder
        // cerrarse por un papel que cuando se abrieron no existía.
        exigir('plan_medidas', etiquetaTipoPapel('plan_medidas'), hayPapel(inc, 'plan_medidas') || hayLista(inc.medidasCorrectivas), 'plan_medidas');
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

// ── Clasificación y cierre (fase 3) ─────────────────────────────────

/** Quien clasifica y cierra el caso (el prevencionista). Es el valor de `PERMISSIONS`; una prueba lo comprueba. */
const PERMISO_CLASIFICAR = 'incidentes.calificar_accidente';
/** Quien reúne los papeles del caso. */
const PERMISO_GESTIONAR = 'incidentes.reportar';

/**
 * Estados de una medida guardada antes del cambio (las nuevas ya no son datos del caso). Una
 * medida "terminada" es una completada o verificada; la usa el cambio de estado que sigue
 * sirviendo a la fase ACTUAR de la obra.
 */
const ESTADOS_MEDIDA = ['pendiente', 'en_proceso', 'completada', 'verificada'];
const medidaTerminada = (m) => m?.estado === 'completada' || m?.estado === 'verificada';

/**
 * ¿Está cerrado el caso? Un hallazgo se cierra por su gobernanza y un incidente por
 * su estado: el mismo criterio de `utils/incidentes.ts` (`incidenteCerrado`), que
 * usan los contadores.
 */
const estaCerrado = (inc) => (esHallazgo(inc)
    ? inc?.gobernanza?.estadoCierre === 'cerrado' || inc?.estado === 'cerrado'
    : inc?.estado === 'cerrado');

/**
 * Lo que falta para poder cerrar el caso, en frases listas para mostrar tal cual.
 * Vacío = se puede cerrar.
 *
 * `comentarioCierre` es el que viene en la misma petición de cierre: en un hallazgo
 * el comentario de cierre es un "papel requerido" que solo existe al cerrar, así que
 * el caso se evalúa como si ya lo tuviera (si no, nunca se podría cerrar).
 */
function pendientesDeCierre(incidente, comentarioCierre) {
    const inc = incidente || {};
    const evaluado = esHallazgo(inc) && hayTexto(comentarioCierre)
        ? { ...inc, gobernanza: { ...(inc.gobernanza || {}), comentarioCierre } }
        : inc;
    const faltas = [];
    if (!inc.triaje) faltas.push('Clasificar el reporte (tipo y gravedad).');
    for (const p of papelesRequeridos(evaluado)) {
        if (!p.cumplido) faltas.push(`Falta: ${p.etiqueta}.`);
    }
    return faltas;
}

/**
 * Qué toca hacer ahora con el caso y a quién le toca.
 * Devuelve `{ paso, titulo, detalle, permiso }`; `permiso` es el que necesita
 * quien lo hace (null cuando ya no hay nada que hacer).
 *
 * Orden: clasificar → papeles → cerrar. Un ajuste frente al orden "papeles requeridos
 * primero": el comentario de cierre de un hallazgo no cuenta en el paso de papeles: solo
 * se cumple al cerrar, y si bloqueara, el paso `cerrar` no llegaría nunca.
 * Lo demás que el caso exige y no es un archivo (la foto y el responsable con plazo
 * de un hallazgo) queda en el paso de papeles, porque cerrar exige el 100 % y si no
 * el caso se trabaría sin que ningún paso lo dijera. El plan de medidas de un accidente
 * es un papel más.
 */
function siguientePaso(incidente) {
    const inc = incidente || {};
    if (estaCerrado(inc)) {
        return { paso: 'cerrado', titulo: 'Caso cerrado', detalle: 'El caso está cerrado y ya no admite cambios.', permiso: null };
    }
    const hallazgo = esHallazgo(inc);
    if (!inc.triaje) {
        return {
            paso: 'clasificar',
            titulo: 'Clasificar el reporte',
            detalle: hallazgo
                ? 'Confirmar que es un hallazgo y si es una condición o una acción subestándar.'
                : 'Confirmar el tipo de caso, la gravedad y si pudo haber sido más grave.',
            permiso: PERMISO_CLASIFICAR,
        };
    }
    const faltantes = papelesRequeridos(inc).filter((p) => !p.cumplido && p.clave !== 'comentario_cierre');
    if (faltantes.length > 0) {
        return {
            paso: 'papeles',
            titulo: 'Juntar los papeles del caso',
            detalle: `Falta: ${faltantes.map((p) => p.etiqueta).join('; ')}.`,
            permiso: PERMISO_GESTIONAR,
        };
    }
    return {
        paso: 'cerrar',
        titulo: 'Cerrar el caso',
        detalle: hallazgo ? 'Todo está al día. Falta cerrarlo con un comentario de cierre.' : inc.tipo === 'accidente' ? 'Papeles y plan de medidas correctivas completos. Falta cerrarlo con un comentario de cierre.' : 'Papeles completos. Falta cerrarlo con un comentario de cierre.',
        permiso: PERMISO_CLASIFICAR,
    };
}

module.exports = {
    TIPOS_PAPEL, ORDEN_TIPOS_PAPEL, esTipoPapel, etiquetaTipoPapel, tipoPapelConSalud,
    EXTENSION_POR_MIME, MIME_PAPELES, MAX_BYTES_PAPEL, MAX_PAPELES_POR_CASO, MAX_PAPELES_GUARDADOS, admiteOtroPapel,
    TIPOS_HALLAZGO, TIPOS_INCIDENTE, GRAVEDADES, clasificacionDelTipo,
    MAX_MEDIDAS_INMEDIATAS, MAX_COMENTARIO_CIERRE, MAX_MOTIVO_REAPERTURA, MAX_MOTIVO_ANULACION, PAPEL_INFORME_FIRMADO, MAX_EVIDENCIAS_POR_ENVIO, MAX_EVIDENCIAS_TOTAL,
    EXTENSION_POR_MIME_FOTO, MIME_FOTOS,
    esHallazgo, papelesDelCaso, tieneInforme, hayTexto, hayLista, papelesRequeridos, avanceDelCaso,
    PERMISO_CLASIFICAR, PERMISO_GESTIONAR, ESTADOS_MEDIDA,
    medidaTerminada, estaCerrado, pendientesDeCierre, siguientePaso,
};
