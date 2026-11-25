#!/usr/bin/env node
const USO = `
  Restablecer la contraseña de una persona desde soporte (D7).

    AWS_PROFILE=<perfil> node scripts/restablecer-contrasena.js --stage <dev|prod> --empresa <tenantId> --rut <rut> --motivo "<ticket y motivo>"
    AWS_PROFILE=<perfil> node scripts/restablecer-contrasena.js --stage <dev|prod> --empresa <tenantId> --rut <rut> --motivo "<ticket y motivo>" --confirmar

  Sin --confirmar es un ensayo: muestra a quién afectaría y no escribe nada.
`;

async function sesionesAbiertas(personaId, ahora = new Date()) {
    const { QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
    const { docClient } = require('../lib/clients/dynamodb');
    const { SESSIONS_TABLE } = require('../lib/auth/sesion');
    let abiertas = 0;
    let desde;
    do {
        const r = await docClient.send(new QueryCommand({
            TableName: SESSIONS_TABLE,
            IndexName: 'personaId-index',
            KeyConditionExpression: 'personaId = :p',
            ExpressionAttributeValues: { ':p': personaId },
            ...(desde ? { ExclusiveStartKey: desde } : {}),
        }));
        for (const { sessionId } of r.Items || []) {
            const s = (await docClient.send(new GetCommand({ TableName: SESSIONS_TABLE, Key: { sessionId } }))).Item;
            if (s && s.activa !== false && new Date(s.expiresAt).getTime() > ahora.getTime()) abiertas += 1;
        }
        desde = r.LastEvaluatedKey;
    } while (desde);
    return abiertas;
}

async function ensayo({ tenantId, rut }) {
    const { PersonaService } = require('../lib/services/PersonaService');
    const { normalizeRol } = require('../lib/utils/validation');
    const svc = new PersonaService();
    const persona = await svc.getByRut(tenantId, rut);
    if (!persona) throw new Error(`No hay una persona con el RUT ${rut} en la empresa ${tenantId}.`);
    const plantel = await svc.listByTenant(tenantId);
    const administradores = plantel.filter((p) => normalizeRol(p.rol) === 'admin' && p.estado !== 'desvinculado');
    return {
        empresa: tenantId,
        personaId: persona.personaId,
        rol: persona.rol,
        estado: persona.estado,
        tieneCorreo: Boolean(persona.email),
        unicoAdministrador: administradores.length === 1 && administradores[0].personaId === persona.personaId,
        sesionesAbiertas: await sesionesAbiertas(persona.personaId),
        empresasDelRut: new Set((await svc.getAllByRutGlobal(rut)).map((p) => p.tenantId)).size,
    };
}

async function restablecer({ tenantId, rut, motivo, actor }) {
    const { PersonaService } = require('../lib/services/PersonaService');
    const svc = new PersonaService();
    const persona = await svc.getByRut(tenantId, rut);
    if (!persona) throw new Error(`No hay una persona con el RUT ${rut} en la empresa ${tenantId}.`);
    return svc.restablecerContrasena(tenantId, persona.personaId, { motivo, actor, origen: { canal: 'operador' } });
}

module.exports = { ensayo, restablecer, sesionesAbiertas };

if (require.main === module) {
    const args = process.argv.slice(2);
    const valor = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
    const stage = valor('--stage');
    const tenantId = valor('--empresa');
    const rut = valor('--rut');
    const motivo = valor('--motivo');
    const confirmar = args.includes('--confirmar');
    const conocidos = new Set(['--stage', '--empresa', '--rut', '--motivo', '--confirmar']);
    const desconocido = args.find((a, i) => a.startsWith('--') && !conocidos.has(a) && !conocidos.has(args[i - 1]));
    if (!['dev', 'prod'].includes(stage) || !tenantId || !rut || !motivo || desconocido) {
        console.error(USO);
        process.exit(1);
    }
    process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
    const entorno = require('./entorno');
    entorno.cargarEntornoDe(stage);
    (async () => {
        const e = await ensayo({ tenantId, rut });
        console.log(`\n  Empresa:              ${e.empresa}`);
        console.log(`  Persona:              ${e.personaId} (${e.rol}, ${e.estado})`);
        console.log(`  Tiene correo:         ${e.tieneCorreo ? 'sí' : 'no'}`);
        console.log(`  Único administrador:  ${e.unicoAdministrador ? 'SÍ' : 'no'}`);
        console.log(`  Sesiones abiertas:    ${e.sesionesAbiertas} (se cierran todas)`);
        console.log(`  Empresas con su RUT:  ${e.empresasDelRut} (solo cambia la de esta empresa)`);
        if (!confirmar) {
            console.log('\n  Ensayo: no se escribió nada. Repite con --confirmar después de verificar la identidad de quien lo pide.\n');
            return;
        }
        const actor = { id: entorno.operadorActual(), tipo: 'operador', nombre: 'Soporte de Build & Serve' };
        const r = await restablecer({ tenantId, rut, motivo, actor });
        console.log('\n  Entrega esta contraseña temporal en persona o por teléfono, y bórrala de tu terminal:');
        console.log(`    Contraseña temporal: ${r.password}`);
        console.log(`    Vence:               ${r.vence}`);
        console.log(`  Sesiones cerradas:    ${r.sesionesCerradas ? 'sí' : 'NO: vuelve a correr el script o ciérralas con contencion.js'}`);
        console.log(`  Aviso por correo:     ${r.correo}\n`);
    })().catch((err) => {
        console.error(`\n  ${err.message}\n`);
        process.exit(1);
    });
}
