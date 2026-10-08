#!/usr/bin/env node
/**
 * Informe de brecha (Ley 21.719): qué datos personales, de qué personas y de
 * qué empresas quedaron expuestos en un incidente. Lógica en
 * lib/gobernanza/brecha.js; esto carga los datos según el alcance declarado.
 *
 * Lo corre la plataforma (encargada del tratamiento): una brecha puede cruzar
 * empresas, y cada empresa responsable necesita saber qué le toca a ella.
 * Solo lee: no cambia nada.
 *
 * Alcances (combinables):
 *   --actor <personaId> [--actor …] --desde <ISO> --hasta <ISO>
 *       cuenta comprometida: salud confirmada por la auditoría en la ventana,
 *       y lo que podía leer en su empresa (cota superior).
 *   --tabla <ENV> [--tabla …] [--empresa <tenantId>]
 *       tabla expuesta (p. ej. PERSONAS_TABLE), opcionalmente de una empresa.
 *   --prefijo <clave S3>
 *       archivos expuestos bajo un prefijo (p. ej. tenants/<empresa>/documentos/).
 *
 * Uso:
 *   AWS_PROFILE=<perfil> node scripts/informe-brecha.js --stage prod --actor p-123 --desde 2026-09-01T00:00:00Z --hasta 2026-09-29T00:00:00Z [--json]
 */

const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const valores = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
const uno = (flag) => valores(flag)[0];
const stage = uno('--stage');
if (!['dev', 'prod'].includes(stage)) { console.error('Falta --stage dev|prod'); process.exit(1); }

