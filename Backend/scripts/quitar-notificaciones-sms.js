#!/usr/bin/env node
/**
 * Migración puntual del 29 de septiembre de 2026: se abandona el aviso por SMS.
 *
 * Quita `notificacionesSms` de las fichas de persona que lo tienen. El código ya
 * no lo lee ni lo escribe; sin esta limpieza la preferencia quedaría guardada
 * sin finalidad, y además fuera del inventario de gobernanza, que ya no la lista.
 *
 * Solo lee las claves de las fichas que tienen el atributo (ProjectionExpression),
 * nunca datos personales. Por omisión solo cuenta lo que haría.
 *
 * Uso:
 *   AWS_PROFILE=<perfil> node scripts/quitar-notificaciones-sms.js --stage <dev|prod> [--aplicar]
 */

const args = process.argv.slice(2);
const stage = args[args.indexOf('--stage') + 1];
const aplicar = args.includes('--aplicar');
if (!['dev', 'prod'].includes(stage)) {
    console.error('\n  Uso: node scripts/quitar-notificaciones-sms.js --stage <dev|prod> [--aplicar]\n');
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
            FilterExpression: 'attribute_exists(notificacionesSms)',
            ProjectionExpression: 'PK, SK',
            ExclusiveStartKey: desde,
        }));
        for (const it of r.Items || []) {
            fichas += 1;
            if (aplicar) {
                await docClient.send(new UpdateCommand({
                    TableName: TABLA,
                    Key: { PK: it.PK, SK: it.SK },
                    UpdateExpression: 'REMOVE notificacionesSms',
                    ConditionExpression: 'attribute_exists(PK)',
                }));
            }
        }
        desde = r.LastEvaluatedKey;
    } while (desde);

    console.log(`${aplicar ? 'Aplicado' : 'Simulación (usa --aplicar para escribir)'} en ${stage}: ${fichas} ficha(s) con notificacionesSms.`);
})().catch((err) => { console.error('ERROR', err.name, err.message); process.exit(1); });
