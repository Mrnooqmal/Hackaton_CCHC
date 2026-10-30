// Ayuda de pruebas: deja a una persona con consentimientos vigentes, como si
// los hubiera otorgado en "Mis datos y privacidad" (lib/gobernanza/consentimiento.js).
// Escribe solo la copia mínima de la ficha, que es lo que consultan los demás
// módulos; el flujo completo (registro, historial) se prueba en consentimiento.test.js.

const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/clients/dynamodb');
const { FINALIDADES, marca } = require('../lib/gobernanza/consentimiento');

async function consentir(persona, finalidades) {
    await docClient.send(new UpdateCommand({
        TableName: process.env.PERSONAS_TABLE,
        Key: { PK: `TENANT#${persona.tenantId}`, SK: `PERSONA#${persona.personaId}` },
        UpdateExpression: 'SET consentimientos = :m',
        ExpressionAttributeValues: { ':m': new Set(finalidades.map((f) => marca(f, FINALIDADES[f].versionActual))) },
    }));
}

module.exports = { consentir };
