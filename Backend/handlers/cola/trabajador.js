/**
 * Trabajador de las colas (D-24, D-25). Consume las dos colas:
 *
 *  - `evento`       → EventBus.despachar en modo estricto: si un aviso falla,
 *                     el mensaje vuelve a la cola y se reintenta.
 *  - `carga.fila`   → crea una persona de una carga masiva (lib/cargas.js).
 *  - `carga.fase2`  → asigna supervisores cuando la carga terminó.
 *
 * Devuelve `batchItemFailures`: SQS reintenta solo los mensajes que fallaron,
 * no el lote entero. Lo que falla repetidamente termina en la cola de mensajes
 * fallidos, que tiene alarma; las filas de una carga, antes de eso, quedan
 * `fallidas` con su motivo.
 */

const { eventBus } = require('../../lib/events/EventBus');
const cargas = require('../../lib/cargas');
const { registrarFallo } = require('../../lib/degradacion');

// Las dependencias de la carga viven en el módulo de personas; se cargan al
// primer uso para que un evento no pague el costo de ese módulo.
let depsCarga = null;
const deps = () => (depsCarga ||= require('../personas-module/handler').dependenciasCarga());

async function procesar(record) {
    const msg = JSON.parse(record.body);
    const intento = Number(record.attributes?.ApproximateReceiveCount || 1);
    switch (msg.tipo) {
        case 'evento':
            return eventBus.despachar(msg.evento, msg.data, { eventoId: msg.eventoId, estricto: true });
        case 'carga.fila':
            return cargas.procesarFila(msg, deps(), { intento });
        case 'carga.fase2':
            return cargas.fase2(msg, deps());
        default:
            // Un mensaje que nadie entiende no se reintenta: se registra y se descarta.
            registrarFallo('cola.mensaje_desconocido', new Error(`tipo ${msg.tipo}`), {});
            return undefined;
    }
}

module.exports.handler = async (event) => {
    const batchItemFailures = [];
    await Promise.all((event.Records || []).map(async (record) => {
        try {
            await procesar(record);
        } catch (err) {
            let tipo = 'desconocido';
            try { tipo = JSON.parse(record.body).tipo; } catch { /* cuerpo ilegible */ }
            if (!(err instanceof cargas.Reintentar)) {
                registrarFallo('cola.mensaje', err, { tipo, intento: record.attributes?.ApproximateReceiveCount || null });
            }
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }));
    return { batchItemFailures };
};
