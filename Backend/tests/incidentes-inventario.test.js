// El inventario de datos personales conoce todo lo que el módulo de incidentes
// escribe en el incidente.
//
// La retención (`lib/gobernanza/retencion.js`) anonimiza un incidente vencido quitando
// los campos de `camposPersonales`, y decide cuándo vence mirando las personas que
// devuelve `personasDe`. Un campo con texto libre o con un personaId que el inventario
// no conoce queda sin anonimizar (o no entra en el cálculo del plazo): el rediseño agregó
// medidas inmediatas, clasificación, cierre, reaperturas y quién creó o editó cada medida
// sin avisarle al inventario.
//
// Esta prueba crea casos completos por TODAS las rutas que escriben en el incidente y
// compara lo que quedó guardado con el inventario. Si alguien agrega un campo al
// repositorio, la prueba falla hasta que lo clasifique: como dato personal (con texto
// libre o personas) o como dato que se conserva (con su razón, acá abajo).

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
process.env.EVIDENCIA_BUCKET = process.env.EVIDENCIA_BUCKET || 'evidencia-de-prueba';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'PRUEBA_SIN_AWS';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'PRUEBA_SIN_AWS';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const { s3Client } = require('../lib/clients/s3');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { ObraService } = require('../lib/services/ObraService');
const { eventBus } = require('../lib/events/EventBus');
const { FUENTES } = require('../lib/gobernanza/inventario');
const incidentes = require('../handlers/incidents-module/handler');

const fuente = FUENTES.find((f) => f.tabla === 'INCIDENTS_TABLE');

/**
 * Campos del incidente que se CONSERVAN al anonimizar, cada uno con su razón. Son hechos
 * del caso (para los indicadores de accidentabilidad) o claves técnicas; ninguno tiene
 * texto libre ni nombra a una persona. Agregar uno acá es afirmar eso.
 */
const CONSERVADOS = {
    incidentId: 'clave',
    tenantId: 'empresa',
    obraId: 'obra',
    tipo: 'hecho: tipo de caso (indicadores)',
    clasificacion: 'hecho: hallazgo o incidente',
    gravedad: 'hecho: indicadores',
    diasPerdidos: 'hecho: indicadores',
    fecha: 'hecho: cuándo',
    hora: 'hecho: cuándo',
    estado: 'hecho: etapa del caso',
    altoPotencial: 'hecho: resultado del triaje (sí o no)',
    medidasVerificadas: 'hecho: sí o no',
    centroTrabajo: 'hecho: dónde (nombre de la obra o sector, no de una persona)',
    etapaConstructiva: 'hecho: catálogo',
    ubicacion: 'hecho: coordenadas del lugar',
    tipoHallazgo: 'hecho: catálogo (acción o condición)',
    origenReporte: 'hecho: por qué canal llegó',
    qrToken: 'clave técnica del código QR de la obra',
    fechaCierre: 'hecho: cuándo',
    informeDocumentId: 'clave de un documento',
    afectadoRutHmac: 'vínculo con la ficha de la persona afectada: lo usa la retención para encontrar sus incidentes (HMAC, no el RUT)',
    createdAt: 'hecho: cuándo',
    updatedAt: 'hecho: cuándo',
    anonimizadoEl: 'marca del propio proceso',
};

/** Campos donde aparecen personas que NO cuentan para el plazo de retención del caso. */
const PERSONAS_NO_INVOLUCRADAS = {
    viewedBy: 'quién abrió el caso: se quita al anonimizar, y sumarlos haría depender el plazo de cada lector',
    trabajador: 'reporte antiguo: guarda en el nombre el personaId de quien reporta (decisión 11 del documento); esa persona ya cuenta por `reportadoPor`, y el campo es texto libre en otros flujos',
};

let doble; let emitir; let consola; let enviarS3; let objetos;
let A; let obraA; let personas;

