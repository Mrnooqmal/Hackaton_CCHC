/**
 * Auditoría de acceso a datos de salud: quién consultó o descargó una ficha de
 * vigilancia, una restricción laboral, un documento de salud o las respuestas de
 * la ficha de salud; cuándo; y desde dónde. Nunca el contenido.
 *
 * ── Cómo se usa ────────────────────────────────────────────────────────────
 * Cada handler que puede entregar datos de salud se envuelve con
 * `conAuditoriaSalud`. Adentro, cada punto que decide entregar uno llama a
 * `anotarAccesoSalud(...)`. Al terminar la petición se escribe UN evento con
 * todo lo anotado (un listado de 80 fichas es un evento, no 80).
 *
 * ── Sin registro, no hay acceso (fail-closed) ──────────────────────────────
 * Si el registro no se puede escribir, la respuesta con datos de salud NO sale:
 * se devuelve 503. Para datos de salud, poder demostrar quién accedió pesa más
 * que la disponibilidad; el fallo queda medido (`registrarFallo`). Decisión
 * técnica, D-18.
 *
 * ── Lo que no se registra ──────────────────────────────────────────────────
 * El acceso de una persona a SUS PROPIOS datos: es su derecho de acceso, y el
 * `/auth/me` de cada carga de página lo inundaría de ruido. Se registra solo el
 * acceso de terceros.
 *
 * El registro vive en `AuditoriaAccesosTable`: ningún rol puede actualizarlo ni
 * borrarlo (solo agregar y leer), y se conserva aunque se borre el stack.
 */

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { registrarFallo } = require('../degradacion');
const { error } = require('../utils/response');

const contexto = new AsyncLocalStorage();

const TIPOS = {
    FICHA: 'ficha_salud',                 // vigilancia de salud / restricción laboral de una ficha
    DOCUMENTO: 'documento_salud',         // ver un documento de salud (examen, etc.)
    DESCARGA: 'descarga_documento_salud', // URL de descarga del archivo
    RESPUESTAS: 'respuestas_ficha_salud', // respuestas de la ficha básica de salud
};

/**
 * ¿La ficha tiene datos de salud de verdad? No basta con que exista el campo
 * cifrado: `crear` cifra el "sin vigilancia" por defecto para todos.
 */
function tieneDatosDeSalud(persona) {
    if (!persona) return false;
    if (persona.restriccionLaboral) return true;
    const v = persona.vigilanciaSalud;
    return Boolean(v && (v.enVigilancia || v.protocolos?.length || v.fechaUltimoExamen || v.aptitudLaboral || v.restricciones?.length));
}

/** Huella de una clave de S3: la clave puede llevar el nombre del archivo (y el de la persona). */
const huellaClave = (k) => crypto.createHash('sha256').update(String(k)).digest('hex').slice(0, 32);

/**
 * Anota que esta petición entrega datos de salud. Fuera de un handler
 * envuelto lanza: un punto que entrega salud sin auditoría es un error de
 * programación, y tiene que verse en las pruebas, no en una fiscalización.
 */
function anotarAccesoSalud({ tipo, titulares = [], documentos = [], claves = [] }) {
    const ctx = contexto.getStore();
    if (!ctx) throw new Error('anotarAccesoSalud fuera de conAuditoriaSalud: este handler entrega datos de salud sin auditar');
    const deTerceros = titulares.filter((t) => t && t !== ctx.actorId);
    // Solo los propios datos: no se registra (ver arriba).
    if (!deTerceros.length && titulares.length && !documentos.length && !claves.length) return;
    ctx.eventos.push({ tipo, titulares: [...new Set(deTerceros)], documentos: [...new Set(documentos)], claves: [...new Set(claves.map(huellaClave))] });
}

function sesionDe(event) {
    const ctx = event?.requestContext?.authorizer?.lambda || {};
    return { tenantId: ctx.tenantId || null, personaId: ctx.personaId || null, rol: ctx.rol || null };
}

async function escribir(event, eventos, ahora = new Date()) {
    const s = sesionDe(event);
    const en = ahora.toISOString();
    const juntar = (campo) => [...new Set(eventos.flatMap((e) => e[campo]))];
    await docClient.send(new PutCommand({
        TableName: process.env.AUDITORIA_ACCESOS_TABLE,
        Item: {
            tenantId: s.tenantId || 'sin-empresa',
            sk: `${en}#${crypto.randomUUID()}`,
            en,
            actorId: s.personaId || 'desconocido',
            actorRol: s.rol,
            ip: event?.requestContext?.http?.sourceIp || null,
            userAgent: String(event?.headers?.['user-agent'] || event?.headers?.['User-Agent'] || '').slice(0, 200) || null,
            // Método y ruta, sin la consulta.
            ruta: `${event?.requestContext?.http?.method || ''} ${String(event?.rawPath || '').split('?')[0]}`.trim(),
            tipos: [...new Set(eventos.map((e) => e.tipo))],
            titulares: juntar('titulares'),
            documentos: juntar('documentos'),
            claves: juntar('claves'),
        },
        ConditionExpression: 'attribute_not_exists(sk)',
    }));
}

/** Envuelve un handler que puede entregar datos de salud. */
function conAuditoriaSalud(handler) {
    return async (event, ...resto) => {
        const ctx = { eventos: [], actorId: sesionDe(event).personaId };
        const respuesta = await contexto.run(ctx, () => handler(event, ...resto));
        if (!ctx.eventos.length || !respuesta || respuesta.statusCode >= 400) return respuesta;
        try {
            await escribir(event, ctx.eventos);
        } catch (err) {
            registrarFallo('auditoria.salud', err, { ruta: event?.rawPath || null });
            return error('No se pudo registrar el acceso a los datos de salud; por resguardo, no se entregan. Intenta de nuevo.', 503);
        }
        return respuesta;
    };
}

module.exports = { conAuditoriaSalud, anotarAccesoSalud, tieneDatosDeSalud, TIPOS, huellaClave };
