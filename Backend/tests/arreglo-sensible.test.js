// RUT e IP dentro de los arreglos embebidos (D-10).
//
// Lo que estas pruebas protegen es lo que se rompe EN SILENCIO. Cifrar un campo
// tiene dos fallas simétricas y ninguna de las dos levanta un error:
//
//   1. un escritor que se olvida de cifrar deja el RUT en claro en la tabla, y
//      todo lo demás sigue funcionando igual;
//   2. un lector que se olvida de descifrar devuelve el sobre —un objeto
//      `{c, iv, tag}`— donde la pantalla esperaba un RUT, y tampoco falla acá.
//
// El inventario de este cambio encontró CUATRO constructores independientes de
// `asignaciones[]` y TRES de `firmas[]`. Por eso hay una prueba estructural al
// final: no alcanza con probar el camino que uno recuerda.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { docClient } = require('../lib/clients/dynamodb');
const {
    construirAsignacion,
    descifrarDocumento,
    descifrarActividad,
    descifrarSolicitud,
    descifrarDocumentosDeTenant,
    llaveDe,
} = require('../lib/arregloSensible');
const { FirmaService } = require('../lib/services/FirmaService');

const RUT = '12.345.678-5';

/** Doble de la tabla: guarda la llave de datos del tenant como lo haría Dynamo,
 *  y cuenta cuántas veces se fue a buscar (el costo que el diseño acota). */
const conTablaDeLlaves = () => {
    const llaves = new Map();
    const conteo = { lecturas: 0 };
    const original = docClient.send;
    docClient.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        const input = cmd.input || {};
        if (nombre === 'GetCommand') {
            conteo.lecturas += 1;
            return { Item: llaves.get(`${input.Key.PK}|${input.Key.SK}`) };
        }
        if (nombre === 'UpdateCommand') {
            const clave = `${input.Key.PK}|${input.Key.SK}`;
            const previo = llaves.get(clave) || { PK: input.Key.PK, SK: input.Key.SK };
            const valores = input.ExpressionAttributeValues || {};
            const nombres = input.ExpressionAttributeNames || {};
            const item = { ...previo };
            for (const [ph, campo] of Object.entries(nombres)) {
                const vh = `:${ph.slice(1)}`;
                if (valores[vh] !== undefined) item[campo] = valores[vh];
            }
            llaves.set(clave, item);
            return { Attributes: item };
        }
        return {};
    };
    return { conteo, restaurar: () => { docClient.send = original; } };
};

