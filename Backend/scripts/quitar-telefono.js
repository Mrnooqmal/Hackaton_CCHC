#!/usr/bin/env node
/**
 * Migración puntual del 21 de noviembre de 2026: el sistema deja de tratar el
 * teléfono de la persona.
 *
 * El teléfono no tenía finalidad: no se llama ni se avisa por ese medio (el
 * aviso por SMS se abandonó el 29 de septiembre). Guardarlo sin finalidad va
 * contra los principios de finalidad y proporcionalidad de la Ley 19.628
 * (reformada por la Ley 21.719). El código ya no lo pide, ni lo lee, ni lo
 * escribe, ni lo exporta; este script quita el atributo `telefono` de las fichas
 * de persona que todavía lo tienen.
 *
 * No toca `contactoEmergencia.telefono`: es el número de un tercero, con otra
 * finalidad (avisar en una emergencia en obra).
 *
 * Solo lee las claves de las fichas que tienen el atributo (ProjectionExpression),
 * nunca datos personales. Por omisión solo cuenta lo que haría. Es idempotente.
 *
 * Uso:
 *   AWS_PROFILE=<perfil> node scripts/quitar-telefono.js --stage <dev|prod> [--aplicar]
 */

const args = process.argv.slice(2);
const stage = args[args.indexOf('--stage') + 1];
const aplicar = args.includes('--aplicar');
if (!['dev', 'prod'].includes(stage)) {
    console.error('\n  Uso: node scripts/quitar-telefono.js --stage <dev|prod> [--aplicar]\n');
    process.exit(1);
}

process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const TABLA = `BuildAndServe-personas-${stage}`;

const { ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/clients/dynamodb');

(async () => {
    let fichas = 0;
    let desde;
    do {
        const r = await docClient.send(new ScanCommand({
            TableName: TABLA,
            FilterExpression: 'attribute_exists(telefono)',
            ProjectionExpression: 'PK, SK',
            ExclusiveStartKey: desde,
        }));
        for (const it of r.Items || []) {
            fichas += 1;
            if (aplicar) {
                await docClient.send(new UpdateCommand({
                    TableName: TABLA,
                    Key: { PK: it.PK, SK: it.SK },
                    UpdateExpression: 'REMOVE telefono',
                    ConditionExpression: 'attribute_exists(PK)',
                }));
            }
        }
        desde = r.LastEvaluatedKey;
    } while (desde);

    console.log(`${aplicar ? 'Aplicado' : 'Simulación (usa --aplicar para escribir)'} en ${stage}: ${fichas} ficha(s) con telefono.`);
})().catch((err) => { console.error('ERROR', err.name, err.message); process.exit(1); });
