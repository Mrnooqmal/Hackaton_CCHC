/**
 * RUT e IP dentro de arreglos embebidos en el propio elemento (D-10).
 *
 * ── Por qué este archivo existe ──────────────────────────────────────────────
 *
 * D-8 sacó el dato sensible del elemento que los índices copian, moviéndolo a un
 * elemento aparte (`lib/traza-sensible.js`). Eso no sirve acá: `asignaciones[]`,
 * `firmas[]`, `asistentes[]` y `trabajadores[]` NO son traza de auditoría, son
 * el contenido del documento —quién lo tiene asignado, quién lo firmó— y las
 * pantallas los dibujan. Moverlos aparte obligaría a unir dos elementos en cada
 * listado, que es justo lo que D-8 evita. Así que acá el dato se queda donde
 * está y lo que cambia es que va cifrado.
 *
 * ── La llave es la del tenant, y eso no es un detalle ────────────────────────
 *
 * `documents.list()`, `activities.list()` y `signature-requests.list()` devuelven
 * el elemento completo de CADA registro de la empresa: decenas de documentos con
 * decenas de asignaciones cada uno. Con un sobre por valor —una llamada a KMS
 * por RUT— una sola pantalla costaría cientos de llamadas. Con la llave del
 * tenant (`PROPOSITOS.RUT_PERSONAS`, la misma del RUT de personas: mismo tipo de
 * dato, mismo radio de exposición) se desenvuelve UNA vez por invocación y el
 * resto es AES local. Es la misma decisión que ya se tomó para listar el plantel.
 *
 * ── La regla que hay que respetar ────────────────────────────────────────────
 *
 * **Una sola puerta de entrada por entidad.** Quien lee un documento llama a
 * `descifrarDocumento`, no a la lista de campos; quien escribe una asignación
 * llama a `construirAsignacion`, no arma el objeto a mano. La razón es empírica:
 * el inventario de este cambio encontró CUATRO constructores independientes de
 * `asignaciones[]` y TRES de `firmas[]`, cada uno con su propia copia del RUT en
 * claro. Un campo nuevo en una de esas copias no falla por ningún lado: solo
 * deja de cifrarse, en silencio.
 */

const {
    cifrarConLlaveDatos,
    descifrarConLlaveDatos,
    cifrarConLlaveDatosSiempre,
    descifrarConLlaveDatosSiempre,
} = require('./cifradoCampo');
const { llaveDeTenant, PROPOSITOS } = require('./llaveTenant');

/** Los campos sensibles de cada tipo de entrada embebida. */
const CAMPOS = {
    asignacion: ['rut'],
    firma: ['rut', 'ip'],
    asistente: ['rut'],
    trabajador: ['rut'],
    destinatario: ['rut'],
};

/** La llave compartida de la empresa para todos estos campos. Una llamada a KMS
 *  por invocación, reutilizada para todo lo que se cifre o descifre después. */
const llaveDe = (tenantId) => llaveDeTenant(tenantId, PROPOSITOS.RUT_PERSONAS);

/**
 * La OTRA llave de la empresa: la de salud, para las respuestas de encuesta.
 *
 * Separada de la del RUT por la misma razón que `vigilanciaSalud` ya lo estaba:
 * son secretos de radio de exposición distinto, y quien comprometa uno no
 * debería llevarse el otro. Las respuestas van acá aunque la encuesta no sea de
 * salud — la decisión fue no condicionar el cifrado al contenido, así que
 * tampoco se condiciona la llave: al escribir no se sabe qué va a declarar
 * alguien en una pregunta abierta.
 */
const llaveSaludDe = (tenantId) => llaveDeTenant(tenantId, PROPOSITOS.SALUD);

// ─── Un objeto suelto ────────────────────────────────────────────────────────

const cifrarCamposEnObjeto = (obj, campos, llave) => {
    if (!obj || typeof obj !== 'object') return obj;
    const nuevo = { ...obj };
    for (const campo of campos) {
        if (nuevo[campo] === undefined) continue;
        nuevo[`${campo}Cifrado`] = cifrarConLlaveDatos(nuevo[campo], llave);
        delete nuevo[campo];
    }
    return nuevo;
};

/**
 * Lee las dos formas: si hay sobre lo descifra, y si no, deja el valor en claro
 * de un registro viejo tal cual. Igual que en Personas, el código lee legado y
 * nuevo pero solo ESCRIBE el nuevo.
 */
const descifrarCamposEnObjeto = (obj, campos, llave) => {
    if (!obj || typeof obj !== 'object') return obj;
    const nuevo = { ...obj };
    for (const campo of campos) {
        const clave = `${campo}Cifrado`;
        if (nuevo[clave] === undefined) continue;
        nuevo[campo] = descifrarConLlaveDatos(nuevo[clave], llave);
        delete nuevo[clave];
    }
    return nuevo;
};

