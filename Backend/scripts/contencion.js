#!/usr/bin/env node
/**
 * Contención de incidentes (plan de respuesta, docs/plan-respuesta-incidentes.md).
 * Lógica en lib/gobernanza/contencion.js; cada acción queda en la auditoría
 * con el operador que la ejecutó. Ninguna borra datos.
 *
 * Orden recomendado ante una cuenta comprometida:
 *   1. preservar   copia de la auditoría de la ventana, con su huella (ANTES de todo)
 *   2. suspender   o, si basta, revocar-sesiones
 *   3. informe     node scripts/informe-brecha.js --actor ... (qué pudo ver)
 *
 * Uso (desde Backend/, con AWS_PROFILE del ambiente):
 *   node scripts/contencion.js --stage prod --operador <usuario-iam> --motivo "INC-2026-004 ..." preservar --empresa <tenantId> [--desde ISO] [--hasta ISO] [--salida archivo.json]
 *   node scripts/contencion.js --stage prod --operador <usuario-iam> --motivo "..." revocar-sesiones --empresa <tenantId> --persona <personaId> [--persona ...]
 *   node scripts/contencion.js --stage prod --operador <usuario-iam> --motivo "..." suspender --empresa <tenantId> --persona <personaId>
 *   node scripts/contencion.js --stage prod --operador <usuario-iam> --motivo "..." reactivar --empresa <tenantId> --persona <personaId>
 *
 * El motivo no lleva datos personales: el número del incidente y una frase.
 */

const fs = require('fs');

const args = process.argv.slice(2);
const valores = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
const uno = (flag) => valores(flag)[0];
const accion = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

async function main() {
    const stage = uno('--stage');
    if (!['dev', 'prod'].includes(stage)) throw new Error('Falta --stage dev|prod');
    require('./entorno').cargarEntornoDe(stage);
    const C = require('../lib/gobernanza/contencion');
    const base = { tenantId: uno('--empresa'), operador: uno('--operador'), motivo: uno('--motivo') };
    if (!base.tenantId) throw new Error('Falta --empresa <tenantId>');

    let resultado;
    if (accion === 'preservar') {
        const r = await C.preservarEvidencia({ ...base, desde: uno('--desde'), hasta: uno('--hasta') });
        const salida = uno('--salida') || `evidencia-${base.tenantId}-${r.paquete.tomadoEl.replace(/[:.]/g, '')}.json`;
        // Solo lectura y escritura para quien la tomó: es evidencia con datos de la operación.
        fs.writeFileSync(salida, JSON.stringify(r.paquete, null, 2), { mode: 0o600 });
        resultado = { archivo: salida, eventos: r.paquete.eventos.length, sha256: r.huella, integridad: r.integridad };
    } else if (accion === 'revocar-sesiones') {
        resultado = await C.revocarSesiones({ ...base, personaIds: valores('--persona') });
    } else if (accion === 'suspender') {
        resultado = await C.suspenderCuenta({ ...base, personaId: uno('--persona') });
    } else if (accion === 'reactivar') {
        resultado = await C.reactivarCuenta({ ...base, personaId: uno('--persona') });
    } else {
        throw new Error('Acción desconocida. Usa: preservar | revocar-sesiones | suspender | reactivar');
    }
    console.log(`[contencion] ${accion} ${JSON.stringify(resultado)}`);
}

main().catch((err) => {
    console.error(`[contencion] ${err.message}`);
    process.exit(1);
});
