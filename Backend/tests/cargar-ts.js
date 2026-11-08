// Carga módulos TypeScript del frontend en las pruebas, transpilados con el
// TypeScript del propio frontend, incluidas sus importaciones relativas
// (`import … from './valesCifrados'`). Sin esto, un módulo que importa otro
// `.ts` no se puede probar.
//
// Cada `cargarTs` entrega una copia fresca: las pruebas no comparten estado de
// módulo entre sí.

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const FRONTEND = path.join(__dirname, '..', '..', 'Frontend');
let ts;
try { ts = require(path.join(FRONTEND, 'node_modules', 'typescript')); } catch { ts = null; }

if (ts && !Module._extensions['.ts']) {
    Module._extensions['.ts'] = (m, archivo) => {
        const { outputText } = ts.transpileModule(fs.readFileSync(archivo, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        });
        m._compile(outputText, archivo);
    };
}

/** `cargarTs('utils', 'colaFirmas.ts')` o `cargarTs('colaFirmas.ts')` (en src/utils). */
function cargarTs(...partes) {
    assert.ok(ts, 'Falta Frontend/node_modules/typescript: corre `npm ci` en Frontend. Esta prueba no se salta.');
    const archivo = partes.length === 1
        ? path.join(FRONTEND, 'src', 'utils', partes[0])
        : path.join(FRONTEND, 'src', ...partes);
    for (const k of Object.keys(require.cache)) {
        if (k.startsWith(path.join(FRONTEND, 'src'))) delete require.cache[k];
    }
    return require(archivo);
}

module.exports = { cargarTs, FRONTEND };