// ─── Un arreglo de objetos ───────────────────────────────────────────────────

const cifrarCamposEnArreglo = (arr, campos, llave) =>
    (Array.isArray(arr) ? arr.map((x) => cifrarCamposEnObjeto(x, campos, llave)) : arr);

const descifrarCamposEnArreglo = (arr, campos, llave) =>
    (Array.isArray(arr) ? arr.map((x) => descifrarCamposEnObjeto(x, campos, llave)) : arr);

// ─── Las puertas de entrada por entidad ──────────────────────────────────────

/**
 * Construye una asignación de documento con el RUT ya cifrado.
 *
 * Es el ÚNICO constructor de entradas de `asignaciones[]`. Antes había cuatro
 * —documents.assign, EppService.crearEntrega, personas-module.buildAssignment y
 * la reescritura de syncPlantillasToWorkers—, cada uno con su `rut: persona.rut`.
 */
const construirAsignacion = (persona, { fechaLimite = null, notificado = true, nombreFallback = null } = {}, llave) => {
    const nombre = persona
        ? `${persona.nombre} ${persona.apellido || ''}`.trim()
        : (nombreFallback || '');
    return {
        personaId: persona?.personaId ?? nombreFallback ?? null,
        nombre,
        rutCifrado: cifrarConLlaveDatos(persona?.rut ?? null, llave),
        fechaAsignacion: new Date().toISOString(),
        fechaLimite,
        estado: 'pendiente',
        notificado,
    };
};

/** Cifra los arreglos sensibles de un documento antes de guardarlo. */
const cifrarDocumento = (doc, llave) => {
    if (!doc) return doc;
    return {
        ...doc,
        asignaciones: cifrarCamposEnArreglo(doc.asignaciones, CAMPOS.asignacion, llave),
        firmas: cifrarCamposEnArreglo(doc.firmas, CAMPOS.firma, llave),
    };
};

/**
 * Descifra los arreglos sensibles de un documento para mostrarlo.
 *
 * Los snapshots de `versiones[]` no se descifran: nada los lee de vuelta (solo
 * `v.s3Key`, en uploads). Conservan el sobre tal cual, que es lo correcto —
 * siguen siendo ilegibles en la tabla sin desenvolver la llave.
 */
const descifrarDocumento = (doc, llave) => {
    if (!doc) return doc;
    // El contenido firmado de los informes (Art. 71, AT/EP) no viaja al
    // cliente, ni cifrado: no hay pantalla que lo lea, y se descifra solo para
    // verificar su huella (`RegistroService.verificarIntegridad`), que lee el
    // elemento guardado y no pasa por acá.
    const { snapshotCifrado: _contenidoFirmado, ...sinContenidoFirmado } = doc;
    return {
        ...sinContenidoFirmado,
        asignaciones: descifrarCamposEnArreglo(doc.asignaciones, CAMPOS.asignacion, llave),
        firmas: descifrarCamposEnArreglo(doc.firmas, CAMPOS.firma, llave),
    };
};

const descifrarActividad = (act, llave) => {
    if (!act) return act;
    return {
        ...act,
        asistentes: descifrarCamposEnArreglo(act.asistentes, CAMPOS.asistente, llave),
        firmaRelator: act.firmaRelator
            ? descifrarCamposEnObjeto(act.firmaRelator, CAMPOS.asistente, llave)
            : act.firmaRelator,
    };
};

/**
 * Construye un destinatario de encuesta con el RUT y las respuestas cifrados.
 *
 * Es el ÚNICO constructor de entradas de `recipients[]`: antes había dos, uno
 * en el handler de encuestas y otro en la encuesta de salud por defecto, cada
 * uno con su `rut: persona.rut`.
 *
 * Las respuestas se cifran SIEMPRE, con `cifrarConLlaveDatosSiempre`: incluso
 * `[]` produce un sobre. Condicionar el cifrado a que haya contenido —o a que
 * la encuesta sea "de salud"— es el mismo patrón de falla silenciosa que ya se
 * cerró en `restriccionLaboral`: el día que alguien responda una pregunta
 * abierta con un diagnóstico, nadie va a volver a mirar si esta encuesta
 * estaba marcada como de salud.
 */
const construirDestinatario = (persona, { responses = [], estado = 'pendiente' } = {}, llave, llaveSalud) => ({
    personaId: persona.personaId || persona.workerId,
    workerId: persona.personaId || persona.workerId,
    nombre: persona.nombre,
    apellido: persona.apellido || '',
    rutCifrado: cifrarConLlaveDatos(persona.rut ?? null, llave),
    cargo: persona.cargo,
    estado,
    respondedAt: null,
    responsesCifradas: cifrarConLlaveDatosSiempre(responses, llaveSalud),
});