describe('cifrado de los arreglos embebidos', () => {
    let tabla;
    beforeEach(() => { tabla = conTablaDeLlaves(); });
    afterEach(() => { tabla.restaurar(); });

    test('una asignación nace con el RUT cifrado, nunca en claro', async () => {
        const llave = await llaveDe('t-1');
        const asignacion = construirAsignacion(
            { personaId: 'p-1', nombre: 'Juan', apellido: 'Pérez', rut: RUT },
            {},
            llave
        );

        assert.equal(asignacion.rut, undefined, 'el RUT en claro no debe quedar en el arreglo');
        assert.ok(asignacion.rutCifrado, 'debe venir el sobre');
        assert.ok(!JSON.stringify(asignacion).includes(RUT), 'el RUT no debe aparecer en ninguna parte del objeto');
        assert.equal(asignacion.nombre, 'Juan Pérez', 'el nombre sí se conserva: los listados lo dibujan');
    });

    test('lo que se cifra al escribir se lee igual al mostrarlo', async () => {
        const llave = await llaveDe('t-1');
        const doc = {
            documentId: 'd-1',
            asignaciones: [construirAsignacion({ personaId: 'p-1', nombre: 'Juan', rut: RUT }, {}, llave)],
        };

        const visto = descifrarDocumento(doc, llave);
        assert.equal(visto.asignaciones[0].rut, RUT);
        assert.equal(visto.asignaciones[0].rutCifrado, undefined, 'el sobre no viaja al cliente');
    });

    test('una firma embebida no lleva el RUT ni la IP en claro', async () => {
        const firma = await FirmaService.toDocumentFirmaFormat({
            token: 'tok', personaId: 'p-1', personaNombre: 'Juan Pérez', personaRut: RUT,
            tipoFirma: 'trabajador', fecha: '2026-09-24', horario: '10:00',
            timestamp: '2026-09-24T10:00:00.000Z', ipAddress: '1.2.3.4', tenantId: 't-1',
        });

        assert.equal(firma.rut, undefined);
        assert.equal(firma.ip, undefined);
        assert.ok(firma.rutCifrado && firma.ipCifrado);
        const serializada = JSON.stringify(firma);
        assert.ok(!serializada.includes(RUT), 'el RUT no debe quedar en claro');
        assert.ok(!serializada.includes('1.2.3.4'), 'la IP tampoco');

        const llave = await llaveDe('t-1');
        const visto = descifrarDocumento({ firmas: [firma] }, llave);
        assert.equal(visto.firmas[0].rut, RUT, 'el anexo del PDF necesita el RUT de vuelta');
        assert.equal(visto.firmas[0].ip, '1.2.3.4');
    });

    test('la llave se guarda y se busca POR empresa, no una global', async () => {
        // Ojo con lo que esta prueba puede y no puede afirmar. Con la vía de
        // escape de pruebas (`CAMPO_CIFRADO_LOCAL_KEY`) KMS no existe y TODAS
        // las empresas resuelven a la misma llave local, así que "la empresa B
        // no puede descifrar lo de A" es indemostrable acá — haría falta KMS de
        // verdad. Lo que sí se comprueba, y es lo que se rompería al programar,
        // es que la llave se pide y se guarda contra la partición de CADA
        // empresa: si alguien la volviera global, estas claves serían una sola.
        const claves = [];
        const original = docClient.send;
        docClient.send = async (cmd) => {
            if (cmd.constructor.name === 'GetCommand') claves.push(cmd.input.Key.PK);
            return {};
        };
        try {
            await llaveDe('t-a');
            await llaveDe('t-b');
        } finally {
            docClient.send = original;
        }

        assert.deepEqual(claves, ['TENANT#t-a', 'TENANT#t-b'],
            'cada empresa tiene su propia llave, guardada en su propia partición');
    });

    test('listar N documentos cuesta UNA búsqueda de llave, no N', async () => {
        // Esta es LA propiedad que ordenó el diseño: con un sobre por valor,
        // una pantalla de documentos costaría una llamada a KMS por cada RUT.
        // Se limpia la caché por contenedor antes de medir, porque si no la
        // prueba pasaría sola sin comprobar nada.
        const llave = await llaveDe('t-1');
        const docs = Array.from({ length: 25 }, (_, i) => ({
            documentId: `d-${i}`,
            asignaciones: [construirAsignacion({ personaId: `p-${i}`, nombre: 'X', rut: RUT }, {}, llave)],
        }));

        require('../lib/llaveTenant')._olvidarCache();
        const antes = tabla.conteo.lecturas;
        const vistos = await descifrarDocumentosDeTenant(docs, 't-1');
        const gasto = tabla.conteo.lecturas - antes;

        assert.equal(vistos.length, 25);
        assert.equal(vistos[24].asignaciones[0].rut, RUT);
        assert.equal(gasto, 1, `veinticinco documentos deben costar UNA lectura de llave, costaron ${gasto}`);
    });

    // ── Leer y reparar ───────────────────────────────────────────────────────

    test('un documento viejo, con el RUT todavía en claro, se sigue leyendo', async () => {
        const llave = await llaveDe('t-1');
        const legado = {
            documentId: 'd-viejo',
            asignaciones: [{ personaId: 'p-1', nombre: 'Juan', rut: RUT, estado: 'pendiente' }],
            firmas: [{ token: 't', personaId: 'p-1', nombre: 'Juan', rut: RUT, ip: '1.2.3.4' }],
        };

        const visto = descifrarDocumento(legado, llave);
        assert.equal(visto.asignaciones[0].rut, RUT, 'el legado sin migrar no puede dejar de verse');
        assert.equal(visto.firmas[0].ip, '1.2.3.4');
    });

    test('actividades y solicitudes siguen el mismo criterio', async () => {
        const llave = await llaveDe('t-1');
        const { cifrarCamposEnArreglo, cifrarCamposEnObjeto } = require('../lib/arregloSensible');

        const actividad = {
            asistentes: cifrarCamposEnArreglo([{ personaId: 'p-1', nombre: 'J', rut: RUT }], ['rut'], llave),
            firmaRelator: cifrarCamposEnObjeto({ personaId: 'p-2', nombre: 'R', rut: RUT }, ['rut'], llave),
        };
        const solicitud = cifrarCamposEnObjeto({
            requestId: 'r-1',
            solicitanteRut: RUT,
            trabajadores: cifrarCamposEnArreglo([{ personaId: 'p-1', rut: RUT }], ['rut'], llave),
        }, ['solicitanteRut'], llave);

        assert.ok(!JSON.stringify(actividad).includes(RUT));
        assert.ok(!JSON.stringify(solicitud).includes(RUT));

        assert.equal(descifrarActividad(actividad, llave).asistentes[0].rut, RUT);
        assert.equal(descifrarActividad(actividad, llave).firmaRelator.rut, RUT);
        assert.equal(descifrarSolicitud(solicitud, llave).solicitanteRut, RUT);
        assert.equal(descifrarSolicitud(solicitud, llave).trabajadores[0].rut, RUT);
    });
});

