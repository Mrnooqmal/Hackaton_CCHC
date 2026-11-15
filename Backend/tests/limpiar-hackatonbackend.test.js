// infra/limpiar-hackatonbackend.sh con un `aws` simulado.
//
// 15 de noviembre de 2026: `--ejecutar` se cortó justo después del primer lote
// con un JSONDecodeError. Con "Quiet": true y sin errores, `delete-objects`
// responde vacío y el CLI no imprime nada; el script hacía `json.load` de esa
// salida vacía. El lote sí se había borrado (serverless/hackatonbackendv2/ quedó
// vacío) y lo demás seguía ahí. El `aws` simulado responde vacío igual que el
// real, y la cuenta 789925699187 tiene objetos de OTROS proyectos que no se tocan.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'infra', 'limpiar-hackatonbackend.sh');
const BAS = 'serverless-framework-deployments-us-east-1-e30a0f06-a273';
const OTRA = 'serverless-framework-deployments-us-east-1-7653a9c0-a5fa';

// El `aws` simulado: lee y guarda su estado en $AWS_SIMULADO.
const SIMULADOR = String.raw`#!/usr/bin/env node
const fs = require('fs');
const ruta = process.env.AWS_SIMULADO;
const e = JSON.parse(fs.readFileSync(ruta, 'utf8'));
const a = process.argv.slice(2);
const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const perfil = process.env.AWS_PROFILE || 'default';
e.llamadas.push({ perfil, args: a });
const guardar = () => fs.writeFileSync(ruta, JSON.stringify(e));
const fin = (salida, codigo = 0) => { guardar(); if (salida !== undefined) process.stdout.write(salida); process.exit(codigo); };
const [svc, cmd] = a;
if (svc === 'sts') fin((e.cuentas[perfil] || '000') + '\n');
if (svc === 's3api' && cmd === 'list-object-versions') {
    const b = e.buckets[opt('--bucket')] || [], pre = opt('--prefix');
    const sel = b.filter((x) => x.Key.startsWith(pre));
    if (sel.length === 0) fin('');   // como el CLI cuando no hay nada
    fin(JSON.stringify({
        Versions: sel.filter((x) => !x.marca).map(({ Key, VersionId, Size }) => ({ Key, VersionId, Size })),
        DeleteMarkers: sel.filter((x) => x.marca).map(({ Key, VersionId }) => ({ Key, VersionId })),
    }));
}
if (svc === 's3api' && cmd === 'delete-objects') {
    const bucket = opt('--bucket'), lote = JSON.parse(opt('--delete'));
    e.lotes.push(lote.Objects.length);
    if (e.erroresEn === bucket) fin(JSON.stringify({ Errors: [{ Key: lote.Objects[0].Key, Code: 'AccessDenied', Message: 'Access Denied' }] }));
    if (e.noBorraEn === bucket) fin('');   // responde como si hubiera borrado, y no borra
    const quitar = new Set(lote.Objects.map((o) => o.Key + '#' + o.VersionId));
    e.buckets[bucket] = e.buckets[bucket].filter((x) => !quitar.has(x.Key + '#' + x.VersionId));
    fin('');   // "Quiet": true y sin errores → el CLI no imprime nada
}
if (svc === 's3api' && cmd === 'head-bucket') fin(undefined, 254);
if (svc === 'cloudformation' && cmd === 'describe-stacks') fin(e.stack + '\n');
if (svc === 'cloudformation' && cmd === 'list-stack-resources') fin('DocumentsBucket\tIncidentEvidenceBucket\n');
if (svc === 'cloudformation' && cmd === 'delete-stack') { e.stack = 'DELETE_COMPLETE'; e.stackBorrado = a; fin(''); }
if (svc === 'cloudformation' && cmd === 'wait') fin('');
if (svc === 'lambda') fin('0\n');
fin('comando no simulado: ' + a.join(' '), 2);
`;

const objetos = (prefijo, n, { marcas = 0 } = {}) => [
    ...Array.from({ length: n }, (_, i) => ({ Key: `${prefijo}1700000000${i}/s.zip`, VersionId: `v${i}`, Size: 1048576 })),
    ...Array.from({ length: marcas }, (_, i) => ({ Key: `${prefijo}1700000000${i}/m.json`, VersionId: `m${i}`, marca: true })),
];

function preparar({ cuentas, erroresEn, noBorraEn, yaBorradoElPrimero = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'limpiar-hb-'));
    fs.writeFileSync(path.join(dir, 'aws'), SIMULADOR, { mode: 0o755 });
    const ajenos = [
        ...objetos('serverless/soytrabajador/dev/', 3),
        ...objetos('serverless/gruposoy/dev/', 2, { marcas: 1 }),
        ...objetos('serverless/HackatonBackendNuevo/dev/', 1),   // parecido, pero otro prefijo
    ];
    const estado = {
        cuentas: cuentas || { adrean_cchc: '772706200162', default: '789925699187' },
        buckets: {
            [BAS]: [
                ...(yaBorradoElPrimero ? [] : objetos('serverless/hackatonbackendv2/dev/', 1500, { marcas: 40 })),
                ...objetos('serverless/hackatonbackendv2-testeo/dev/', 36, { marcas: 21 }),
                ...objetos('serverless/BuildAndServe/dev/', 4),
            ],
            [OTRA]: [
                ...objetos('serverless/hackatonbackendv2-testeo/dev/', 3),
                ...objetos('serverless/HackatonBackend/dev/', 0, { marcas: 6 }),
                ...ajenos,
            ],
        },
        stack: 'DELETE_FAILED', llamadas: [], lotes: [], erroresEn, noBorraEn,
    };
    const archivo = path.join(dir, 'estado.json');
    fs.writeFileSync(archivo, JSON.stringify(estado));
    const correr = (...args) => new Promise((resolve) => {
        execFile('bash', [SCRIPT, ...args], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, AWS_SIMULADO: archivo } },
            (err, stdout, stderr) => resolve({ codigo: err ? err.code : 0, stdout, stderr, estado: JSON.parse(fs.readFileSync(archivo, 'utf8')) }));
    });
    return { correr, ajenos };
}