beforeEach(async () => {
    doble = crearDobleTablas(DynamoDBDocumentClient.prototype, esquemas, { proyecciones: true });
    emitir = eventBus.emit;
    eventBus.emit = async () => {};
    consola = { log: console.log, error: console.error, warn: console.warn };
    console.log = () => {}; console.error = () => {}; console.warn = () => {};
    objetos = new Map();
    enviarS3 = s3Client.send;
    s3Client.send = async function simulado(cmd) {
        if (cmd.constructor.name === 'HeadObjectCommand') {
            if (!objetos.has(cmd.input.Key)) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
            return objetos.get(cmd.input.Key);
        }
        return enviarS3.call(s3Client, cmd);
    };

    A = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    obraA = (await new ObraService().crear(A, { nombre: 'Edificio Los Robles' })).obraId;
    const svc = new PersonaService();
    const crear = async (rut, nombre, rol) => (await svc.crear(A, { rut, nombre, rol })).persona.personaId;
    personas = {
        gestora: await crear('12.345.678-5', 'Sara', 'supervisor'),
        prevencionista: await crear('9.876.543-3', 'Pedro', 'prevencionista'),
        responsable: await crear('15.555.555-6', 'Ana', 'supervisor'),
        otraResponsable: await crear('16.666.666-K', 'Luis', 'supervisor'),
        trabajadora: await crear('11.111.111-1', 'Rosa', 'trabajador'),
    };
    for (const p of [personas.gestora, personas.prevencionista, personas.responsable, personas.otraResponsable]) {
        doble.items('PERSONAS_TABLE').find((x) => x.personaId === p).estado = 'activo';
    }
});
afterEach(() => {
    s3Client.send = enviarS3;
    doble.restaurar();
    eventBus.emit = emitir;
    Object.assign(console, consola);
});

const GESTION = 'incidentes.reportar,incidentes.historial';
const PREVENCION = 'incidentes.reportar,incidentes.historial,incidentes.calificar_accidente';
const HUELLA = Buffer.alloc(32, 7).toString('base64');
const UUID = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e';

const pedir = (quien, metodo, ruta, body) => incidentes.incidentsHandler({
    rawPath: ruta, rawQueryString: '', headers: { host: 'api.test' }, queryStringParameters: null,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
        http: { method: metodo, path: ruta, sourceIp: '200.1.2.3' },
        authorizer: { lambda: { sessionId: 's', personaId: quien.personaId, tenantId: A, rol: 'x', permisos: quien.permisos, credencialProvisional: 'false' } },
    },
});
const gest = () => ({ personaId: personas.gestora, permisos: GESTION });
const prev = () => ({ personaId: personas.prevencionista, permisos: PREVENCION });
const trab = () => ({ personaId: personas.trabajadora, permisos: 'actividades.ver' });
const datos = (res) => JSON.parse(res.body).data;
const ok = (res, esperado = [200, 201]) => { assert.ok(esperado.includes(res.statusCode), res.body); return res; };
const hoyMas = (dias) => new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const subirPapel = async (quien, id, tipo) => {
    const paso1 = ok(await pedir(quien, 'POST', `/incidents/${id}/documents`, { tipo, fileType: 'application/pdf', checksumSha256: HUELLA, tamano: 2048 }));
    const { s3Key } = datos(paso1);
    objetos.set(s3Key, { ContentType: 'application/pdf', ContentLength: 2048, ChecksumSHA256: HUELLA, VersionId: 'v1' });
    ok(await pedir(quien, 'POST', `/incidents/${id}/documents/confirmar`, { s3Key, fileName: `${tipo}.pdf`, fechaDocumento: '2026-11-01' }));
};

