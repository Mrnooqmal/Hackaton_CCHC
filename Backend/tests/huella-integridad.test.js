// La huella de integridad cubre TODO el contenido firmado.
//
// Esta es la prueba que habría atrapado el error de `hashSnapshot`: la huella
// de un informe del Art. 71 no cambiaba si se reescribía al accidentado, la
// gravedad, si fue fatal, los días perdidos o la causa raíz, porque un arreglo
// como segundo argumento de `JSON.stringify` filtraba todo lo anidado.
//
// Por eso no se prueba "un par de campos que uno recuerda": se RECORRE el
// contenido y se altera cada hoja, una por una, exigiendo que la huella cambie.
// Un campo que se agregue mañana al informe queda cubierto sin tocar esta
// prueba, porque el recorrido lo encuentra solo.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { calcularHuella, verificarHuella, formaCanonica } = require('../lib/huella');
const { RegistroService } = require('../lib/services/RegistroService');

// ─── Contenidos reales ───────────────────────────────────────────────────────

/** Un incidente con TODOS los campos que el informe del Art. 71 recoge, para
 *  que el constructor real produzca un contenido sin ramas vacías. */
const INCIDENTE = {
    incidentId: 'inc-1',
    fecha: '2026-09-20',
    hora: '10:15',
    gravedad: 'grave',
    esFatal: false,
    diasPerdidos: 30,
    direccionAccidente: 'Av. Siempre Viva 742, piso 4',
    descripcion: 'Caída desde andamio',
    afectado: {
        nombreCompleto: 'Juan Pérez Soto',
        rut: '12.345.678-5',
        cargo: 'Maestro albañil',
        puestoAlMomentoAccidente: 'Andamio fachada norte',
    },
    relatoAccidente: 'Al retirar el arnés para cambiar de nivel, perdió el equilibrio.',
    listaHechos: [{ orden: 1, hecho: 'Se retiró el arnés' }, { orden: 2, hecho: 'La baranda estaba incompleta' }],
    causasRaiz: [{ causa: 'Falta de baranda perimetral', tipo: 'condicion' }],
    arbolCausasUrl: 'tenants/t/arbol/inc-1.png',
    medidasCorrectivas: [{ numero: 1, medida: 'Instalar baranda', responsableId: 'p-9', fechaMaxEjecucion: '2026-10-01', estado: 'pendiente' }],
    entrevistados: [{ nombre: 'Pedro Díaz', rut: '9.876.543-3', cargo: 'Capataz' }],
};

const snapshotInvestigacion = () => RegistroService.construirSnapshotInvestigacion(INCIDENTE, {
    tenantId: 't-1', obraId: 'o-1', generadoEn: '2026-09-25T12:00:00.000Z',
});

/** La forma del registro AT/EP (la arma `construirSnapshotConsolidado`, que lee
 *  la base de datos): indicadores, incidentes, vigilancia de salud por persona. */
const snapshotRegistroATEP = () => ({
    tipoRegistro: 'REGISTRO_AT_EP',
    articulos: 'Arts. 71-72',
    tenantId: 't-1',
    obraId: 'o-1',
    periodo: { desde: '2026-09-01', hasta: '2026-09-30' },
    generadoEn: '2026-09-25T12:00:00.000Z',
    indicadores: { tasaAccidentabilidad: 2.5, tasaSiniestralidad: 40, diasPerdidos: 30, masaLaboral: 120 },
    incidentes: [{ incidentId: 'inc-1', tipo: 'accidente', gravedad: 'grave', fecha: '2026-09-20', descripcion: 'Caída', diasPerdidos: 30, investigacion: true }],
    actividadesPreventivas: [{ activityId: 'a-1', tipo: 'CHARLA_5MIN', subtipo: null, titulo: 'Trabajo en altura', fecha: '2026-09-02', totalAsistentes: 14 }],
    vigilanciaSalud: {
        enVigilancia: 1,
        totalActivos: 120,
        personas: [{ personaId: 'p-1', nombre: 'Juan Pérez', protocolos: ['ruido', 'silice'], aptitudLaboral: 'apto_con_restricciones' }],
    },
    totales: { incidentes: 1, actividades: 1, entregasEpp: 0, documentos: 3, miperVigente: true, enVigilancia: 1 },
});

// ─── El recorrido ────────────────────────────────────────────────────────────

/** Todas las rutas a hojas (valores que no son objeto ni arreglo). */
const hojas = (valor, ruta = []) => {
    if (valor !== null && typeof valor === 'object') {
        return Object.entries(valor).flatMap(([k, v]) => hojas(v, [...ruta, Array.isArray(valor) ? Number(k) : k]));
    }
    return [ruta];
};

const alterar = (v) => {
    if (typeof v === 'string') return `${v}·alterado`;
    if (typeof v === 'number') return v + 1;
    if (typeof v === 'boolean') return !v;
    return 'antes-era-null';
};

