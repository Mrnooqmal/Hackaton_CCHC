// El historial de gobernanza solo crece: ningún rol puede actualizarlo ni borrarlo.
//
// Es la evidencia de que la empresa cumplió con el titular (solicitud, bloqueo,
// prórroga, respuesta, supresión), y lo primero que se revisa en una
// fiscalización. La garantía está en los permisos IAM de serverless.yml, no en
// la disciplina del código: esta prueba falla si algún statement le da a una
// función algo más que agregar y leer.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const YML = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');

/** Statements `- Effect: …` con sus acciones y recursos (lector acotado a este formato). */
function statements() {
    const lineas = YML.split('\n');
    const res = [];
    for (let i = 0; i < lineas.length; i++) {
        const m = /^(\s*)- Effect: (Allow|Deny)\s*$/.exec(lineas[i]);
        if (!m) continue;
        const sangria = m[1].length;
        const st = { efecto: m[2], acciones: [], recursos: [], linea: i + 1 };
        let campo = null;
        for (let j = i + 1; j < lineas.length; j++) {
            const l = lineas[j];
            if (l.trim() === '' || l.trim().startsWith('#')) continue;
            const s = l.length - l.trimStart().length;
            if (s <= sangria) break;
            const t = l.trim();
            let mm;
            if ((mm = /^Action:\s*\[(.*)\]\s*$/.exec(t))) { st.acciones.push(...mm[1].split(',').map((x) => x.trim())); campo = null; continue; }
            if ((mm = /^Action:\s*(\S+)\s*$/.exec(t))) { st.acciones.push(mm[1].replace(/['"]/g, '')); campo = null; continue; }
            if (/^Action:\s*$/.test(t)) { campo = 'acciones'; continue; }
            if ((mm = /^Resource:\s*(\S.*)$/.exec(t))) { st.recursos.push(mm[1]); campo = null; continue; }
            if (/^Resource:\s*$/.test(t)) { campo = 'recursos'; continue; }
            if (/^[A-Za-z]+:/.test(t)) { campo = null; continue; }
            if (campo && t.startsWith('- ')) st[campo].push(t.slice(2).trim().replace(/^['"]|['"]$/g, ''));
        }
        res.push(st);
    }
    return res;
}

const tocaHistorial = (st) => st.recursos.some((r) => /GobernanzaHistorialTable|gobernanza-historial/.test(r)
    || /table\/\$\{self:service\}-\*/.test(r));
const escribe = (a) => !/^dynamodb:(Query|GetItem|BatchGetItem|Scan|DescribeTable)$/.test(a);

test('se encontraron los statements de IAM (el lector funciona)', () => {
    const sts = statements();
    assert.ok(sts.length > 10);
    assert.ok(sts.some((s) => s.recursos.some((r) => r.includes('GobernanzaHistorialTable'))));
});

test('sobre el historial, ningún statement permite más que agregar y leer', () => {
    const malos = statements().filter((s) => s.efecto === 'Allow' && tocaHistorial(s))
        .flatMap((s) => s.acciones.filter((a) => escribe(a) && a !== 'dynamodb:PutItem').map((a) => `línea ${s.linea}: ${a}`));
    assert.deepEqual(malos, [], 'el historial solo crece: sin UpdateItem, DeleteItem, BatchWriteItem ni comodines');
});

test('ningún comodín de tablas (dynamodb:* o table/*) alcanza al historial con escritura', () => {
    const malos = statements().filter((s) => s.efecto === 'Allow' && s.acciones.some((a) => a === 'dynamodb:*' || a === '*')
        && (tocaHistorial(s) || s.recursos.some((r) => r === "'*'" || r === '*')));
    assert.deepEqual(malos.map((s) => s.linea), []);
});

test('las solicitudes y los planes no se pueden borrar', () => {
    const malos = statements().filter((s) => s.efecto === 'Allow'
        && s.recursos.some((r) => /GobernanzaTable\b/.test(r) && !/Historial/.test(r))
        && s.acciones.some((a) => /DeleteItem|BatchWriteItem|dynamodb:\*/.test(a)));
    assert.deepEqual(malos.map((s) => s.linea), []);
});

test('el historial se conserva aunque se borre el stack, en todo ambiente', () => {
    const bloque = YML.slice(YML.indexOf('    GobernanzaHistorialTable:'), YML.indexOf('    GobernanzaHistorialTable:') + 400);
    assert.match(bloque, /DeletionPolicy: Retain/);
    assert.match(bloque, /UpdateReplacePolicy: Retain/);
});

test('borrar versiones de S3 con bypass de la retención solo lo puede RolSupresion', () => {
    const inicio = YML.indexOf('    RolSupresion:');
    assert.ok(inicio > 0, 'existe RolSupresion');
    const resto = YML.slice(inicio + 10);
    const fin = inicio + 10 + resto.search(/\n {4}[A-Za-z]+:\n {6}Type:/);
    const lineaDe = (i) => YML.slice(0, i).split('\n').length;
    const [desde, hasta] = [lineaDe(inicio), lineaDe(fin)];
    const peligrosos = statements().filter((s) => s.efecto === 'Allow'
        && s.acciones.some((a) => /BypassGovernanceRetention|DeleteObjectVersion|s3:\*/.test(a)));
    assert.ok(peligrosos.length >= 1);
    for (const s of peligrosos) assert.ok(s.linea > desde && s.linea < hasta, `línea ${s.linea}: permiso de borrado con bypass fuera de RolSupresion`);
});

test('RolSupresion lo usa una sola función: la de lotes', () => {
    const usos = YML.split('\n').filter((l) => /^\s+role: RolSupresion\s*$/.test(l));
    assert.equal(usos.length, 1);
});
