// Doble de SQS para las colas de trabajo (lib/cola.js): captura lo que se
// encola y lo entrega al trabajador (handlers/cola/trabajador.js) como lo haría
// SQS, con número de entrega, reintento de lo que falla y cola de fallidos al
// sexto intento (el maxReceiveCount de serverless.yml).

const { _sqs } = require('../lib/cola');

const MAX_RECIBOS = 6;

function crearDobleCola() {
    const antes = { e: process.env.EVENTOS_QUEUE_URL, c: process.env.CARGAS_QUEUE_URL };
    process.env.EVENTOS_QUEUE_URL = 'https://sqs.prueba/eventos';
    process.env.CARGAS_QUEUE_URL = 'https://sqs.prueba/cargas';
    const original = _sqs.send;
    const colas = { eventos: [], cargas: [], fallidos: [] };
    let n = 0;
    let fallarEnvios = 0;
    _sqs.send = async (cmd) => {
        if (fallarEnvios > 0) { fallarEnvios--; throw Object.assign(new Error('SQS no disponible'), { name: 'ServiceUnavailable' }); }
        const cola = cmd.input.QueueUrl.endsWith('/eventos') ? colas.eventos : colas.cargas;
        for (const e of cmd.input.Entries) cola.push({ messageId: `m${++n}`, body: e.MessageBody, recibos: 0 });
        return { Successful: cmd.input.Entries.map((e) => ({ Id: e.Id })), Failed: [] };
    };

    /** Entrega todo lo encolado al trabajador, ronda tras ronda, hasta vaciar. */
    async function drenar({ maxRondas = 60 } = {}) {
        const { handler } = require('../handlers/cola/trabajador');
        for (let r = 0; r < maxRondas; r++) {
            const lote = [...colas.eventos.splice(0), ...colas.cargas.splice(0)];
            if (!lote.length) return;
            for (const m of lote) m.recibos++;
            const res = await handler({ Records: lote.map((m) => ({ messageId: m.messageId, body: m.body, attributes: { ApproximateReceiveCount: String(m.recibos) } })) });
            const fallidos = new Set((res.batchItemFailures || []).map((f) => f.itemIdentifier));
            for (const m of lote) {
                if (!fallidos.has(m.messageId)) continue;
                if (m.recibos >= MAX_RECIBOS) colas.fallidos.push(m);
                else (JSON.parse(m.body).tipo === 'evento' ? colas.eventos : colas.cargas).push(m);
            }
        }
        throw new Error('La cola no se vació');
    }

    return {
        colas, drenar,
        fallarProximosEnvios: (k) => { fallarEnvios = k; },
        restaurar() {
            _sqs.send = original;
            if (antes.e === undefined) delete process.env.EVENTOS_QUEUE_URL; else process.env.EVENTOS_QUEUE_URL = antes.e;
            if (antes.c === undefined) delete process.env.CARGAS_QUEUE_URL; else process.env.CARGAS_QUEUE_URL = antes.c;
        },
    };
}

module.exports = { crearDobleCola };
