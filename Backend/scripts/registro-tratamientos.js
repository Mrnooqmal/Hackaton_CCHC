#!/usr/bin/env node
/**
 * Genera el registro de tratamientos (Ley 21.719) desde el inventario de datos
 * (`lib/gobernanza/inventario.js`), en Markdown, para pegarlo en
 * docs/gobernanza-y-seguridad-de-datos.md. Así el registro y el proceso de
 * retención leen la misma fuente y no pueden divergir.
 *
 *   node scripts/registro-tratamientos.js
 */

const { FUENTES } = require('../lib/gobernanza/inventario');
// Los mismos textos que ve el titular en su aviso de privacidad.
const { PLAZO, QUE_PASA } = require('../lib/gobernanza/aviso');
const celda = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

console.log('| Categoría | Datos | Finalidad | Clase | Plazo | Al vencer |');
console.log('|---|---|---|---|---|---|');
for (const f of FUENTES) {
    const extra = f.camposConveniencia ? ` Suprimibles a solicitud sin esperar el plazo: ${f.camposConveniencia.join(', ')}.` : '';
    console.log(`| ${celda(f.nombre)} | ${celda(f.datos + extra)} | ${celda(f.finalidad)} | ${f.clase} | ${PLAZO[f.clase]} | ${QUE_PASA[f.alVencer]} |`);
}