/** Descifra los destinatarios de una encuesta para mostrarla. */
const descifrarEncuesta = (encuesta, llave, llaveSalud) => {
    if (!encuesta || !Array.isArray(encuesta.recipients)) return encuesta;
    return {
        ...encuesta,
        recipients: encuesta.recipients.map((r) => {
            const base = descifrarCamposEnObjeto(r, CAMPOS.destinatario, llave);
            if (base.responsesCifradas === undefined) return base;
            const { responsesCifradas, ...resto } = base;
            return { ...resto, responses: descifrarConLlaveDatosSiempre(responsesCifradas, llaveSalud) };
        }),
    };
};

/** Cifra las respuestas de un destinatario ya existente (al responder). */
const cifrarRespuestas = (responses, llaveSalud) => cifrarConLlaveDatosSiempre(responses ?? [], llaveSalud);

const descifrarSolicitud = (req, llave) => {
    if (!req) return req;
    const base = descifrarCamposEnObjeto(req, ['solicitanteRut'], llave);
    return {
        ...base,
        trabajadores: descifrarCamposEnArreglo(req.trabajadores, CAMPOS.trabajador, llave),
    };
};

// ─── Versiones que resuelven la llave solas ──────────────────────────────────
//
// Para quien tiene un `tenantId` y no quiere saber de llaves. La variante en
// plural desenvuelve UNA vez y descifra los N elementos con esa misma llave:
// listar cien documentos cuesta una llamada a KMS, no cien.

const conLlave = (fn) => async (valor, tenantId) => {
    if (!valor || !tenantId) return valor;
    const llave = await llaveDe(tenantId);
    return fn(valor, llave);
};

const conLlaveLista = (fn) => async (lista, tenantId) => {
    if (!Array.isArray(lista) || lista.length === 0 || !tenantId) return lista;
    const llave = await llaveDe(tenantId);
    return lista.map((x) => fn(x, llave));
};

/** Encuestas: hacen falta las DOS llaves, y también se desenvuelven una sola
 *  vez por invocación aunque la lista traiga veinte encuestas. */
const descifrarEncuestaDeTenant = async (encuesta, tenantId) => {
    if (!encuesta || !tenantId) return encuesta;
    const [llave, llaveSalud] = await Promise.all([llaveDe(tenantId), llaveSaludDe(tenantId)]);
    return descifrarEncuesta(encuesta, llave, llaveSalud);
};

const descifrarEncuestasDeTenant = async (lista, tenantId) => {
    if (!Array.isArray(lista) || lista.length === 0 || !tenantId) return lista;
    // El listado se sirve desde `tenantId-index`, que a propósito NO proyecta
    // `recipients` — ahí viven el RUT y las respuestas, y sacarlos del índice
    // fue una corrección anterior. Así que normalmente no hay nada que
    // descifrar y no vale la pena ir a buscar dos llaves para nada. Se
    // comprueba en vez de asumirlo: si algún día la proyección cambia, esto
    // sigue descifrando en lugar de devolver sobres a la pantalla.
    if (!lista.some((e) => Array.isArray(e?.recipients) && e.recipients.length > 0)) return lista;
    const [llave, llaveSalud] = await Promise.all([llaveDe(tenantId), llaveSaludDe(tenantId)]);
    return lista.map((e) => descifrarEncuesta(e, llave, llaveSalud));
};

module.exports = {
    CAMPOS,
    llaveDe,
    llaveSaludDe,
    construirDestinatario,
    cifrarRespuestas,
    descifrarEncuesta,
    descifrarEncuestaDeTenant,
    descifrarEncuestasDeTenant,
    cifrarCamposEnObjeto,
    descifrarCamposEnObjeto,
    cifrarCamposEnArreglo,
    descifrarCamposEnArreglo,
    construirAsignacion,
    cifrarDocumento,
    descifrarDocumento,
    descifrarActividad,
    descifrarSolicitud,
    descifrarDocumentoDeTenant: conLlave(descifrarDocumento),
    descifrarDocumentosDeTenant: conLlaveLista(descifrarDocumento),
    descifrarActividadDeTenant: conLlave(descifrarActividad),
    descifrarActividadesDeTenant: conLlaveLista(descifrarActividad),
    descifrarSolicitudDeTenant: conLlave(descifrarSolicitud),
    descifrarSolicitudesDeTenant: conLlaveLista(descifrarSolicitud),
};