const quedan = (estado, bucket, pre) => estado.buckets[bucket].filter((x) => x.Key.startsWith(pre)).length;

test('--ejecutar termina aunque delete-objects responda vacío, borra todo lo de los cuatro prefijos y nada más', async () => {
    const { correr, ajenos } = preparar();
    const r = await correr('--ejecutar');
    assert.equal(r.codigo, 0, r.stderr + r.stdout);
    assert.doesNotMatch(r.stderr, /JSONDecodeError|Traceback/);
    for (const [b, p] of [[BAS, 'serverless/hackatonbackendv2/'], [BAS, 'serverless/hackatonbackendv2-testeo/'],
        [OTRA, 'serverless/hackatonbackendv2-testeo/'], [OTRA, 'serverless/HackatonBackend/']]) {
        assert.equal(quedan(r.estado, b, p), 0, `${b}/${p}`);
    }
    assert.equal(quedan(r.estado, BAS, 'serverless/BuildAndServe/'), 4, 'lo de Build & Serve no se toca');
    assert.deepEqual(r.estado.buckets[OTRA], ajenos, 'lo de los otros proyectos no se toca');
    assert.ok(r.estado.lotes.every((n) => n <= 1000) && r.estado.lotes.includes(1000), 'en lotes de a lo más 1000');
    assert.equal(r.estado.stack, 'DELETE_COMPLETE');
    assert.deepEqual(r.estado.stackBorrado.slice(r.estado.stackBorrado.indexOf('--retain-resources') + 1), ['DocumentsBucket', 'IncidentEvidenceBucket']);
    assert.match(r.stdout, /serverless\/hackatonbackendv2\/: 1540 borrados/);
    assert.match(r.stdout, /Listo: no queda nada bajo esos prefijos\./);
});

test('se puede repetir donde quedó la ejecución cortada (el primer prefijo ya vacío)', async () => {
    const { correr, ajenos } = preparar({ yaBorradoElPrimero: true });
    const ensayo = await correr();
    assert.equal(ensayo.codigo, 0, ensayo.stderr);
    assert.match(ensayo.stdout, /serverless\/hackatonbackendv2\/: 0 versiones \(0\.0 MB\) y 0 marcas/);
    assert.match(ensayo.stdout, /serverless\/hackatonbackendv2-testeo\/: 36 versiones \(36\.0 MB\) y 21 marcas/);
    const r = await correr('--ejecutar');
    assert.equal(r.codigo, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /serverless\/hackatonbackendv2\/: 0 borrados/);
    assert.deepEqual(r.estado.buckets[OTRA], ajenos);
    assert.match(r.stdout, /Listo/);
});

test('el ensayo no borra nada', async () => {
    const { correr } = preparar();
    const r = await correr();
    assert.equal(r.codigo, 0, r.stderr);
    assert.equal(r.estado.lotes.length, 0);
    assert.equal(r.estado.stack, 'DELETE_FAILED');
    assert.ok(!r.estado.llamadas.some((l) => ['delete-objects', 'delete-stack'].includes(l.args[1])));
});

test('si un lote vuelve con errores se detiene con el detalle, sin seguir ni borrar el stack', async () => {
    const { correr } = preparar({ erroresEn: OTRA });
    const r = await correr('--ejecutar');
    assert.notEqual(r.codigo, 0);
    assert.match(r.stderr, /AccessDenied/);
    assert.match(r.stderr, /el borrado devolvió errores; se detiene/);
    assert.equal(r.estado.stack, 'DELETE_FAILED', 'el stack no se toca');
    assert.ok(r.estado.buckets[OTRA].length > 0);
});

test('con un perfil de otra cuenta no hace nada', async () => {
    const { correr } = preparar({ cuentas: { adrean_cchc: '772706200162', default: '111111111111' } });
    const r = await correr('--ejecutar');
    assert.notEqual(r.codigo, 0);
    assert.match(r.stderr, /El perfil default es de la cuenta 111111111111, no de 789925699187/);
    assert.ok(!r.estado.llamadas.some((l) => l.args[0] === 's3api'), 'ni siquiera lista');
});

test('si después de borrar algo sigue ahí, la verificación lo dice y sale con error', async () => {
    const { correr } = preparar({ noBorraEn: OTRA });
    const r = await correr('--ejecutar');
    assert.notEqual(r.codigo, 0);
    assert.match(r.stderr, /Quedan 9 versiones o marcas: revisar\./);
    assert.doesNotMatch(r.stdout, /Listo/);
});
