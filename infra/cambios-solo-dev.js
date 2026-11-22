#!/usr/bin/env node
const fs = require('fs');

const RECURSOS_DEV = new Set(['DistribucionDev', 'CabecerasSeguridadDev', 'RedireccionDev', 'BucketFrontendDev', 'PoliticaBucketFrontendDev']);

function revisar(changeSet) {
    const cambios = (changeSet.Changes || []).map((c) => c.ResourceChange || {}).map((r) => ({
        accion: r.Action, recurso: r.LogicalResourceId, tipo: r.ResourceType, reemplazo: r.Replacement || '-',
        alcance: (r.Scope || []).join(','),
    }));
    const ajenos = cambios.filter((c) => !RECURSOS_DEV.has(c.recurso));
    return { cambios, ajenos, ok: ajenos.length === 0 };
}

if (require.main === module) {
    const { cambios, ajenos, ok } = revisar(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
    console.log('   acción   recurso                       tipo                                   reemplazo  alcance');
    for (const c of cambios) {
        console.log(`   ${String(c.accion).padEnd(8)} ${String(c.recurso).padEnd(29)} ${String(c.tipo).padEnd(38)} ${String(c.reemplazo).padEnd(10)} ${c.alcance}`);
    }
    if (!cambios.length) console.log('   (sin cambios)');
    if (!ok) {
        console.error(`\n   ALTO: el change set toca recursos que no son de dev: ${ajenos.map((c) => c.recurso).join(', ')}`);
        process.exit(1);
    }
}

module.exports = { revisar, RECURSOS_DEV };