// ─── Encuestas ───────────────────────────────────────────────────────────────

describe('respuestas de encuesta: cifradas siempre', () => {
    let tabla;
    beforeEach(() => { tabla = conTablaDeLlaves(); });
    afterEach(() => { tabla.restaurar(); });

    const { construirDestinatario, descifrarEncuesta, llaveSaludDe } = require('../lib/arregloSensible');

    test('un destinatario nace sin el RUT ni las respuestas en claro', async () => {
        const [llave, llaveSalud] = [await llaveDe('t-1'), await llaveSaludDe('t-1')];
        const dest = construirDestinatario(
            { personaId: 'p-1', nombre: 'Juan', apellido: 'Pérez', rut: RUT, cargo: 'Maestro' },
            { responses: [{ preguntaId: 'q1', respuesta: 'Hipertensión' }] },
            llave, llaveSalud
        );

        assert.equal(dest.rut, undefined);
        assert.equal(dest.responses, undefined);
        assert.ok(dest.rutCifrado && dest.responsesCifradas);
        const serializado = JSON.stringify(dest);
        assert.ok(!serializado.includes(RUT));
        assert.ok(!serializado.includes('Hipertensión'), 'una respuesta de salud no puede quedar en claro');
    });

    test('las respuestas VACÍAS también se cifran — la regla es "siempre"', async () => {
        // Esta es la prueba que justifica `cifrarConLlaveDatosSiempre`. Condicionar
        // el cifrado a que haya contenido deja un hueco que nadie vuelve a mirar.
        const [llave, llaveSalud] = [await llaveDe('t-1'), await llaveSaludDe('t-1')];
        const dest = construirDestinatario({ personaId: 'p-1', nombre: 'J', rut: RUT }, {}, llave, llaveSalud);

        assert.ok(dest.responsesCifradas, 'un arreglo vacío igual produce sobre');
        assert.ok(dest.responsesCifradas.c && dest.responsesCifradas.iv && dest.responsesCifradas.tag);

        const visto = descifrarEncuesta({ recipients: [dest] }, llave, llaveSalud);
        assert.deepEqual(visto.recipients[0].responses, [], 'y vuelve a salir como arreglo vacío');
    });

    test('lo cifrado vuelve tal cual al mostrar la encuesta', async () => {
        const [llave, llaveSalud] = [await llaveDe('t-1'), await llaveSaludDe('t-1')];
        const respuestas = [
            { preguntaId: 'health-01', respuesta: 'Sí' },
            { preguntaId: 'health-02', respuesta: 'Alergia a la penicilina' },
        ];
        const encuesta = {
            surveyId: 'e-1',
            recipients: [construirDestinatario(
                { personaId: 'p-1', nombre: 'Juan', rut: RUT }, { responses: respuestas }, llave, llaveSalud)],
        };

        const visto = descifrarEncuesta(encuesta, llave, llaveSalud);
        assert.equal(visto.recipients[0].rut, RUT);
        assert.deepEqual(visto.recipients[0].responses, respuestas);
        assert.equal(visto.recipients[0].responsesCifradas, undefined, 'el sobre no viaja al cliente');
    });

    test('las respuestas NO usan la misma llave que el RUT', async () => {
        // Son secretos de radio de exposición distinto: el RUT va con la llave de
        // identificación y las respuestas con la de salud, igual que
        // `vigilanciaSalud`. Con la vía de escape de pruebas las dos resuelven a
        // la misma llave local, así que lo comprobable es que se piden DOS
        // llaves distintas de la empresa, no una sola para todo.
        require('../lib/llaveTenant')._olvidarCache();
        const pedidos = [];
        const original = docClient.send;
        docClient.send = async (cmd) => {
            if (cmd.constructor.name === 'UpdateCommand') {
                // El atributo va literal en la expresión, no como placeholder.
                const m = /SET\s+(\w+)\s*=/.exec(cmd.input.UpdateExpression || '');
                if (m) pedidos.push(m[1]);
            }
            return {};
        };
        try {
            await llaveDe('t-nueva');
            await llaveSaludDe('t-nueva');
        } finally {
            docClient.send = original;
        }

        assert.deepEqual(pedidos.sort(), ['rutPersonasDataKey', 'saludDataKey'],
            'el RUT y la salud no comparten llave');
    });

    test('una encuesta vieja, con respuestas en claro, se sigue leyendo', async () => {
        const [llave, llaveSalud] = [await llaveDe('t-1'), await llaveSaludDe('t-1')];
        const legada = {
            surveyId: 'e-vieja',
            recipients: [{
                personaId: 'p-1', workerId: 'p-1', nombre: 'Juan',
                rut: RUT, responses: [{ preguntaId: 'q1', respuesta: 'Sí' }],
            }],
        };

        const visto = descifrarEncuesta(legada, llave, llaveSalud);
        assert.equal(visto.recipients[0].rut, RUT);
        assert.deepEqual(visto.recipients[0].responses, [{ preguntaId: 'q1', respuesta: 'Sí' }]);
    });
});

