#!/usr/bin/env node
/**
 * Migración puntual del 28 de septiembre de 2026 (gobernanza del dato personal).
 *
 *   1. Incidentes: agrega `afectadoRutHmac` a los que no lo tienen, calculado
 *      desde su traza cifrada (lib/traza-sensible.js). Sin eso, la retención y
 *      la supresión no encuentran los incidentes de una persona.
 *   2. Incidentes: quita `realizadoPor.rut`, que el navegador mandaba y quedaba
 *      en claro (D-10). El código ya no lo escribe.
 *   3. Empresas: quita `reglas.representanteLegal.rut`, que quedó en claro en
 *      fichas anteriores a la corrección del representante. El código ya no lo
 *      escribe; el RUT sigue cifrado en la ficha de la persona.
 *
 * Por omisión solo cuenta lo que haría. Nunca imprime un RUT ni un nombre.
 *
 * Uso:
 *   AWS_PROFILE=<perfil> node scripts/migrar-gobernanza-2026-09.js --stage <dev|prod> [--aplicar]
 */

const args = process.argv.slice(2);
const stage = args[args.indexOf('--stage') + 1];
const aplicar = args.includes('--aplicar');
if (!['dev', 'prod'].includes(stage)) {
    console.error('\n  Uso: node scripts/migrar-gobernanza-2026-09.js --stage <dev|prod> [--aplicar]\n');
    process.exit(1);
}

const SERVICIO = 'BuildAndServe';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.INCIDENTS_TABLE = `${SERVICIO}-incidents-${stage}`;
process.env.TENANTS_TABLE = `${SERVICIO}-tenants-${stage}`;
// La llave HMAC (parámetro y VERSIÓN) y la CMK se toman de la configuración de
// la Lambda del ambiente, no se suponen: con otra versión, el HMAC no calzaría
// con el `rutHmac` de ninguna ficha.
const { execFileSync } = require('child_process');
const envLambda = JSON.parse(execFileSync('aws', ['lambda', 'get-function-configuration',
    '--function-name', `${SERVICIO}-${stage}-personasModule`, '--query', 'Environment.Variables', '--output', 'json']));
for (const k of ['CAMPO_HMAC_KEY_PARAM', 'CAMPO_HMAC_KEY_V', 'CAMPO_CIFRADO_KMS_KEY_ID']) {
    if (!envLambda[k]) { console.error(`Falta ${k} en la Lambda de ${stage}.`); process.exit(1); }
    process.env[k] = envLambda[k];
}

const { ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/clients/dynamodb');
const { conTraza, esTraza } = require('../lib/traza-sensible');
const { hmacRut } = require('../lib/cifradoCampo');
const { validateRut } = require('../lib/utils/validation');

async function todo(tabla) {
    const items = [];
    let desde;
    do {
        const r = await docClient.send(new ScanCommand({ TableName: tabla, ExclusiveStartKey: desde }));
        items.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);
    return items;
}

(async () => {
    const cuenta = { incidentes: 0, conHmacNuevo: 0, sinRutEnTraza: 0, realizadoPorRutQuitado: 0, empresas: 0, representanteRutQuitado: 0 };

    for (const it of await todo(process.env.INCIDENTS_TABLE)) {
        if (esTraza(it.incidentId)) continue;
        cuenta.incidentes += 1;
        const sets = [];
        const removes = [];
        const valores = {};
        if (!it.afectadoRutHmac) {
            const completo = await conTraza(process.env.INCIDENTS_TABLE, 'incidentId', it);
            const rut = completo?.trabajador?.rut;
            if (rut && validateRut(rut).valid) {
                sets.push('afectadoRutHmac = :h');
                valores[':h'] = await hmacRut(rut);
                cuenta.conHmacNuevo += 1;
            } else {
                cuenta.sinRutEnTraza += 1;
            }
        }
        if (it.realizadoPor && Object.prototype.hasOwnProperty.call(it.realizadoPor, 'rut')) {
            removes.push('realizadoPor.rut');
            cuenta.realizadoPorRutQuitado += 1;
        }
        if (aplicar && (sets.length || removes.length)) {
            await docClient.send(new UpdateCommand({
                TableName: process.env.INCIDENTS_TABLE,
                Key: { incidentId: it.incidentId },
                UpdateExpression: [sets.length ? `SET ${sets.join(', ')}` : '', removes.length ? `REMOVE ${removes.join(', ')}` : ''].join(' ').trim(),
                ...(Object.keys(valores).length ? { ExpressionAttributeValues: valores } : {}),
                ConditionExpression: 'attribute_exists(incidentId)',
            }));
        }
    }

    for (const it of await todo(process.env.TENANTS_TABLE)) {
        if (!String(it.SK || '').startsWith('METADATA')) continue;
        cuenta.empresas += 1;
        if (it.reglas?.representanteLegal && Object.prototype.hasOwnProperty.call(it.reglas.representanteLegal, 'rut')) {
            cuenta.representanteRutQuitado += 1;
            if (aplicar) {
                await docClient.send(new UpdateCommand({
                    TableName: process.env.TENANTS_TABLE,
                    Key: { PK: it.PK, SK: it.SK },
                    UpdateExpression: 'REMOVE reglas.representanteLegal.rut',
                    ConditionExpression: 'attribute_exists(PK)',
                }));
            }
        }
    }

    console.log(`${aplicar ? 'Aplicado' : 'Simulación (usa --aplicar para escribir)'} en ${stage}:`, cuenta);
})().catch((err) => { console.error('ERROR', err.name, err.message); process.exit(1); });
