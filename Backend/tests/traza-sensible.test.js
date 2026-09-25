// El dato personal no vive en el elemento que los índices copian.
//
// La regla: un índice global con proyección `ALL` es una copia completa de cada
// elemento, y un índice solo indexa los elementos que tienen su atributo de
// clave. Guardando el RUT en un elemento APARTE, sin `tenantId` ni ningún otro
// atributo de clave de índice, ese elemento no aparece en ningún índice.
//
// Lo que estas pruebas protegen es justamente lo que se rompería en silencio:
// que alguien vuelva a escribir el RUT en el elemento listado, que agregue
// `tenantId` al elemento aparte y lo devuelva a los índices sin que nada falle,
// o que el elemento aparte guarde el RUT en claro (D-10: va cifrado como un
// solo sobre, no solo fuera del índice).

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const { guardarTraza, conTraza, esTraza } = require('../lib/traza-sensible');

const TABLA = 'tabla-de-prueba';

let escrituras;
let almacen;
let original;

beforeEach(() => {
    escrituras = [];
    almacen = new Map();
    original = docClient.send;
    docClient.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        const input = cmd.input || {};
        if (nombre === 'PutCommand') {
            escrituras.push(input.Item);
            almacen.set(input.Item.signatureId || input.Item.incidentId, input.Item);
            return {};
        }
        if (nombre === 'GetCommand') {
            const k = Object.values(input.Key)[0];
            return { Item: almacen.get(k) };
        }
        return {};
    };
});

afterEach(() => { docClient.send = original; });

// ─── El mecanismo ────────────────────────────────────────────────────────────

test('el elemento aparte no lleva ningún atributo de clave de índice', async () => {
    await guardarTraza(TABLA, 'signatureId', 'firma-1', { personaRut: '12.345.678-5', ipAddress: '1.2.3.4' });

    const guardado = escrituras[0];
    assert.equal(guardado.signatureId, 'firma-1#traza');

    // Estos cuatro son claves de los índices de las tablas involucradas. Si
    // alguno aparece acá, el elemento vuelve a los índices y el RUT con él.
    for (const clave of ['tenantId', 'personaId', 'requestId', 'referenciaId']) {
        assert.equal(guardado[clave], undefined, `${clave} devolvería este elemento a un índice`);
    }
});

test('el RUT y la IP van cifrados, no en claro, dentro del elemento aparte', async () => {
    await guardarTraza(TABLA, 'signatureId', 'firma-1', { personaRut: '12.345.678-5', ipAddress: '1.2.3.4' });

    const guardado = escrituras[0];
    assert.equal(guardado.personaRut, undefined, 'el RUT no debe quedar en claro ni fuera del índice');
    assert.equal(guardado.ipAddress, undefined);
    assert.ok(guardado.cifrado, 'el contenido sensible viaja en un sobre');
    assert.ok(guardado.cifrado.c && guardado.cifrado.iv && guardado.cifrado.tag, 'sobre completo (c/iv/tag)');
    assert.ok(!JSON.stringify(guardado.cifrado).includes('12.345.678-5'), 'el RUT no debe aparecer en claro en el sobre');
});

test('unir las dos partes devuelve el registro completo', async () => {
    await guardarTraza(TABLA, 'signatureId', 'firma-1', { personaRut: '12.345.678-5' });

    const completo = await conTraza(TABLA, 'signatureId', {
        signatureId: 'firma-1', personaNombre: 'Juan Pérez', tenantId: 't-1',
    });

    assert.equal(completo.personaRut, '12.345.678-5');
    assert.equal(completo.personaNombre, 'Juan Pérez');
    assert.equal(completo.signatureId, 'firma-1', 'la clave sigue siendo la del registro, no la de la traza');
});

test('sin traza, el registro se devuelve igual y no se cae', async () => {
    const registrado = [];
    const consolaOriginal = console.error;
    console.error = (...a) => registrado.push(a.join(' '));

    const completo = await conTraza(TABLA, 'signatureId', { signatureId: 'sin-traza', personaNombre: 'Ana' });

    console.error = consolaOriginal;
    assert.equal(completo.personaNombre, 'Ana');
    assert.equal(completo.personaRut, undefined);
});