// ─── Lo que sale por la API ──────────────────────────────────────────────────
//
// Estas pruebas existen porque las de arriba NO bastaron. Con el cifrado ya
// puesto y las pruebas de biblioteca en verde, seis respuestas seguían
// devolviendo el sobre `{c, iv, tag}` donde la pantalla esperaba un RUT: al
// cifrar se revisó dónde se GUARDA el dato y no dónde se DEVUELVE. Lo encontró
// una llamada real contra dev, no la suite.

describe('ninguna respuesta devuelve el sobre en vez del RUT', () => {
    let store;
    let originalSend;

    const SESION = (tenantId = 't1') => ({
        requestContext: {
            authorizer: {
                lambda: {
                    sessionId: 's-1', personaId: 'p-editor', tenantId, rol: 'admin',
                    permisos: 'repositorio.subir,obra.subir_documentos,obra.asignar_trabajadores',
                },
            },
            http: { method: 'POST', path: '/', sourceIp: '1.2.3.4' },
        },
    });

    beforeEach(() => {
        store = { doc: null, llaves: new Map() };
        originalSend = docClient.send;
        docClient.send = async (cmd) => {
            const nombre = cmd.constructor.name;
            const input = cmd.input || {};
            if (nombre === 'GetCommand') {
                if (String(input.Key?.PK || '').startsWith('TENANT#')) {
                    return { Item: store.llaves.get(input.Key.PK) };
                }
                return { Item: store.doc };
            }
            if (nombre === 'UpdateCommand') {
                if (String(input.Key?.PK || '').startsWith('TENANT#')) {
                    const item = { PK: input.Key.PK, SK: input.Key.SK };
                    const nombres = input.ExpressionAttributeNames || {};
                    const valores = input.ExpressionAttributeValues || {};
                    for (const [ph, campo] of Object.entries(nombres)) {
                        const vh = `:${ph.slice(1)}`;
                        if (valores[vh] !== undefined) item[campo] = valores[vh];
                    }
                    store.llaves.set(input.Key.PK, item);
                    return { Attributes: item };
                }
                return { Attributes: store.doc };
            }
            return {};
        };
    });

    afterEach(() => { docClient.send = originalSend; });

    test('asignar un documento devuelve el RUT, no el sobre', async () => {
        store.doc = {
            documentId: 'd-1', tenantId: 't1', titulo: 'Procedimiento',
            asignaciones: [], firmas: [],
        };

        // PersonaService.getById se sustituye: la prueba es sobre la respuesta
        // del handler, no sobre cómo se busca la persona.
        const { PersonaService } = require('../lib/services/PersonaService');
        const originalGet = PersonaService.prototype.getById;
        PersonaService.prototype.getById = async () => ({
            personaId: 'p-1', tenantId: 't1', nombre: 'Juan', apellido: 'Pérez', rut: RUT,
        });

        try {
            const handler = require('../handlers/documents/handler');
            const res = await handler.assign({
                ...SESION(),
                pathParameters: { id: 'd-1' },
                body: JSON.stringify({ personaIds: ['p-1'], notificar: false }),
            });

            assert.equal(res.statusCode, 200);
            const cuerpo = JSON.parse(res.body);
            const asignaciones = cuerpo.data?.asignaciones || cuerpo.asignaciones;

            assert.equal(asignaciones[0].rut, RUT, 'la pantalla espera el RUT');
            assert.equal(asignaciones[0].rutCifrado, undefined, 'el sobre no sale por la API');
            assert.ok(!/"iv"\s*:/.test(res.body), 'ningún sobre en la respuesta');
        } finally {
            PersonaService.prototype.getById = originalGet;
        }
    });

    test('lo que se GUARDÓ en la tabla, en cambio, sí va cifrado', async () => {
        // La otra cara de la misma prueba: que la respuesta traiga el RUT no
        // puede lograrse por el atajo de no cifrar nunca.
        const llave = await llaveDe('t1');
        const asignacion = construirAsignacion({ personaId: 'p-1', nombre: 'Juan', rut: RUT }, {}, llave);
        assert.equal(asignacion.rut, undefined);
        assert.ok(asignacion.rutCifrado);
    });
});