/** Casos completos por todas las rutas que escriben en el incidente. */
async function crearCasos() {
    // 1. Un accidente con todo: clasificación, medidas antiguas (ya no se crean), papeles, foto,
    //    investigación, vistas, edición, cierre y reapertura.
    const a = datos(ok(await pedir(gest(), 'POST', '/incidents', {
        tipo: 'accidente', gravedad: 'grave', descripcion: 'Caída desde el andamio', obraId: obraA, centroTrabajo: 'Torre A',
        etapaConstructiva: 'Obra Gruesa', ubicacion: { lat: -33.4, lng: -70.6 }, medidasInmediatas: 'Se acordonó la zona',
        trabajador: { nombre: 'Juan Pérez', rut: '17.777.777-3', genero: 'masculino', cargo: 'Enfierrador' },
        realizadoPor: { personaId: personas.gestora, nombre: 'Sara', cargo: 'Supervisora' },
    }))).incidentId;
    ok(await pedir(prev(), 'PUT', `/incidents/${a}/triaje`, { tipo: 'accidente', gravedad: 'grave' }));
    ok(await pedir(prev(), 'PUT', `/incidents/${a}/triaje`, { tipo: 'accidente', gravedad: 'fatal' })); // deja `anteriores`
    // Las medidas ya no se crean por ninguna ruta, pero los casos anteriores las conservan (con su responsable
    // y quién las creó o editó) y el inventario tiene que seguir anonimizándolas y contando a esas personas.
    doble.items('INCIDENTS_TABLE').find((i) => i.incidentId === a).medidasCorrectivas = [{
        numero: 1, medida: 'Instalar baranda y red', causaRaiz: 'Sin protección', responsableId: personas.otraResponsable, responsableNombre: 'Luis',
        fechaMaxEjecucion: hoyMas(10), estado: 'pendiente', creadaPor: personas.gestora, creadaEn: '2026-11-01T12:00:00.000Z',
        editadaPor: personas.gestora, editadaEn: '2026-11-02T12:00:00.000Z',
    }];
    ok(await pedir(gest(), 'PUT', `/incidents/${a}/medidas/1`, { estado: 'completada' }));
    for (const tipo of ['diat', 'informe_investigacion', 'plan_medidas', 'constancia_aviso_autoridad']) await subirPapel(gest(), a, tipo);
    ok(await pedir(gest(), 'POST', `/incidents/${a}/evidencias`, { evidencias: [`tenants/${A}/incidentes/${a}/${UUID}.jpg`] }));
    ok(await pedir(gest(), 'POST', `/incidents/${a}/investigations`, { tipo: 'prevencionista', hallazgos: 'Sin arnés', recomendaciones: 'Capacitar', medidas: ['Arnés obligatorio'] }));
    await pedir(prev(), 'POST', `/incidents/${a}/viewed`, {});
    ok(await pedir(gest(), 'PUT', `/incidents/${a}`, {
        diasPerdidos: 4, medidasInmediatas: 'Se acordonó y se avisó', fechaCierre: '2026-11-30', informeDocumentId: 'doc-1',
        investigacionJefeDirecto: { investigador: 'Jefe', rolInvestigador: 'jefe_directo', hallazgos: 'x', recomendaciones: 'y', medidas: [] },
    }));
    ok(await pedir(prev(), 'PUT', `/incidents/${a}/cerrar`, { comentarioCierre: 'Medidas verificadas' }));
    ok(await pedir(prev(), 'PUT', `/incidents/${a}/reabrir`, { motivo: 'Faltó una medida' }));

    // 2. Un hallazgo: responsable y plazo, gobernanza, foto y cierre por gobernanza.
    const h = datos(ok(await pedir(trab(), 'POST', '/incidents', {
        clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: 'Baranda suelta', obraId: obraA,
        responsableId: personas.responsable, plazoRespuestaISO: hoyMas(5),
    }))).incidentId;
    ok(await pedir(gest(), 'PUT', `/incidents/${h}/gobernanza`, { estadoCierre: 'en_proceso', comentarioCierre: 'Se pidió la baranda' }));
    ok(await pedir(prev(), 'PUT', `/incidents/${h}/triaje`, { tipo: 'condicion_subestandar', responsableId: personas.otraResponsable, plazoRespuestaISO: hoyMas(6) }));
    ok(await pedir(trab(), 'POST', `/incidents/${h}/evidencias`, { evidencias: [`tenants/${A}/incidentes/${h}/${UUID}.png`] }));
    ok(await pedir(prev(), 'PUT', `/incidents/${h}/gobernanza`, { estadoCierre: 'cerrado', comentarioCierre: 'Reparada' }));

    // 3. Un reporte flash, y su completado (lee y escribe la traza, donde vive el reporte flash).
    const f = datos(ok(await pedir(gest(), 'POST', '/incidents', {
        clasificacion: 'incidente', tipo: 'incidente', esFlash: true, descripcionBreve: 'Caída leve', obraId: obraA, ubicacionReferencia: 'Piso 3',
        afectados: [{ nombre: 'Juan Pérez', rut: '17.777.777-3', cargo: 'Enfierrador' }],
    }))).incidentId;
    ok(await pedir(gest(), 'PUT', `/incidents/${f}/flash-completar`, {
        descripcion: 'Caída desde 2 metros', gravedad: 'grave', diasPerdidos: 3,
        trabajador: { nombre: 'Juan Pérez', rut: '17.777.777-3', cargo: 'Enfierrador' },
    }));
    ok(await pedir(prev(), 'PUT', `/incidents/${f}/calificar-accidente`, {}));

    return { a, h, f };
}

const incidentesGuardados = () => doble.items('INCIDENTS_TABLE').filter((i) => !String(i.incidentId).endsWith('#traza'));

