// Recorridos iniciales (Fase 5) contra los permisos por defecto de cada rol.
//
// Se lanza un solo recorrido automático por sesión, así que las introducciones
// de Inicio se reparten por permiso: cada rol, en cada ámbito, calza con una
// sola (o con ninguna). Si alguien cambia los permisos por defecto de un rol
// (lib/permissions.js) o el `visibleSi` de una introducción, y dos empiezan a
// competir, esta prueba falla. Corre con el backend porque los presets viven
// acá; las definiciones son las del frontend (Node 24 importa el .ts).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const { DEFAULT_ROLE_PRESETS, ALL_PERMISSION_KEYS } = require('../lib/permissions');

const AYUDA = path.join(__dirname, '..', '..', 'Frontend', 'src', 'ayuda');
const importar = (archivo) => import(pathToFileURL(path.join(AYUDA, archivo)).href);

/** Lo que vería cada rol si los recorridos estuvieran publicados. */
async function cargar() {
    const { RECORRIDOS } = await importar('recorridos.ts');
    const { colaAutomatica, deLaPantalla } = await importar('reglas.ts');
    const publicados = RECORRIDOS.map((d) => ({ ...d, estado: 'publicado' }));
    return { publicados, colaAutomatica, deLaPantalla };
}

const persona = (rol, ambito) => {
    const permisos = rol === 'admin' ? ALL_PERMISSION_KEYS : DEFAULT_ROLE_PRESETS[rol];
    return { tienePermiso: (p) => permisos.includes(p), ambito };
};

const HOY = '2026-11-07';
const sinProgreso = new Map();
const introDe = async (rol, ambito) => {
    const { publicados, colaAutomatica } = await cargar();
    return colaAutomatica(publicados, 'inicio', sinProgreso, persona(rol, ambito), HOY)
        .filter((d) => d.id.startsWith('inicio-')).map((d) => d.id);
};

test('cada rol, en cada ámbito, calza con una sola introducción de Inicio', async () => {
    const esperado = {
        trabajador: { obra: ['inicio-terreno'], empresa: ['inicio-terreno'] },
        colaborador: { obra: ['inicio-terreno'], empresa: ['inicio-terreno'] },
        supervisor: { obra: ['inicio-gestion'], empresa: [] },
        prevencionista: { obra: ['inicio-gestion'], empresa: [] },
        jefe_obra: { obra: ['inicio-gestion'], empresa: [] },
        admin: { obra: [], empresa: ['inicio-empresa'] },
    };
    for (const [rol, porAmbito] of Object.entries(esperado)) {
        for (const [ambito, ids] of Object.entries(porAmbito)) {
            assert.deepEqual(await introDe(rol, ambito), ids, `${rol} en ${ambito}`);
        }
    }
    // Ningún preset quedó sin revisar.
    assert.deepEqual(Object.keys(DEFAULT_ROLE_PRESETS).sort(), Object.keys(esperado).sort());
});

test('mis-firmas es obligatorio para todos los roles', async () => {
    const { publicados, colaAutomatica } = await cargar();
    for (const rol of Object.keys(DEFAULT_ROLE_PRESETS)) {
        for (const ambito of ['obra', 'empresa']) {
            const ids = colaAutomatica(publicados, 'mis-firmas', sinProgreso, persona(rol, ambito), HOY).map((d) => d.id);
            assert.deepEqual(ids, ['mis-firmas'], `${rol} en ${ambito}`);
        }
    }
});

test('los opcionales llegan a quien tiene el permiso de la pantalla, y no a un trabajador', async () => {
    const { publicados, deLaPantalla } = await cargar();
    const ids = (rol, pantalla, ambito = 'obra') => deLaPantalla(publicados, pantalla, persona(rol, ambito), HOY).map((d) => d.id);
    assert.ok(ids('trabajador', 'incidente-reportar').includes('reportar'), 'reportar lo ve cualquiera');
    assert.deepEqual(ids('trabajador', 'actividades'), [], 'un trabajador no programa actividades');
    assert.deepEqual(ids('supervisor', 'actividades'), ['programar-actividades']);
    assert.deepEqual(ids('supervisor', 'repositorio'), [], 'el supervisor no sube documentos por defecto');
    assert.deepEqual(ids('prevencionista', 'repositorio'), ['subir-documentos']);
    assert.deepEqual(ids('jefe_obra', 'obra-detalle'), ['cumplimiento-obra']);
    assert.ok(ids('supervisor', 'inicio').includes('cambiar-de-obra'));
    assert.ok(!ids('trabajador', 'inicio').includes('cambiar-de-obra'));
});

test('los recorridos iniciales entran como borrador', async () => {
    const { RECORRIDOS } = await importar('recorridos.ts');
    assert.equal(RECORRIDOS.length, 9);
    assert.deepEqual(RECORRIDOS.filter((d) => d.estado !== 'borrador').map((d) => d.id), [],
        'se publican después de la revisión de Adrean y Benja en dev');
});