const conCambio = (original, ruta, fn) => {
    const copia = structuredClone(original);
    let nodo = copia;
    for (const paso of ruta.slice(0, -1)) nodo = nodo[paso];
    fn(nodo, ruta[ruta.length - 1]);
    return copia;
};

const CONTENIDOS = {
    'informe de investigación (Art. 71)': snapshotInvestigacion,
    'registro AT/EP (Arts. 71-72)': snapshotRegistroATEP,
};

for (const [nombre, construir] of Object.entries(CONTENIDOS)) {
    describe(`huella del ${nombre}`, () => {
        const base = construir();
        const huellaBase = calcularHuella(base).valor;
        const rutas = hojas(base);

        test('el recorrido encuentra los campos anidados, no solo los de primer nivel', () => {
            assert.ok(rutas.some((r) => r.length >= 3), 'hay hojas a tres o más niveles de profundidad');
            assert.ok(rutas.length >= 15, `se recorren ${rutas.length} campos`);
        });

        for (const ruta of hojas(construir())) {
            test(`cambiar ${ruta.join('.')} cambia la huella`, () => {
                const alterado = conCambio(base, ruta, (nodo, k) => { nodo[k] = alterar(nodo[k]); });
                assert.notEqual(calcularHuella(alterado).valor, huellaBase);
            });
        }

        test('agregar o quitar un campo en cualquier nivel cambia la huella', () => {
            for (const ruta of rutas) {
                const quitado = conCambio(base, ruta, (nodo, k) => {
                    if (Array.isArray(nodo)) nodo.splice(k, 1); else delete nodo[k];
                });
                assert.notEqual(calcularHuella(quitado).valor, huellaBase, `quitar ${ruta.join('.')}`);
            }
            const agregado = conCambio(base, [...rutas[0].slice(0, -1), 'campoNuevo'], (nodo, k) => { nodo[k] = 'x'; });
            assert.notEqual(calcularHuella(agregado).valor, huellaBase);
        });

        test('reordenar los elementos de un arreglo cambia la huella: el orden es contenido', () => {
            const conArreglo = rutas.find((r) => r.some((p) => typeof p === 'number'));
            if (!conArreglo) return;
            const i = conArreglo.findIndex((p) => typeof p === 'number');
            const rutaArreglo = conArreglo.slice(0, i);
            const alterado = conCambio(base, rutaArreglo, (nodo, k) => { nodo[k] = [...nodo[k], structuredClone(nodo[k][0])]; });
            assert.notEqual(calcularHuella(alterado).valor, huellaBase);
        });

        test('reordenar las CLAVES no cambia la huella: es la misma información', () => {
            const invertir = (v) => (Array.isArray(v) ? v.map(invertir)
                : v && typeof v === 'object'
                    ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, invertir(x)]))
                    : v);
            assert.equal(calcularHuella(invertir(base)).valor, huellaBase);
        });

        test('pasar por JSON —lo que hace el cifrado al guardar y leer— no cambia la huella', () => {
            const vuelta = JSON.parse(JSON.stringify(base));
            assert.equal(calcularHuella(vuelta).valor, huellaBase);
            assert.equal(verificarHuella(vuelta, calcularHuella(base)), true);
        });
    });
}

// ─── La huella misma ─────────────────────────────────────────────────────────

describe('la huella se verifica con la regla con que se firmó', () => {
    test('guarda algoritmo y forma canónica, no solo el valor', () => {
        const h = calcularHuella({ a: 1 });
        assert.equal(h.alg, 'sha256');
        assert.equal(h.canon, 'json-canonico-v1');
        assert.match(h.valor, /^[0-9a-f]{64}$/);
    });

    test('un contenido alterado no verifica', () => {
        const contenido = snapshotInvestigacion();
        const h = calcularHuella(contenido);
        contenido.accidente.esFatal = true;
        assert.equal(verificarHuella(contenido, h), false);
    });

    test('una regla desconocida no dice "alterado": dice que no sabe verificar', () => {
        assert.throws(() => verificarHuella({ a: 1 }, { alg: 'sha256', canon: 'otra-regla', valor: 'x' }), /desconocida/);
    });

    test('lo que JSON perdería en silencio se rechaza, no se ignora', () => {
        assert.throws(() => calcularHuella({ dias: NaN }));
        assert.throws(() => calcularHuella({ monto: Infinity }));
        assert.throws(() => calcularHuella({ mapa: new Map() }));
        assert.throws(() => calcularHuella({ fn: () => 1 }));
    });

    test('la forma canónica ordena claves en TODOS los niveles, sin filtrar ninguna', () => {
        assert.equal(formaCanonica({ b: { d: 1, c: [{ f: 2, e: 3 }] }, a: 0 }), '{"a":0,"b":{"c":[{"e":3,"f":2}],"d":1}}');
    });
});
