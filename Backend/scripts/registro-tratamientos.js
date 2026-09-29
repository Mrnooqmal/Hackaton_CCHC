#!/usr/bin/env node
/**
 * Genera el registro de tratamientos (Ley 21.719) desde el inventario de datos
 * (`lib/gobernanza/inventario.js`), en Markdown, para pegarlo en
 * docs/gobernanza-y-seguridad-de-datos.md. Así el registro y el proceso de
 * retención leen la misma fuente y no pueden divergir.
 *
 *   node scripts/registro-tratamientos.js
 */

const { FUENTES, AL_VENCER } = require('../lib/gobernanza/inventario');

const QUE_PASA = {
    [AL_VENCER.SUPRIMIR]: 'Se suprime',
    [AL_VENCER.ANONIMIZAR]: 'Se anonimiza (se conserva el hecho para los indicadores)',
    [AL_VENCER.GRUPAL]: 'Se conserva completo hasta que vence el plazo del último involucrado; después se suprime',
    [AL_VENCER.EMPRESA]: 'No vence por personas (es de la empresa)',
    [AL_VENCER.TTL]: 'Vence solo (uso o fecha de expiración)',
};
const PLAZO = { evidencia: '5 años desde el término del vínculo', conveniencia: 'Hasta que la persona pida suprimirlo, o con la ficha', operacional: 'Mientras sirve (horas o días)' };
const celda = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

console.log('| Categoría | Datos | Finalidad | Clase | Plazo | Al vencer |');
console.log('|---|---|---|---|---|---|');
for (const f of FUENTES) {
    const extra = f.camposConveniencia ? ` Suprimibles a solicitud sin esperar el plazo: ${f.camposConveniencia.join(', ')}.` : '';
    console.log(`| ${celda(f.nombre)} | ${celda(f.datos + extra)} | ${celda(f.finalidad)} | ${f.clase} | ${PLAZO[f.clase]} | ${QUE_PASA[f.alVencer]} |`);
}
