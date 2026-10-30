// Resguardo de salud en el Expediente consolidado (H-15, Arts. 67-68, Ley 21.719).
//
// El expediente se entrega a fiscalizadores y al Organismo Administrador, así que
// no se bloquea entero: los CONTEOS son estadística y deben ir siempre. Lo que no
// puede salir sin el permiso de vigilancia es el detalle por persona identificable
// (protocolos y aptitud laboral). Se prueba la REGLA, que es donde un error se
// paga con una filtración de datos sensibles y no con un error en pantalla.

const test = require('node:test');
const assert = require('node:assert');

const { RegistroService } = require('../lib/services/RegistroService');

const CONSOLIDADO = {
    tenantId: 't1',
    obraId: 'o1',
    periodo: {},
    generadoEn: '2026-10-14T00:00:00.000Z',
    indicadores: {},
    incidentes: [],
    actividadesPreventivas: [],
    actividadesPorTipo: {},
    entregasEpp: [],
    documentos: [],
    miper: { presente: false },
    vigilanciaSalud: {
        enVigilancia: 2,
        totalActivos: 40,
        personas: [
            { personaId: 'p-ana', nombre: 'Ana Pérez', protocolos: ['PLANESI'], aptitudLaboral: 'apto con restricción' },
            { personaId: 'p-luis', nombre: 'Luis Soto', protocolos: ['Sílice'], aptitudLaboral: 'no apto' },
        ],
    },
    totales: {},
};

/** Servicio con la consolidación simulada: la regla a probar es el filtro, no la lectura. */
const servicio = () => {
    const s = new RegistroService();
    s.construirSnapshotConsolidado = async () => JSON.parse(JSON.stringify(CONSOLIDADO));
    return s;
};
const generar = (opciones = {}) =>
    servicio().generarExpediente({ tenantId: 't1', obraId: 'o1', ...opciones });

test('sin el permiso de vigilancia, el detalle por persona no sale', async () => {
    const { datos, html } = await generar({ incluirDetalleSalud: false });
    assert.deepEqual(datos.vigilanciaSalud.personas, []);
    assert.equal(datos.vigilanciaSalud.detalleOmitido, true);
    assert.ok(!html.includes('Ana Pérez'), 'el nombre no puede aparecer en el HTML');
    assert.ok(!html.includes('no apto'), 'la aptitud laboral no puede aparecer en el HTML');
    assert.ok(!html.includes('Sílice'), 'el protocolo no puede aparecer en el HTML');
});

test('por omisión se oculta: si una pantalla olvida pedir el permiso, no se filtra', async () => {
    // Fail-closed a propósito, igual que puedeVerSalud en lib/documentos-salud.js.
    const { datos, detalleSaludIncluido } = await generar();
    assert.deepEqual(datos.vigilanciaSalud.personas, []);
    assert.equal(detalleSaludIncluido, false);
});

test('los conteos sí van siempre: son estadística y el fiscalizador los necesita', async () => {
    const { datos, html } = await generar({ incluirDetalleSalud: false });
    assert.equal(datos.vigilanciaSalud.enVigilancia, 2);
    assert.equal(datos.vigilanciaSalud.totalActivos, 40);
    assert.ok(html.includes('Vigilancia de la salud (2 de 40)'));
});

test('la omisión se declara en el documento, no se simula que no hay nadie', async () => {
    // Un expediente que oculta lo faltante es peor que uno que lo declara: el
    // fiscalizador tiene que saber que esa información existe.
    const { html } = await generar({ incluirDetalleSalud: false });
    assert.ok(html.includes('no se incluye en esta copia'));
    assert.ok(!html.includes('Sin personas en vigilancia'), 'no puede dar a entender que no hay nadie');
});

test('con el permiso, el detalle va y se devuelven los titulares para auditar', async () => {
    const { datos, html, titularesSalud, detalleSaludIncluido } = await generar({ incluirDetalleSalud: true });
    assert.equal(datos.vigilanciaSalud.personas.length, 2);
    assert.equal(detalleSaludIncluido, true);
    assert.deepEqual(titularesSalud, ['p-ana', 'p-luis']);
    assert.ok(html.includes('Ana Pérez'));
});

test('los titulares se devuelven aunque el detalle se omita: el filtro no borra a quién afecta', async () => {
    // Si se omite no se audita (no se entregó nada), pero la lista no puede
    // quedar vacía por el filtro: eso enmascararía a quién cubre el expediente.
    const { titularesSalud } = await generar({ incluirDetalleSalud: false });
    assert.deepEqual(titularesSalud, ['p-ana', 'p-luis']);
});
