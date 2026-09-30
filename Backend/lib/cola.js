/**
 * Colas de trabajo (D-24, D-25): el único punto por el que se encola.
 *
 *  - `EVENTOS`: notificaciones del EventBus. Van a cola por DURABILIDAD, no por
 *    velocidad: un aviso que falla se reintenta en vez de perderse en silencio.
 *  - `CARGAS`: la carga masiva de personas, un mensaje por fila.
 *
 * Las consume `handlers/cola/trabajador.js`. Sin la URL de la cola en el
 * entorno (pruebas, ejecución local) `colaConfigurada` devuelve false y quien
 * encola decide qué hacer (el EventBus despacha en la petición).
 */

const { SQSClient, SendMessageBatchCommand } = require('@aws-sdk/client-sqs');
const crypto = require('crypto');

const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });

const URL_DE = {
    EVENTOS: () => process.env.EVENTOS_QUEUE_URL,
    CARGAS: () => process.env.CARGAS_QUEUE_URL,
};

const colaConfigurada = (cola) => Boolean(URL_DE[cola]?.());

/**
 * Encola `mensajes` (objetos; se serializan a JSON) en lotes de 10, en paralelo.
 * Lo que SQS rechaza se reintenta una vez; si aún falla, lanza con la cuenta,
 * y ningún mensaje queda "a medias": el que no salió, no salió.
 */
async function encolar(cola, mensajes) {
    const url = URL_DE[cola]?.();
    if (!url) throw new Error(`Cola ${cola} sin configurar`);
    const lotes = [];
    for (let i = 0; i < mensajes.length; i += 10) lotes.push(mensajes.slice(i, i + 10));

    const enviarLote = async (lote) => {
        const entradas = lote.map((m) => ({ Id: crypto.randomUUID(), MessageBody: JSON.stringify(m) }));
        const porId = new Map(entradas.map((e) => [e.Id, e]));
        let pendientes = entradas;
        for (let intento = 0; intento < 2 && pendientes.length; intento++) {
            const r = await sqs.send(new SendMessageBatchCommand({ QueueUrl: url, Entries: pendientes }));
            pendientes = (r.Failed || []).map((f) => porId.get(f.Id)).filter(Boolean);
        }
        return pendientes.length;
    };

    let fallidos = 0;
    for (let i = 0; i < lotes.length; i += 10) {
        const r = await Promise.all(lotes.slice(i, i + 10).map(enviarLote));
        fallidos += r.reduce((a, b) => a + b, 0);
    }
    if (fallidos) {
        const err = new Error(`${fallidos} de ${mensajes.length} mensajes no se pudieron encolar en ${cola}`);
        err.codigo = 'ENCOLADO_INCOMPLETO';
        throw err;
    }
    return mensajes.length;
}

module.exports = { encolar, colaConfigurada, _sqs: sqs };
