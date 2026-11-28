/**
 * Firmas que dejan de valer porque el archivo firmado se reemplazó.
 */
const { QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');

const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';

// Marca como 'superada' las firmas válidas de unas personas para una referencia
// (al renovar un documento: la firma anterior es de una versión previa). Las firmas
// no se borran (auditoría); cambiar el estado permite volver a firmar la versión
// nueva (la verificación de idempotencia solo cuenta firmas 'valida').
const supersedeFirmasDeReferencia = async (referenciaId, personaIds) => {
    for (const pid of personaIds) {
        try {
            const res = await docClient.send(new QueryCommand({
                TableName: SIGNATURES_TABLE,
                IndexName: 'personaId-index',
                KeyConditionExpression: 'personaId = :p',
                FilterExpression: 'referenciaId = :r AND #st = :v',
                ExpressionAttributeNames: { '#st': 'estado' },
                ExpressionAttributeValues: { ':p': pid, ':r': referenciaId, ':v': 'valida' },
            }));
            for (const f of (res.Items || [])) {
                await docClient.send(new UpdateCommand({
                    TableName: SIGNATURES_TABLE,
                    Key: { signatureId: f.signatureId },
                    UpdateExpression: 'SET #st = :s, supersededAt = :u',
                    ExpressionAttributeNames: { '#st': 'estado' },
                    ExpressionAttributeValues: { ':s': 'superada', ':u': new Date().toISOString() },
                }));
            }
        } catch (e) {
            console.error('No se pudo superar firma previa al renovar:', e.message);
        }
    }
};

/**
 * Lo mismo para todas las personas de un documento, con el estado que tenía
 * ANTES de cambiar su archivo. Incluye a quienes figuran pendientes: pueden
 * conservar una firma válida de una versión anterior.
 */
const supersedeFirmasDelDocumento = async (doc) => {
    const personas = new Set([
        ...(doc.asignaciones || []).map((a) => a.personaId),
        ...(doc.firmas || []).map((f) => f.personaId),
        doc.firmaRelator?.personaId,
    ].filter(Boolean));
    await Promise.all([...personas].map((p) => supersedeFirmasDeReferencia(doc.documentId, [p])));
};

module.exports = { supersedeFirmasDeReferencia, supersedeFirmasDelDocumento };
