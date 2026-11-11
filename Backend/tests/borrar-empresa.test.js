// Borrado de una empresa entera por el operador (scripts/borrar-empresa.js):
// las salvaguardas que impiden borrar de más.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { empresaAjena, huellaDe } = require('../scripts/borrar-empresa');

const T = 'a5ffc38d-44b7-47f0-bb15-58f37f9f2b4c';
const OTRA = '462b6bc5-8c19-49d8-bc36-949a158b9cf3';

test('un elemento que declara otra empresa se detecta (por tenantId o por clave TENANT#)', () => {
    assert.equal(empresaAjena(marshall({ tenantId: T, x: 1 }), T), null);
    assert.equal(empresaAjena(marshall({ PK: `TENANT#${T}`, SK: 'PERSONA#p' }), T), null);
    assert.equal(empresaAjena(marshall({ tenantId: OTRA, menciona: T }), T), OTRA);
    assert.equal(empresaAjena(marshall({ PK: `TENANT#${OTRA}`, SK: `PERSONA#${T}` }), T), OTRA);
    assert.equal(empresaAjena(marshall({ sinEmpresa: true }), T), null, 'sin empresa declarada no es ajeno (p. ej. la traza de una firma)');
});

test('la huella cambia si cambia cualquier elemento o archivo, y no depende del orden', () => {
    const e = (sk) => ({ tabla: 'BuildAndServe-gobernanza-prod', clave: marshall({ tenantId: T, sk }) });
    const base = { elementos: [e('PLAN#1'), e('PLAN#2')], archivos: [{ bucket: 'b', Key: 'k', VersionId: 'v1' }] };
    const h = huellaDe(base);
    assert.equal(huellaDe({ elementos: [e('PLAN#2'), e('PLAN#1')], archivos: base.archivos }), h);
    assert.notEqual(huellaDe({ ...base, elementos: [...base.elementos, e('PLAN#3')] }), h, 'un plan nuevo de la retención cambia la huella');
    assert.notEqual(huellaDe({ ...base, archivos: [{ bucket: 'b', Key: 'k', VersionId: 'v2' }] }), h);
});

test('el script: ensaya por omisión, exige el nombre exacto y la huella para borrar, y se detiene ante algo ajeno', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'borrar-empresa.js'), 'utf8');
    assert.match(s, /if \(nombreReal !== nombre\)[^\n]*No se borra nada/);
    assert.match(s, /if \(!a\.ejecutar\) \{[\s\S]*?return;/);
    assert.match(s, /if \(a\.ejecutar !== huella\)[\s\S]*?process\.exit\(1\)/);
    const i = s.indexOf('if (hallado.ajenos.length)');
    assert.ok(i > 0 && i < s.indexOf('new DeleteItemCommand({ TableName: e.tabla'), 'lo ajeno corta antes de borrar');
});

test('la limpieza de hackatonbackend: ensayo por omisión, cuentas comprobadas, prefijos fijos', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', '..', 'infra', 'limpiar-hackatonbackend.sh'), 'utf8');
    assert.match(s, /\[ "\$\{1:-\}" = "--ejecutar" \] && EJECUTAR=true/);
    const salida = s.indexOf('if ! $EJECUTAR; then');
    assert.ok(salida > 0 && salida < s.indexOf('echo; echo "== Borrando"'), 'el ensayo sale antes de borrar');
    assert.ok(salida < s.indexOf('aws cloudformation delete-stack'), 'y antes de borrar el stack');
    assert.ok(s.indexOf('comprobar_cuenta "$PERFIL_OTRA" "$CUENTA_OTRA"') < s.indexOf('== Borrando'));
    assert.match(s, /PREFIJOS_BAS=\("serverless\/hackatonbackendv2\/" "serverless\/hackatonbackendv2-testeo\/"\)/);
    assert.match(s, /PREFIJOS_OTRA=\("serverless\/hackatonbackendv2-testeo\/" "serverless\/HackatonBackend\/"\)/);
    assert.ok(!/BuildAndServe\//.test(s), 'nunca el prefijo de Build & Serve');
});
