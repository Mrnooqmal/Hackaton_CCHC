// Los logs registran identificadores, nunca la carga útil.
//
// `IncidentsRepository.create` escribía el incidente completo en CloudWatch con
// `JSON.stringify(data)`: el RUT, el nombre y el género del trabajador y el
// relato del accidente, en claro — por fuera del cifrado que protege esos
// mismos datos en la tabla. Estas pruebas capturan TODO lo que se loguea al
// crear y actualizar un incidente y exigen que ninguno de esos datos aparezca.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { docClient } = require('../lib/clients/dynamodb');
const { IncidentsRepository } = require('../handlers/incidents-module/incidents.repository');

const RUT = '12.345.678-5';
const NOMBRE = 'Juana Pérez Soto';
const RELATO = 'Cayó del andamio al retirar el arnés';

let lineas;
let originales;

beforeEach(() => {
    lineas = [];
    originales = { log: console.log, info: console.info, warn: console.warn, error: console.error, send: docClient.send };
    for (const nivel of ['log', 'info', 'warn', 'error']) {
        console[nivel] = (...args) => lineas.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    }
    docClient.send = async (cmd) => {
        if (cmd.constructor.name === 'QueryCommand' || cmd.constructor.name === 'ScanCommand') return { Items: [] };
        if (cmd.constructor.name === 'GetCommand') return { Item: { incidentId: 'inc-1', tenantId: 't1' } };
        return { Attributes: {} };
    };
});

afterEach(() => {
    Object.assign(console, { log: originales.log, info: originales.info, warn: originales.warn, error: originales.error });
    docClient.send = originales.send;
});

/** El repositorio crea su PROPIO cliente de DynamoDB (no el compartido de
 *  `lib/clients`), así que se simula el de la instancia. */
const repositorio = () => {
    const repo = new IncidentsRepository();
    repo.dynamo = { send: docClient.send };
    return repo;
};

const sinDatosPersonales = () => {
    const todo = lineas.join('\n');
    for (const dato of [RUT, NOMBRE, RELATO, 'femenino']) {
        assert.ok(!todo.includes(dato), `"${dato}" apareció en los logs:\n${todo}`);
    }
};

test('crear un incidente no deja el RUT, el nombre ni el relato en los logs', async () => {
    await repositorio().create({
        tipo: 'accidente', descripcion: 'Caída', tenantId: 't1', obraId: 'o-1',
        trabajador: { nombre: NOMBRE, rut: RUT, genero: 'femenino', cargo: 'Maestra' },
        relatoAccidente: RELATO,
    }, {});
    assert.ok(lineas.some((l) => l.includes('[CREATE] incidente')), 'sí queda el identificador');
    sinDatosPersonales();
});

test('actualizar un incidente registra qué campos cambian, no sus valores', async () => {
    await repositorio().update('inc-1', {
        afectado: { nombreCompleto: NOMBRE, rut: RUT }, relatoAccidente: RELATO,
    }).catch(() => {});
    assert.ok(lineas.some((l) => l.includes('[UPDATE] incidente inc-1') && l.includes('afectado') && l.includes('relatoAccidente')));
    sinDatosPersonales();
});

// El mismo patrón en cualquier otro lado: un log que serializa una entidad o la
// carga de una petición. Los que quedan permitidos se nombran y se justifican.
test('ningún log serializa una entidad o una carga completa', () => {
    const RAIZ = path.join(__dirname, '..');
    const PERMITIDOS = [
        // Conteos del scheduler: `{ grupos, avisos }`, `{ organos, faltantes }`.
        /\[revision-documental\]', JSON\.stringify\(resumen\)/,
        /\[estructura-alertas\]', JSON\.stringify\(resumen\)/,
        // Conteos de la retención diaria: `{ empresas, conAcciones, bloqueosExtendidos, fallidas }`.
        /\[retencion-diaria\]', JSON\.stringify\(resultado\)/,
        // Ruta, método y parámetros de la consulta del buzón (identificadores).
        /Inbox Handler Event:', JSON\.stringify\(\{/,
        // Métricas embebidas (EMF): se arman campo a campo en `degradacion` y `limitePin`.
        /JSON\.stringify\(linea\)/,
    ];
    const archivos = [];
    const recorrer = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (['node_modules', 'tests', '.serverless', 'scripts'].includes(e.name)) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) recorrer(p); else if (e.name.endsWith('.js')) archivos.push(p);
        }
    };
    recorrer(RAIZ);
    const infractores = [];
    for (const archivo of archivos) {
        fs.readFileSync(archivo, 'utf8').split('\n').forEach((linea, i) => {
            if (/console\.(log|info|warn|error|debug)\(.*JSON\.stringify\(/.test(linea) && !PERMITIDOS.some((r) => r.test(linea))) {
                infractores.push(`${path.relative(RAIZ, archivo)}:${i + 1}  ${linea.trim()}`);
            }
        });
    }
    assert.deepEqual(infractores, []);
});
