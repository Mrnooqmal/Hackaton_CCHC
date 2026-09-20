/**
 * Datos personales que NO viven en el elemento listado.
 *
 * ── El problema ──────────────────────────────────────────────────────────────
 *
 * Un índice global con proyección `ALL` es una copia completa de cada elemento.
 * En incidentes eso significa el RUT, el nombre y el género de la persona
 * accidentada repetidos fuera de la tabla; en firmas, el RUT de quien firmó y la
 * dirección IP desde la que lo hizo.
 *
 * La salida obvia es `INCLUDE`, enumerando lo que el listado necesita. No sirve
 * acá por dos razones comprobadas:
 *
 *   1. `INCLUDE` solo proyecta atributos de PRIMER NIVEL. No se puede incluir
 *      `trabajador.nombre` y dejar fuera `trabajador.rut`: el mapa va entero o no
 *      va. En incidentes, lo sensible está dentro de mapas.
 *   2. `INCLUDE` es una lista de permitidos, y cambiarla obliga a borrar y
 *      recrear el índice. Cada columna nueva en una pantalla costaría una ventana
 *      de indisponibilidad.
 *
 * ── El mecanismo ─────────────────────────────────────────────────────────────
 *
 * El dato sensible se guarda en un elemento APARTE de la misma tabla, con la
 * clave derivada (`<id>#traza`). Ese elemento **no lleva `tenantId` ni ningún
 * otro atributo de clave de índice**, y un índice global solo indexa los
 * elementos que tienen su clave: el elemento aparte no aparece en NINGÚN índice.
 * Es la propiedad de "índice disperso" de DynamoDB usada a propósito.
 *
 * El resultado es que el elemento listado puede seguir proyectándose entero sin
 * que ningún índice contenga un RUT, y agregar un campo a una pantalla no cuesta
 * ninguna ventana.
 *
 * ── Lo que cuesta ────────────────────────────────────────────────────────────
 *
 * Una escritura más al crear y una lectura más al abrir el detalle. Y una regla
 * que hay que respetar: **quien lea el elemento para mostrarlo entero tiene que
 * unir las dos partes** (`conTraza`). Un listado NO lo hace, y ahí está la
 * ganancia.
 */

const { GetCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./clients/dynamodb');
const { conNeutro } = require('./degradacion');

/** Sufijo de la clave del elemento aparte. */
const SUFIJO = '#traza';

const claveTraza = (id) => `${id}${SUFIJO}`;

/** ¿Este elemento es una traza y no un registro? Los listados por clave primaria
 *  —un `Scan`— sí los ven, y no deben mostrarlos. */
const esTraza = (item, campoClave) => String(item?.[campoClave] || '').endsWith(SUFIJO);

/**
 * Guarda la parte sensible aparte.
 *
 * @param {string} tabla
 * @param {string} campoClave - nombre del atributo de clave (`incidentId`, `signatureId`)
 * @param {string} id
 * @param {object} datos - solo los atributos sensibles
 */
const guardarTraza = async (tabla, campoClave, id, datos) => {
    await docClient.send(new PutCommand({
        TableName: tabla,
        Item: {
            [campoClave]: claveTraza(id),
            // Sin `tenantId` ni `personaId` ni `requestId`: es lo que mantiene a
            // este elemento fuera de todos los índices. Si alguien agrega acá un
            // atributo que sea clave de un índice, la protección desaparece en
            // silencio y sin error.
            ...datos,
            creadoEn: new Date().toISOString(),
        },
    }));
};

/**
 * Une el registro con su parte sensible. Si la traza no está —o su lectura
 * falla— devuelve el registro tal cual, con constancia medible: es preferible un
 * detalle incompleto a no poder abrir un incidente.
 */
const conTraza = async (tabla, campoClave, item) => {
    if (!item) return item;
    const id = item[campoClave];
    if (!id) return item;

    const traza = await conNeutro('traza.lectura', async () => {
        const res = await docClient.send(new GetCommand({
            TableName: tabla,
            Key: { [campoClave]: claveTraza(id) },
        }));
        return res.Item || null;
    }, null, { tabla, id });

    if (!traza) return item;

    const { [campoClave]: _clave, creadoEn: _creado, ...sensibles } = traza;
    return { ...item, ...sensibles };
};

/** Borra la parte sensible. Solo para cuando se borra el registro entero. */
const borrarTraza = async (tabla, campoClave, id) => {
    await docClient.send(new DeleteCommand({
        TableName: tabla,
        Key: { [campoClave]: claveTraza(id) },
    }));
};

module.exports = { guardarTraza, conTraza, borrarTraza, esTraza, claveTraza, SUFIJO };