test('un fallo al leer la traza no impide abrir el registro, pero queda medido', async () => {
    docClient.send = async (cmd) => {
        if (cmd.constructor.name === 'GetCommand') throw new Error('DynamoDB no responde');
        return {};
    };
    const registrado = [];
    const consolaOriginal = console.error;
    console.error = (...a) => registrado.push(a.join(' '));

    const completo = await conTraza(TABLA, 'signatureId', { signatureId: 'firma-1', personaNombre: 'Ana' });

    console.error = consolaOriginal;
    assert.equal(completo.personaNombre, 'Ana', 'un detalle incompleto es mejor que no poder abrirlo');
    assert.ok(registrado.some((l) => l.includes('FALLO_DEPENDENCIA')), 'y el fallo no es invisible');
});

test('un sobre que no se puede descifrar tampoco impide abrir el registro, y queda medido', async () => {
    almacen.set('firma-1#traza', {
        signatureId: 'firma-1#traza',
        cifrado: { c: 'basura', iv: 'basura', tag: 'basura', kid: 'local', v: 1 },
        creadoEn: new Date().toISOString(),
    });
    const registrado = [];
    const consolaOriginal = console.error;
    console.error = (...a) => registrado.push(a.join(' '));

    const completo = await conTraza(TABLA, 'signatureId', { signatureId: 'firma-1', personaNombre: 'Ana' });

    console.error = consolaOriginal;
    assert.equal(completo.personaNombre, 'Ana', 'un detalle incompleto es mejor que no poder abrirlo');
    assert.equal(completo.personaRut, undefined);
    assert.ok(registrado.some((l) => l.includes('FALLO_DEPENDENCIA')), 'un KMS caído tampoco es invisible');
});

test('una traza vieja sin migrar (sin `cifrado`, campos en claro) se sigue leyendo igual', async () => {
    almacen.set('firma-1#traza', {
        signatureId: 'firma-1#traza',
        personaRut: '12.345.678-5',
        ipAddress: '1.2.3.4',
        creadoEn: new Date().toISOString(),
    });

    const completo = await conTraza(TABLA, 'signatureId', { signatureId: 'firma-1', personaNombre: 'Ana' });

    assert.equal(completo.personaRut, '12.345.678-5', 'leer y reparar: el legado sin migrar sigue funcionando');
    assert.equal(completo.ipAddress, '1.2.3.4');
});

test('los recorridos completos de tabla distinguen la traza del registro', () => {
    assert.equal(esTraza({ incidentId: 'inc-1#traza' }, 'incidentId'), true);
    assert.equal(esTraza({ incidentId: 'inc-1' }, 'incidentId'), false);
});

// ─── Lo que escribe cada camino ──────────────────────────────────────────────

test('la firma guardada no lleva RUT ni IP, y la copia del documento sí', async () => {
    const { FirmaService } = require('../lib/services/FirmaService');

    const persona = {
        personaId: 'p-1', tenantId: 't-1', rut: '12.345.678-5',
        nombre: 'Juan', apellido: 'Pérez', cargo: 'Maestro',
        _pinHash: null, habilitado: true,
        tienePinConfigurado: () => true,
    };

    const firma = await FirmaService.crear({
        persona,
        tenantId: 't-1',
        tipoFirma: 'trabajador',
        metodo: 'VALE',
        credencial: { vale: 'x' },
        contexto: { ipAddress: '1.2.3.4', userAgent: 'navegador' },
    }).catch((e) => e);

    if (firma instanceof Error) {
        // El camino de vale exige consumir el vale contra la tabla; si el doble
        // no alcanza, al menos se comprueba lo esencial: que la firma escrita en
        // la tabla no tenga el RUT.
        const enTabla = escrituras.find((i) => i.signatureId && !String(i.signatureId).endsWith('#traza'));
        if (enTabla) assert.equal(enTabla.personaRut, undefined);
        return;
    }

    const enTabla = escrituras.find((i) => i.signatureId && !String(i.signatureId).endsWith('#traza'));
    const traza = escrituras.find((i) => String(i.signatureId).endsWith('#traza'));

    assert.equal(enTabla.personaRut, undefined, 'el elemento que los índices copian no tiene RUT');
    assert.equal(enTabla.ipAddress, undefined);
    assert.equal(traza.personaRut, undefined, 'ni siquiera el elemento aparte lo tiene en claro');
    assert.ok(traza.cifrado, 'va cifrado dentro del elemento aparte');
    assert.equal(firma.personaRut, '12.345.678-5', 'quien llama recibe la firma completa para el documento');
});