// ─── La prueba estructural ───────────────────────────────────────────────────
//
// Las de arriba prueban los caminos que uno se acuerda de probar. Esta busca al
// escritor que nadie recordó: el `rut: persona.rut` nuevo, en un archivo que ni
// siquiera existía cuando se escribió este cambio.

describe('todo escritor de estas tres tablas pasa por el cifrado compartido', () => {
    const RAIZ = path.join(__dirname, '..');

    // Quien escribe en estas tablas escribe uno de los arreglos con RUT. Si un
    // archivo nuevo aparece acá sin requerir el cifrado, o uno de estos deja de
    // requerirlo, es que hay un escritor con su propia copia del RUT en claro —
    // que es exactamente cómo llegamos a tener cuatro.
    const ESCRITORES = [
        'handlers/documents/handler.js',
        'handlers/activities/handler.js',
        'handlers/signature-requests/handler.js',
        'handlers/personas-module/handler.js',
        'lib/services/EppService.js',
        'lib/services/FirmaService.js',
    ];

    test('cada escritor conocido importa el cifrado de arreglos', () => {
        const sinCifrado = ESCRITORES.filter((rel) => {
            const fuente = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
            return !fuente.includes("require('../../lib/arregloSensible')")
                && !fuente.includes("require('../arregloSensible')");
        });

        assert.deepEqual(sinCifrado, [],
            'estos escriben asignaciones/firmas/asistentes/trabajadores sin pasar por lib/arregloSensible.js');
    });

    test('ninguna entrada de `asignaciones[]` se arma fuera del constructor compartido', () => {
        // La huella del constructor artesanal: `fechaAsignacion` (campo propio de
        // una entrada de asignación) escrito a mano junto al resto. Solo
        // `lib/arregloSensible.js` tiene derecho a construir esa forma.
        const infractores = [];
        for (const rel of ESCRITORES) {
            const lineas = fs.readFileSync(path.join(RAIZ, rel), 'utf8').split('\n');
            lineas.forEach((linea, i) => {
                const limpia = linea.trim();
                if (limpia.startsWith('//') || limpia.startsWith('*')) return;
                if (/^fechaAsignacion:\s/.test(limpia)) {
                    infractores.push(`${rel}:${i + 1}  ${limpia}`);
                }
            });
        }

        assert.deepEqual(infractores, [],
            'usa construirAsignacion de lib/arregloSensible.js en vez de armar la asignación a mano');
    });
});
