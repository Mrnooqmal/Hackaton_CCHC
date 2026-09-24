#!/usr/bin/env node
/**
 * Repara las fichas y empresas que quedaron en el esquema legado (RUT y
 * salud en claro) tras D-10, escribiéndolas en el formato nuevo.
 *
 * NO es un script de migración batch para producción real: es la reparación
 * puntual de las pocas filas de prueba que ya existían en dev y prod cuando
 * se implementó D-10 (aprobado explícitamente: "sin script de migración
 * batch... con una sola fila real... es más simple"). El sistema no lo
 * necesita para funcionar — "leer y reparar" ya cubre la migración normal,
 * campo por campo, la próxima vez que cada ficha se guarde — esto solo
 * adelanta esa reparación para no dejar datos de prueba en un formato que ya
 * no se escribe.
 *
 * Uso:
 *   AWS_PROFILE=<perfil> node scripts/reparar-cifrado-legado.js --stage dev [--confirmar]
 */

const args = process.argv.slice(2);
const stage = args[args.indexOf('--stage') + 1];
const confirmar = args.includes('--confirmar');

if (!stage || !['dev', 'prod'].includes(stage)) {
    console.error('\n  Uso: node scripts/reparar-cifrado-legado.js --stage <dev|prod> [--confirmar]\n');
    process.exit(1);
}
if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) {
    console.error('\n  Falta AWS_PROFILE: la autorización es IAM.\n');
    process.exit(1);
}

const SERVICIO = 'BuildAndServe';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.TENANTS_TABLE = `${SERVICIO}-tenants-${stage}`;
process.env.PERSONAS_TABLE = `${SERVICIO}-personas-${stage}`;
process.env.CAMPO_HMAC_KEY_PARAM = `/${SERVICIO}/${stage}/campo-hmac-key`;
process.env.CAMPO_CIFRADO_KMS_KEY_ID = stage === 'prod'
    ? '986d852a-f577-4c52-935d-0c418c05e8fd'
    : '06c59eb0-40d9-4328-a07c-c17fbfbf2e89';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const cifradoCampo = require('../lib/cifradoCampo');
const { llaveDeTenant, PROPOSITOS } = require('../lib/llaveTenant');

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const doc = DynamoDBDocumentClient.from(client);

(async () => {
    console.log(`\n  Ambiente: ${stage}${confirmar ? '' : '   (ENSAYO, no se escribe nada)'}\n`);

    // ── Empresas ────────────────────────────────────────────────────────────
    const tenants = await doc.send(new ScanCommand({
        TableName: process.env.TENANTS_TABLE,
        FilterExpression: 'begins_with(PK, :pk) AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': 'TENANT#', ':sk': 'METADATA#' },
    }));

    for (const t of tenants.Items || []) {
        if (t.rutEmpresaCifrado) continue; // ya migrada
        console.log(`  Empresa ${t.tenantId} — RUT ${t.rutEmpresa}`);
        if (!confirmar) continue;

        const [rutEmpresaHmac, rutEmpresaCifrado] = await Promise.all([
            cifradoCampo.hmacRut(t.rutEmpresa),
            cifradoCampo.cifrarSobre(t.rutEmpresa),
        ]);
        await doc.send(new UpdateCommand({
            TableName: process.env.TENANTS_TABLE,
            Key: { PK: t.PK, SK: t.SK },
            UpdateExpression: 'SET rutEmpresaHmac = :h, rutEmpresaCifrado = :c REMOVE rutEmpresa',
            ExpressionAttributeValues: { ':h': rutEmpresaHmac, ':c': rutEmpresaCifrado },
        }));
        console.log('    reparada');
    }

    // ── Personas ────────────────────────────────────────────────────────────
    const personas = await doc.send(new ScanCommand({
        TableName: process.env.PERSONAS_TABLE,
        FilterExpression: 'begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':sk': 'PERSONA#' },
    }));

    for (const p of personas.Items || []) {
        if (p.rutCifrado) continue; // ya migrada
        console.log(`  Persona ${p.personaId} (${p.tenantId}) — RUT ${p.rut}`);
        if (!confirmar) continue;

        const [llaveRut, llaveSalud] = await Promise.all([
            llaveDeTenant(p.tenantId, PROPOSITOS.RUT_PERSONAS),
            llaveDeTenant(p.tenantId, PROPOSITOS.SALUD),
        ]);
        const vigilancia = p.vigilanciaSalud || {
            enVigilancia: false, protocolos: [], fechaUltimoExamen: null, aptitudLaboral: null, restricciones: [],
        };
        const restriccion = p.restriccionLaboral !== undefined ? p.restriccionLaboral : null;

        const rutHmac = await cifradoCampo.hmacRut(p.rut);
        const rutCifrado = cifradoCampo.cifrarConLlaveDatos(p.rut, llaveRut);
        const vigilanciaSaludCifrada = cifradoCampo.cifrarConLlaveDatos(vigilancia, llaveSalud);
        const restriccionLaboralCifrada = cifradoCampo.cifrarConLlaveDatosSiempre(restriccion, llaveSalud);

        await doc.send(new UpdateCommand({
            TableName: process.env.PERSONAS_TABLE,
            Key: { PK: p.PK, SK: p.SK },
            UpdateExpression: 'SET rutHmac = :rh, rutCifrado = :rc, vigilanciaSaludCifrada = :vc, '
                + 'restriccionLaboralCifrada = :rlc REMOVE rut, vigilanciaSalud, restriccionLaboral',
            ExpressionAttributeValues: {
                ':rh': rutHmac, ':rc': rutCifrado, ':vc': vigilanciaSaludCifrada, ':rlc': restriccionLaboralCifrada,
            },
        }));
        console.log('    reparada');
    }

    console.log(confirmar ? '\n  Listo.\n' : '\n  Ensayo terminado. Repite con --confirmar para escribir.\n');
})().catch((err) => {
    console.error(`\n  Falló: ${err.message}\n`);
    process.exit(1);
});