// Nombres de tablas y buckets: los de la Lambda del ambiente.
const env = JSON.parse(execFileSync('aws', ['lambda', 'get-function-configuration', '--function-name', `BuildAndServe-${stage}-personasModule`, '--query', 'Environment.Variables', '--output', 'json']));
for (const [k, v] of Object.entries(env)) if (/_TABLE$|_BUCKET$/.test(k)) process.env[k] = v;
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const { QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { docClient } = require('../lib/clients/dynamodb');
const { s3Client } = require('../lib/clients/s3');
const { informeDeBrecha, fuentesLegibles } = require('../lib/gobernanza/brecha');
const { _interno: { cargarEmpresa } } = require('../handlers/gobernanza/retencion');

async function paginar(Cmd, params) {
    const items = [];
    let desde;
    do {
        const r = await docClient.send(new Cmd({ ...params, ExclusiveStartKey: desde }));
        items.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);
    return items;
}

const ctxDe = (personas) => ({ personaPorRutHmac: Object.fromEntries(personas.filter((p) => p.rutHmac).map((p) => [p.rutHmac, p.personaId])) });

async function empresaDePersona(personaId) {
    const r = await paginar(QueryCommand, { TableName: process.env.PERSONAS_TABLE, IndexName: 'personaId-index', KeyConditionExpression: 'personaId = :p', ExpressionAttributeValues: { ':p': personaId } });
    return r[0] ? String(r[0].PK).replace(/^TENANT#/, '') : null;
}

(async () => {
    const alcance = { actores: valores('--actor'), desde: uno('--desde') || null, hasta: uno('--hasta') || null, tablas: valores('--tabla'), empresa: uno('--empresa') || null, prefijo: uno('--prefijo') || null };
    const partes = { alcance, tablas: [], accesos: null, archivos: [], ctxPorEmpresa: {}, potencial: false };

    if (alcance.actores.length) {
        if (!alcance.desde || !alcance.hasta) { console.error('Una cuenta comprometida necesita --desde y --hasta.'); process.exit(1); }
        partes.accesos = [];
        partes.potencial = true;
        for (const actor of alcance.actores) {
            partes.accesos.push(...await paginar(QueryCommand, {
                TableName: process.env.AUDITORIA_ACCESOS_TABLE, IndexName: 'actorId-en-index',
                KeyConditionExpression: 'actorId = :a AND en BETWEEN :d AND :h',
                ExpressionAttributeValues: { ':a': actor, ':d': alcance.desde, ':h': alcance.hasta },
            }));
            // Lo que la cuenta podía leer en su empresa: cota superior.
            const empresa = await empresaDePersona(actor);
            if (empresa) {
                const registros = await cargarEmpresa(empresa);
                partes.ctxPorEmpresa[empresa] = ctxDe(registros.PERSONAS_TABLE);
                for (const t of fuentesLegibles()) if (registros[t]) partes.tablas.push({ tabla: t, items: registros[t] });
            }
        }
    }

    for (const t of alcance.tablas) {
        const items = await paginar(ScanCommand, { TableName: process.env[t] });
        const filtrados = alcance.empresa ? items.filter((it) => it.tenantId === alcance.empresa || it.PK === `TENANT#${alcance.empresa}`) : items;
        partes.tablas.push({ tabla: t, items: filtrados });
    }

    if (alcance.prefijo) {
        for (const bucket of [process.env.EVIDENCIA_BUCKET, process.env.TRABAJO_BUCKET]) {
            let token;
            do {
                const r = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: alcance.prefijo, ContinuationToken: token }));
                partes.archivos.push(...(r.Contents || []).map((o) => o.Key));
                token = r.IsTruncated ? r.NextContinuationToken : undefined;
            } while (token);
        }
        // De quién son: los registros de las empresas de esos archivos (contexto,
        // no exposición: las tablas en sí no se filtraron).
        partes.contexto = [];
        for (const empresa of new Set(partes.archivos.map((k) => k.split('/')[1]).filter(Boolean))) {
            const registros = await cargarEmpresa(empresa);
            partes.ctxPorEmpresa[empresa] = ctxDe(registros.PERSONAS_TABLE);
            for (const [t, items] of Object.entries(registros)) partes.contexto.push({ tabla: t, items });
        }
    }

    const informe = informeDeBrecha(partes);

    if (args.includes('--json')) { console.log(JSON.stringify(informe, null, 2)); return; }

    const l = [];
    l.push(`# Informe de brecha (${stage})`, '', `Generado: ${informe.generadoEn}`, '', `**${informe.naturaleza}**`, '');
    l.push('## Alcance declarado', '', '```', JSON.stringify(alcance, null, 2), '```', '');
    l.push(`## Resumen`, '', `- Empresas afectadas: ${informe.totales.empresas}`, `- Personas afectadas: ${informe.totales.personas}`, `- Datos de salud: ${informe.datosDeSalud ? 'SÍ' : 'no'}`, '');
    if (informe.saludConfirmada) {
        const s = informe.saludConfirmada;
        l.push('## Accesos a salud confirmados (auditoría)', '', `- Accesos: ${s.accesos} (${s.primero || '—'} a ${s.ultimo || '—'})`, `- Tipos: ${s.tipos.join(', ') || '—'}`, `- Titulares: ${s.titulares}`, `- Documentos: ${s.documentos.length}`, '');
    }
    l.push('## Qué datos', '', '| Categoría | Datos | Salud | Registros | Personas | Empresas |', '|---|---|---|---|---|---|');
    for (const c of informe.categorias) l.push(`| ${c.nombre} | ${c.datos.replace(/\|/g, '/')} | ${c.salud ? 'sí' : 'no'} | ${c.registros} | ${c.personas} | ${c.empresas} |`);
    if (informe.archivos.length) l.push('', `## Archivos (${informe.archivos.length})`, '', ...informe.archivos.slice(0, 200).map((a) => `- ${a.key} — empresa ${a.empresa || '?'} — ${a.sinRegistro ? 'sin registro que lo mencione' : `${a.personas.length} persona(s)`}`));
    l.push('', '## Personas por empresa (identificadores)', '');
    for (const [emp, ps] of Object.entries(informe.personasPorEmpresa)) l.push(`- ${emp}: ${ps.length} — ${ps.join(', ')}`);
    console.log(l.join('\n'));
})().catch((err) => { console.error('ERROR', err.name, err.message); process.exit(1); });
