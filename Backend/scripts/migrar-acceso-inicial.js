#!/usr/bin/env node
const { ScanCommand } = require('@aws-sdk/lib-dynamodb');

const OMITIDAS = ['TEMPORAL_VIGENTE', 'SIN_INICIAL', 'TEMPORAL_CONFLICTO', 'SIN_ACCESO_WEB'];

async function migrar({ aplicar, actor, ahora = new Date() }) {
    const { docClient } = require('../lib/clients/dynamodb');
    const { PersonaService } = require('../lib/services/PersonaService');
    const credenciales = require('../lib/credenciales');
    const svc = new PersonaService();
    const resultado = { porMigrar: 0, migradas: 0, yaVigentes: 0, omitidas: {} };
    let desde;
    do {
        const r = await docClient.send(new ScanCommand({
            TableName: svc.table,
            FilterExpression: `begins_with(SK, :prefix) AND tieneAccesoWeb = :si AND #estado <> :desv AND #estado <> :susp AND ${credenciales.CONDICION_PENDIENTE}`,
            ExpressionAttributeNames: { '#estado': 'estado' },
            ExpressionAttributeValues: { ':prefix': 'PERSONA#', ':si': true, ':desv': 'desvinculado', ':susp': 'suspendido' },
            ProjectionExpression: 'personaId, tenantId, credencialInicial, passwordTemporal, passwordTemporalVence',
            ...(desde ? { ExclusiveStartKey: desde } : {}),
        }));
        for (const it of r.Items || []) {
            if (it.credencialInicial && it.passwordTemporalVence && !credenciales.temporalVencida(it, ahora)) {
                resultado.yaVigentes += 1;
                continue;
            }
            resultado.porMigrar += 1;
            if (!aplicar) continue;
            try {
                await svc.reactivarInicial(it.tenantId, it.personaId, { actor, origen: { canal: 'operador' }, ahora });
                resultado.migradas += 1;
            } catch (err) {
                if (!OMITIDAS.includes(err.codigo)) throw err;
                resultado.omitidas[err.codigo] = (resultado.omitidas[err.codigo] || 0) + 1;
            }
        }
        desde = r.LastEvaluatedKey;
    } while (desde);
    return resultado;
}

module.exports = { migrar };

if (require.main === module) {
    const args = process.argv.slice(2);
    const stage = args[args.indexOf('--stage') + 1];
    const aplicar = args.includes('--aplicar');
    if (!['dev', 'prod'].includes(stage) || args.some((a) => !['--stage', stage, '--aplicar'].includes(a))) {
        console.error('\n  Uso: node scripts/migrar-acceso-inicial.js --stage <dev|prod> [--aplicar]\n');
        process.exit(1);
    }
    process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
    require('./entorno').cargarEntornoDe(stage);
    const actor = { id: require('./entorno').operadorActual(), tipo: 'operador', nombre: 'Soporte de Build & Serve' };
    migrar({ aplicar, actor })
        .then((r) => {
            console.log(`${aplicar ? 'Aplicado' : 'Simulación (usa --aplicar para escribir)'} en ${stage}:`);
            console.log(`  ${aplicar ? 'Migradas' : 'Por migrar'}: ${aplicar ? r.migradas : r.porMigrar}`);
            console.log(`  Con la inicial ya vigente: ${r.yaVigentes}`);
            for (const [codigo, n] of Object.entries(r.omitidas)) console.log(`  Omitidas (${codigo}): ${n}`);
        })
        .catch((err) => { console.error('ERROR', err.name, err.message); process.exit(1); });
}
