// Los scripts de operación que envían correo toman el entorno de la Lambda del
// ambiente (scripts/entorno.js): armarlo a mano se desfasó del sistema (D-21).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'scripts');

test('todo script que envía correo carga el entorno de la Lambda, y ninguno fija el remitente', () => {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'entorno.js')) {
        const s = fs.readFileSync(path.join(dir, f), 'utf8');
        if (/notifications\/handler|lib\/correo/.test(s)) {
            assert.match(s, /cargarEntornoDe\(stage\)/, `${f} envía correo sin el entorno de la Lambda`);
        }
        assert.ok(!/SES_SENDER_EMAIL\s*=/.test(s), `${f} fija el remitente a mano`);
    }
});
