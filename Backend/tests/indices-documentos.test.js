// Los índices de Documents, SignatureRequests y Signatures se quedan en
// `ProjectionType: ALL` (D-23). La decisión se sostiene en una condición que
// esta prueba vigila: ningún rol puede leer esos índices sin poder leer la
// tabla. Si algún día un rol tuviera acceso solo al índice, la copia completa
// dejaría de ser inocua y esta prueba falla para que se revise.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const YML = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');
const TABLAS = ['DocumentsTable', 'SignatureRequestsTable', 'SignaturesTable'];

/** Bloques `- Effect: Allow` con sus recursos (una línea `- ...` por recurso). */
function statements() {
    const lineas = YML.split('\n');
    const res = [];
    for (let i = 0; i < lineas.length; i++) {
        const m = /^(\s*)- Effect: Allow\s*$/.exec(lineas[i]);
        if (!m) continue;
        const recursos = [];
        for (let j = i + 1; j < lineas.length; j++) {
            const l = lineas[j];
            if (l.trim() === '' || l.trim().startsWith('#')) continue;
            if (l.length - l.trimStart().length <= m[1].length) break;
            const t = l.trim();
            const r = /^Resource:\s*(\S.*)$/.exec(t);
            if (r) recursos.push(r[1]);
            else if (t.startsWith('- ')) recursos.push(t.slice(2));
        }
        res.push({ linea: i + 1, recursos });
    }
    return res;
}

const comodinIndice = /table\/\$\{self:service\}-\*-\$\{self:provider\.stage\}\/index\/\*/;
const comodinTabla = /table\/\$\{self:service\}-\*-\$\{self:provider\.stage\}'?$/;

test('las tres tablas siguen con índices ALL (lo que D-23 decide)', () => {
    for (const t of TABLAS) {
        const i = YML.indexOf(`    ${t}:\n`);
        const bloque = YML.slice(i, YML.indexOf('\n    ', YML.indexOf('GlobalSecondaryIndexes', i) + 600));
        assert.match(bloque, /ProjectionType: ALL/, t);
    }
});

test('quien puede leer un índice de esas tablas puede leer la tabla: el índice no amplía el acceso', () => {
    const malos = [];
    for (const st of statements()) {
        for (const t of TABLAS) {
            const alIndice = st.recursos.some((r) => r.includes(`${t}.Arn}/index`) || comodinIndice.test(r));
            if (!alIndice) continue;
            const aLaTabla = st.recursos.some((r) => new RegExp(`GetAtt ${t}\\.Arn\\s*$`).test(r) || comodinTabla.test(r));
            if (!aLaTabla) malos.push(`línea ${st.linea}: índice de ${t} sin la tabla`);
        }
    }
    assert.deepEqual(malos, []);
});