test('el repositorio no escribe ningún campo del incidente que el inventario no haya clasificado', async () => {
    await crearCasos();
    const personal = new Set(fuente.camposPersonales);
    const vistos = new Set(incidentesGuardados().flatMap((i) => Object.keys(i)));
    const sinClasificar = [...vistos].filter((c) => !personal.has(c) && !(c in CONSERVADOS));
    assert.deepEqual(sinClasificar, [],
        'Campos que el repositorio escribe en el incidente y el inventario no conoce. Si tienen texto libre o nombran a una persona, '
        + 'agrégalos a `camposPersonales` en lib/gobernanza/inventario.js (y sus personaId a `personasDe`); si son un hecho del caso, '
        + 'agrégalos a CONSERVADOS en esta prueba con su razón.');
    // Los campos que el caso completo debe haber escrito: si la prueba deja de ejercitar una ruta, se nota.
    for (const esperado of ['medidasInmediatas', 'medidasCorrectivas', 'gobernanza', 'triaje', 'cierre', 'reaperturas', 'papeles', 'evidencias',
        'viewedBy', 'investigaciones', 'altoPotencial', 'medidasVerificadas']) {
        assert.ok(vistos.has(esperado), `la prueba no ejercitó la ruta que escribe \`${esperado}\``);
    }
    // Nada de lo personal puede quedar listado como conservado, ni al revés.
    assert.deepEqual(Object.keys(CONSERVADOS).filter((c) => personal.has(c)), []);
});

test('toda persona que aparece en el incidente, campo por campo, la devuelve `personasDe` (o está declarada como no involucrada)', async () => {
    await crearCasos();
    const ids = new Set(Object.values(personas));
    const dentro = (valor, fn) => {
        if (typeof valor === 'string') { if (ids.has(valor)) fn(valor); return; }
        if (valor instanceof Set || Array.isArray(valor)) { for (const v of valor) dentro(v, fn); return; }
        if (valor && typeof valor === 'object') for (const v of Object.values(valor)) dentro(v, fn);
    };
    const hallazgos = [];
    let personasVistas = 0;
    for (const it of incidentesGuardados()) {
        for (const [campo, valor] of Object.entries(it)) {
            const enCampo = new Set();
            dentro(valor, (id) => enCampo.add(id));
            if (enCampo.size === 0) continue;
            personasVistas += enCampo.size;
            if (campo in PERSONAS_NO_INVOLUCRADAS) continue;
            // Solo ese campo: así una persona que aparece en otro campo no tapa un hueco.
            const devueltas = new Set(fuente.personasDe({ [campo]: valor }, {}));
            for (const id of enCampo) if (!devueltas.has(id)) hallazgos.push(`${campo} → ${id}`);
        }
    }
    assert.ok(personasVistas > 10, `la prueba tiene que ver personas en varios campos (vio ${personasVistas})`);
    assert.deepEqual(hallazgos, [],
        'Personas que el repositorio guarda en el incidente y `personasDe` (lib/gobernanza/inventario.js) no cuenta: '
        + 'el caso vencería sin esperar a su plazo.');
});

test('los valores de sistema (sistema, QR-Publico) no cuentan como persona involucrada: el caso no queda sin vencer', () => {
    const personasDe = (it) => fuente.personasDe(it, {});
    assert.deepEqual(personasDe({ reportadoPor: 'QR-Publico' }), []);
    assert.deepEqual(personasDe({ reportadoPor: 'sistema', triaje: { clasificadoPor: 'sistema', anteriores: [{ clasificadoPor: 'QR-Publico' }] } }), []);
    assert.deepEqual(personasDe({ reportadoPor: 'p-1', createdAt: '2026-11-01T10:00:00.000Z' }), ['p-1']);
});

test('personasDe reúne a quienes actuaron sobre el caso: clasificó, cerró, reabrió, verificó, medidas y papeles', () => {
    const it = {
        reportadoPor: 'p-rep', createdAt: '2026-11-01T10:00:00.000Z', realizadoPor: { personaId: 'p-real' },
        gobernanza: { responsableId: 'p-resp', verificadoPor: 'p-verif' },
        triaje: { clasificadoPor: 'p-clas', anteriores: [{ clasificadoPor: 'p-clas-ant' }] },
        cierre: { cerradoPor: 'p-cierra' },
        reaperturas: [{ reabiertoPor: 'p-reabre', cierreAnterior: { cerradoPor: 'p-cierra-ant' } }],
        medidasCorrectivas: [{ responsableId: 'p-med', creadaPor: 'p-creo', editadaPor: 'p-edito' }],
        papeles: [{ subidoPor: 'p-subio' }],
    };
    assert.deepEqual(fuente.personasDe(it, {}).sort(), [
        'p-rep', 'p-real', 'p-resp', 'p-verif', 'p-clas', 'p-clas-ant', 'p-cierra', 'p-reabre', 'p-cierra-ant', 'p-med', 'p-creo', 'p-edito', 'p-subio',
    ].sort());
});
