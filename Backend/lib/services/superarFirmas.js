const { QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');

const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';
const PERSONAS_A_LA_VEZ = 10;
const CLASIFICACIONES_DE_COPIA = new Set(['diario', 'empresa']);

const firmoLaAsignacion = (a) => Boolean(a.estado === 'firmado' || a.fechaFirma) && !a.reutilizado;

const hayFirmas = (doc) => Boolean(doc.firmas?.length)
    || doc.firmaRelator?.estado === 'firmado'
    || (doc.asignaciones || []).some(firmoLaAsignacion);

const esCopiaIndividual = (doc) => CLASIFICACIONES_DE_COPIA.has(doc.clasificacion || 'diario')
    && (doc.asignaciones || []).length === 1;

const asignacionPendiente = ({ asistidoPor, ...asignacion }) => ({ ...asignacion, estado: 'pendiente', fechaFirma: null });

const relatorPendiente = () => ({ personaId: null, nombre: null, timestamp: null, estado: 'pendiente' });

const superarFirmasDePersona = async (referenciaId, personaId, superadas) => {
    const res = await docClient.send(new QueryCommand({
        TableName: SIGNATURES_TABLE,
        IndexName: 'personaId-index',
        KeyConditionExpression: 'personaId = :p',
        FilterExpression: 'referenciaId = :r AND #st = :v',
        ExpressionAttributeNames: { '#st': 'estado' },
        ExpressionAttributeValues: { ':p': personaId, ':r': referenciaId, ':v': 'valida' },
    }));
    for (const f of (res.Items || [])) {
        await docClient.send(new UpdateCommand({
            TableName: SIGNATURES_TABLE,
            Key: { signatureId: f.signatureId },
            UpdateExpression: 'SET #st = :s, supersededAt = :u',
            ExpressionAttributeNames: { '#st': 'estado' },
            ExpressionAttributeValues: { ':s': 'superada', ':u': new Date().toISOString() },
        }));
        superadas.push(f.signatureId);
    }
};

const restaurarFirmas = async (signatureIds) => {
    for (const signatureId of signatureIds) {
        try {
            await docClient.send(new UpdateCommand({
                TableName: SIGNATURES_TABLE,
                Key: { signatureId },
                UpdateExpression: 'SET #st = :v REMOVE supersededAt',
                ExpressionAttributeNames: { '#st': 'estado' },
                ExpressionAttributeValues: { ':v': 'valida' },
            }));
        } catch (e) {
            console.error(`La firma ${signatureId} quedó superada sin que cambiara su documento:`, e.message);
        }
    }
};

const superandoFirmas = async (referenciaId, personaIds, escribir) => {
    const personas = [...new Set(personaIds.filter(Boolean))];
    const superadas = [];
    try {
        for (let i = 0; i < personas.length; i += PERSONAS_A_LA_VEZ) {
            const tanda = await Promise.allSettled(personas.slice(i, i + PERSONAS_A_LA_VEZ)
                .map((p) => superarFirmasDePersona(referenciaId, p, superadas)));
            const fallo = tanda.find((r) => r.status === 'rejected');
            if (fallo) throw fallo.reason;
        }
        return await escribir();
    } catch (err) {
        await restaurarFirmas(superadas);
        throw err;
    }
};

const superandoFirmasDelDocumento = (doc, escribir) => superandoFirmas(doc.documentId, [
    ...(doc.asignaciones || []).map((a) => a.personaId),
    ...(doc.firmas || []).map((f) => f.personaId),
    doc.firmaRelator?.personaId,
], escribir);

module.exports = {
    firmoLaAsignacion,
    hayFirmas,
    esCopiaIndividual,
    asignacionPendiente,
    relatorPendiente,
    superandoFirmas,
    superandoFirmasDelDocumento,
};
