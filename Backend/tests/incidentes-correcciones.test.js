// Correcciones de la segunda revisión del módulo de incidentes.
//
//   1  cerrar desde la obra (Art. 71): mismo permiso, mismas reglas y misma escritura que el cierre del caso
//   2  retención: un nombre en `reportadoPor` (casos anteriores a la identidad desde la sesión) no ata al caso
//   3  reclasificar a hallazgo quita la gravedad
//   4  claves del formato anterior en los lotes de supresión y en la extensión de bloqueos
//   5  descarga: lista sin enlaces, enlace de un papel con su auditoría y el titular, nombre neutro (RFC 5987)
//   7  exportación para el titular: todos los roles del inventario; `realizadoPor` sale de la sesión
//  10  fotos: reintento ante un 409
//  11  elementos sin `updatedAt`
//  12  código muerto y módulo del servidor aparte del espejo
//  13  lectura de casos sin el repositorio completo; avisos en paralelo acotado

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
process.env.EVIDENCIA_BUCKET = process.env.EVIDENCIA_BUCKET || 'evidencia-de-prueba';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'PRUEBA_SIN_AWS';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'PRUEBA_SIN_AWS';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { ObraService } = require('../lib/services/ObraService');
const { RegistroService } = require('../lib/services/RegistroService');
const { eventBus } = require('../lib/events/EventBus');
const { fuente } = require('../lib/gobernanza/inventario');
const { planDeRetencion } = require('../lib/gobernanza/retencion');
const { construirExportacion } = require('../lib/gobernanza/exportacion');
const almacenamiento = require('../lib/almacenamiento');
const casos = require('../lib/casos');
const casosServidor = require('../lib/casos-servidor');
const { cargarTs } = require('./cargar-ts');
const incidentes = require('../handlers/incidents-module/handler');
const obras = require('../handlers/obras-module/handler');
const { IncidentsRepository } = require('../handlers/incidents-module/incidents.repository');

const raiz = path.join(__dirname, '..', '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

let doble; let emitir; let consola; let informes;
let A; let B; let obraA; let gestora; let prevencionista; let ajena;
let generarInforme;

beforeEach(async () => {
    doble = crearDobleTablas(DynamoDBDocumentClient.prototype, esquemas, { proyecciones: true });
    emitir = eventBus.emit;
    eventBus.emit = async () => {};
    consola = { log: console.log, error: console.error, warn: console.warn };
    console.log = () => {}; console.error = () => {}; console.warn = () => {};

    // Firmar el informe del Art. 71 (PIN, S3, documento) no es lo que se prueba acá: se cuenta cuántas veces se pide.
    informes = [];
    generarInforme = RegistroService.prototype.generarInformeInvestigacion;
    RegistroService.prototype.generarInformeInvestigacion = async function falso({ incident }) {
        informes.push(incident.incidentId);
        return { documentId: `doc-${informes.length}`, token: 't', hash: 'h', huella: {}, s3Key: null };
    };

    A = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    B = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    obraA = (await new ObraService().crear(A, { nombre: 'Edificio Los Robles' })).obraId;
    const svc = new PersonaService();
    gestora = (await svc.crear(A, { rut: '12.345.678-5', nombre: 'Sara', rol: 'supervisor' })).persona.personaId;
    prevencionista = (await svc.crear(A, { rut: '9.876.543-3', nombre: 'Pedro', rol: 'prevencionista' })).persona.personaId;
    ajena = (await svc.crear(B, { rut: '22.222.222-2', nombre: 'Otra', rol: 'prevencionista' })).persona.personaId;
});
afterEach(() => {
    RegistroService.prototype.generarInformeInvestigacion = generarInforme;
    doble.restaurar();
    eventBus.emit = emitir;
    Object.assign(console, consola);
});

const GESTION = 'incidentes.reportar,incidentes.historial';
const PREVENCION = 'incidentes.reportar,incidentes.historial,incidentes.calificar_accidente,obras.detalle';
const como = (personaId, permisos, tenantId = A) => ({ personaId, permisos, tenantId });
const gest = () => como(gestora, GESTION);
const prev = () => como(prevencionista, PREVENCION);
const lambda = (quien) => ({ sessionId: 's', personaId: quien.personaId, tenantId: quien.tenantId, rol: 'x', permisos: quien.permisos, credencialProvisional: 'false' });

const pedir = (quien, metodo, ruta, body) => incidentes.incidentsHandler({
    rawPath: ruta, rawQueryString: '', headers: { host: 'api.test' }, queryStringParameters: null,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method: metodo, path: ruta, sourceIp: '200.1.2.3' }, authorizer: { lambda: lambda(quien) } },
});
const pedirObra = (quien, ruta, body) => obras.obrasHandler({
    rawPath: ruta, headers: { host: 'api.test' }, queryStringParameters: null,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method: 'POST', path: ruta, sourceIp: '200.1.2.3' }, authorizer: { lambda: lambda(quien) } },
});
const datos = (res) => JSON.parse(res.body).data;
const guardado = (id) => doble.items('INCIDENTS_TABLE').find((i) => i.incidentId === id);

const crearAccidente = async (extra = {}) => {
    const res = await pedir(gest(), 'POST', '/incidents', {
        tipo: 'accidente', gravedad: 'grave', descripcion: 'Caída desde el andamio', obraId: obraA,
        trabajador: { nombre: 'Juan Pérez', rut: '17.777.777-3' }, ...extra,
    });
    assert.equal(res.statusCode, 201, res.body);
    return datos(res).incidentId;
};
const clasificar = async (id, cuerpo) => {
    const res = await pedir(prev(), 'PUT', `/incidents/${id}/triaje`, cuerpo);
    assert.equal(res.statusCode, 200, res.body);
};
const papel = (tipo) => ({ papelId: `p-${tipo}`, tipo, nombreArchivo: `${tipo}.pdf`, tipoMime: 'application/pdf', s3Key: `tenants/${A}/incidentes/x/papeles/${tipo}-1.pdf`, subidoPor: gestora, subidoEn: '2026-11-20T10:00:00.000Z' });

// ─── 1. Cerrar la investigación desde la obra ────────────────────────────────

const rutaCierre = (id) => `/obras/${obraA}/investigaciones/${id}/cerrar`;
const cerrarDesdeObra = (quien, id, extra = {}) => pedirObra(quien, rutaCierre(id), { firmante: { pin: '1234' }, ...extra });

test('cerrar desde la obra exige el permiso de quien clasifica: sin él, 403 y no se firma nada', async () => {
    const id = await crearAccidente();
    await clasificar(id, { tipo: 'accidente', gravedad: 'leve' });
    guardado(id).papeles = [papel('diat'), papel('plan_medidas')];
    const res = await cerrarDesdeObra(como(gestora, `${GESTION},obras.detalle`), id);
    assert.equal(res.statusCode, 403, res.body);
    assert.deepEqual(informes, [], 'el informe no se firmó');
    assert.notEqual(guardado(id).estado, 'cerrado');
    assert.equal(guardado(id).cierre, undefined);
});

test('cerrar desde la obra pasa por las mismas reglas: un caso sin clasificar o sin papeles responde 409 con lo que falta y no firma el informe', async () => {
    const id = await crearAccidente();
    const sinClasificar = await cerrarDesdeObra(prev(), id);
    assert.equal(sinClasificar.statusCode, 409, sinClasificar.body);
    assert.match(JSON.parse(sinClasificar.body).error, /Clasificar el reporte/);

    await clasificar(id, { tipo: 'accidente', gravedad: 'leve' });
    const sinPapeles = await cerrarDesdeObra(prev(), id);
    assert.equal(sinPapeles.statusCode, 409, sinPapeles.body);
    const { pendientes } = JSON.parse(sinPapeles.body);
    assert.ok(pendientes.some((p) => /DIAT/.test(p)) && pendientes.some((p) => /medidas correctivas/.test(p)), pendientes.join(' | '));
    assert.ok(!pendientes.some((p) => /Informe de investigación/.test(p)), 'el informe lo genera esta misma ruta');
    assert.deepEqual(informes, [], 'no se firmó ningún informe');
    assert.notEqual(guardado(id).estado, 'cerrado');
});

test('cerrar desde la obra, con el caso completo: firma el informe, cierra con `cierre` y enlaza el informe, que cuenta como investigación', async () => {
    const id = await crearAccidente();
    await clasificar(id, { tipo: 'accidente', gravedad: 'leve' });
    guardado(id).papeles = [papel('diat'), papel('plan_medidas')];
    assert.equal(casos.papelesRequeridos(guardado(id)).find((r) => r.clave === 'informe_investigacion').cumplido, false);

    const res = await cerrarDesdeObra(prev(), id);
    assert.equal(res.statusCode, 201, res.body);
    assert.deepEqual(informes, [id]);
    const g = guardado(id);
    assert.equal(g.estado, 'cerrado');
    assert.equal(g.informeDocumentId, 'doc-1');
    assert.ok(g.fechaCierre);
    assert.equal(g.cierre.cerradoPor, prevencionista);
    assert.match(g.cierre.comentario, /Art\. 71/, 'sin comentario en la petición, queda uno fijo que dice cómo se cerró');
    // El informe firmado es el informe de investigación del caso: en las reglas y en el resumen.
    assert.equal(casos.papelesRequeridos(g).find((r) => r.clave === 'informe_investigacion').cumplido, true);
    assert.equal(casosServidor.resumenDelCaso(g).informeInvestigacion, true);
    assert.deepEqual(casos.pendientesDeCierre({ ...g, estado: 'en_investigacion' }, 'x'), []);

    // Y reabrir lo deshecho tiene de dónde leer.
    const reabrir = await pedir(prev(), 'PUT', `/incidents/${id}/reabrir`, { motivo: 'Faltaba un testigo' });
    assert.equal(reabrir.statusCode, 200, reabrir.body);
    assert.equal(guardado(id).reaperturas[0].cierreAnterior.cerradoPor, prevencionista);
});

test('cerrar desde la obra usa el comentario de la petición si viene, no cierra dos veces y respeta la empresa', async () => {
    const id = await crearAccidente();
    await clasificar(id, { tipo: 'accidente', gravedad: 'leve' });
    guardado(id).papeles = [papel('diat'), papel('plan_medidas')];

    const ajeno = await cerrarDesdeObra(como(ajena, PREVENCION, B), id);
    assert.equal(ajeno.statusCode, 404, ajeno.body);
    const largo = await cerrarDesdeObra(prev(), id, { comentarioCierre: 'x'.repeat(casos.MAX_COMENTARIO_CIERRE + 1) });
    assert.equal(largo.statusCode, 400, largo.body);
    assert.deepEqual(informes, []);

    const ok = await cerrarDesdeObra(prev(), id, { comentarioCierre: 'Investigación terminada con el comité' });
    assert.equal(ok.statusCode, 201, ok.body);
    assert.equal(guardado(id).cierre.comentario, 'Investigación terminada con el comité');
    const otraVez = await cerrarDesdeObra(prev(), id);
    assert.equal(otraVez.statusCode, 409, otraVez.body);
    assert.deepEqual(informes, [id], 'el informe se firmó una sola vez');
});

test('cerrar desde la obra un hallazgo sin foto ni responsable también responde 409', async () => {
    const res = await pedir(gest(), 'POST', '/incidents', { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: 'Baranda suelta', obraId: obraA });
    const id = datos(res).incidentId;
    await clasificar(id, { tipo: 'condicion_subestandar' });
    const cierre = await cerrarDesdeObra(prev(), id);
    assert.equal(cierre.statusCode, 409, cierre.body);
    assert.notEqual(guardado(id).gobernanza?.estadoCierre, 'cerrado');
});

test('`incidentsRepo.update` ya no acepta cambiar el estado ni el cierre: solo `cerrar` los escribe', async () => {
    const id = await crearAccidente();
    await new IncidentsRepository().update(guardado(id), { estado: 'cerrado', fechaCierre: '2026-11-01', informeDocumentId: 'x', diasPerdidos: 3 });
    const g = guardado(id);
    assert.notEqual(g.estado, 'cerrado');
    assert.equal(g.fechaCierre, undefined);
    assert.equal(g.informeDocumentId, undefined);
    assert.equal(g.diasPerdidos, 3);
});

test('el informe Art. 71 cuenta como investigación igual en el espejo del frontend', () => {
    const E = cargarTs('casos.ts');
    const base = { tipo: 'accidente', clasificacion: 'incidente', gravedad: 'leve' };
    for (const inc of [base, { ...base, informeDocumentId: 'doc-1' }, { ...base, informeDocumentId: '  ' }, { ...base, informeDocumentId: null }]) {
        assert.deepEqual(E.papelesRequeridos(inc), casos.papelesRequeridos(inc));
    }
    assert.equal(E.papelesRequeridos({ ...base, informeDocumentId: 'doc-1' }).find((r) => r.clave === 'informe_investigacion').cumplido, true);
});

// ─── 2. Retención: reportadoPor con un nombre ────────────────────────────────

const personasDe = (it) => fuente('INCIDENTS_TABLE').personasDe(it, {});
const UUID = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e';

test('`reportadoPor` cuenta como persona solo si tiene forma de id, o si el caso es posterior al cambio de la identidad desde la sesión', () => {
    // Antes del 15 de septiembre de 2026 guardaba el nombre que escribía el cliente.
    assert.deepEqual(personasDe({ reportadoPor: 'Juan Pérez', createdAt: '2026-05-01T10:00:00.000Z' }), []);
    assert.deepEqual(personasDe({ reportadoPor: 'Juan Pérez' }), [], 'sin fecha, un nombre tampoco es una persona');
    assert.deepEqual(personasDe({ reportadoPor: UUID, createdAt: '2026-05-01T10:00:00.000Z' }), [UUID], 'un id con forma de persona cuenta aunque el caso sea antiguo');
    assert.deepEqual(personasDe({ reportadoPor: 'p-1', createdAt: '2026-09-15T00:00:00.000Z' }), ['p-1'], 'desde el cambio, es un id');
    assert.deepEqual(personasDe({ reportadoPor: 'Juan Pérez', createdAt: '2026-11-01T10:00:00.000Z' }), ['Juan Pérez'], 'posterior al cambio siempre es un id');
});

test('un caso antiguo con un nombre en `reportadoPor` vence con su única persona vigente; antes quedaba conservado para siempre', () => {
    const hoy = new Date('2032-06-01T12:00:00Z');
    const persona = { PK: 'TENANT#t', SK: 'PERSONA#a', personaId: 'a', estado: 'desvinculado', fechaTerminoVinculo: '2026-01-15T00:00:00Z', rutHmac: 'v1:a' };
    const caso = {
        incidentId: 'i1', tenantId: 't', afectadoRutHmac: 'v1:a', tipo: 'accidente', createdAt: '2026-03-01T10:00:00.000Z',
        reportadoPor: 'Juan Pérez', documentos: { diat: { s3Key: 'i1/documents/diat-x.pdf' } },
    };
    const plan = planDeRetencion({ personas: [persona], registros: { PERSONAS_TABLE: [persona], INCIDENTS_TABLE: [caso] }, hoy });
    const acciones = plan.acciones.filter((a) => a.tabla === 'INCIDENTS_TABLE');
    assert.equal(acciones.length, 1, 'el caso venció');
    assert.equal(acciones[0].accion, 'anonimizar');
    assert.deepEqual(plan.archivos.suprimir, ['i1/documents/diat-x.pdf']);
});

// ─── 3. Reclasificar a hallazgo ──────────────────────────────────────────────

test('clasificar un accidente como hallazgo quita la gravedad, y la anterior queda en el historial de la clasificación', async () => {
    const id = await crearAccidente({ gravedad: 'grave' });
    await clasificar(id, { tipo: 'accidente', gravedad: 'grave' });
    assert.equal(guardado(id).gravedad, 'grave');
    await clasificar(id, { tipo: 'condicion_subestandar' });
    const g = guardado(id);
    assert.equal(g.clasificacion, 'hallazgo');
    assert.ok(!('gravedad' in g), 'un hallazgo no lleva gravedad');
    assert.equal(g.triaje.anteriores.at(-1).gravedad, 'grave');
    // Ya no cuenta como un incidente grave pendiente de investigación.
    assert.equal(casosServidor.resumenDelCaso(g).gravedad, null);
    // Volver a incidente la pone de nuevo con la gravedad que se elija.
    await clasificar(id, { tipo: 'accidente', gravedad: 'leve' });
    assert.equal(guardado(id).gravedad, 'leve');
});

// ─── 4. Claves del formato anterior en la retención ──────────────────────────

test('almacenamiento reconoce las claves `{id}/documents/…` como del bucket de evidencia, y no confunde otras', () => {
    assert.equal(almacenamiento.esClaveAnteriorDeIncidente('i1/documents/diat-x.pdf'), true);
    assert.equal(almacenamiento.claseDeClave('i1/documents/diat-x.pdf'), almacenamiento.EVIDENCIA);
    assert.equal(almacenamiento.bucketDeClave('i1/documents/diat-x.pdf'), almacenamiento.bucketDeClave('tenants/t/documentos/a.pdf'));
    for (const no of ['tenants/t/documents/diat.pdf', 'a/b/documents/x.pdf', 'i1/documents/../x/diat.pdf', 'i1/documents/', '', null]) {
        assert.equal(almacenamiento.esClaveAnteriorDeIncidente(no), false, String(no));
    }
});

test('la lista de archivos del inventario no incluye una clave del formato anterior que es de otro incidente', () => {
    const f = fuente('INCIDENTS_TABLE');
    assert.deepEqual(f.archivosDe({ incidentId: 'i1', tenantId: 't', documentos: { diat: { s3Key: 'i1/documents/diat-x.pdf' } } }), ['i1/documents/diat-x.pdf']);
    assert.deepEqual(f.archivosDe({ incidentId: 'i1', tenantId: 't', documentos: { diat: { s3Key: 'i2/documents/diat-x.pdf' } } }), []);
});

// ─── 5. Descarga ─────────────────────────────────────────────────────────────

test('el nombre de descarga se codifica según RFC 5987 (incluye \' ( ) * !) y es neutro: tipo y fecha, no el nombre del archivo', () => {
    const { _interno } = require('../handlers/incidents-module/incidents.repository');
    assert.equal(_interno.codificarRfc5987("a'b(c)d*e!f g"), 'a%27b%28c%29d%2Ae%21f%20g');
    assert.equal(_interno.nombreDeDescarga({ tipo: 'diat', fechaDocumento: '2026-11-11', s3Key: 'tenants/t/incidentes/i/papeles/diat-1.PDF', nombreArchivo: 'DIAT de Pedro Soto.pdf' }), 'diat-2026-11-11.pdf');
    assert.equal(_interno.nombreDeDescarga({ tipo: 'inventado', subidoEn: '2026-11-20T10:00:00.000Z', s3Key: 'i/documents/x.pdf' }), 'documento-2026-11-20.pdf');
    assert.equal(_interno.nombreDeDescarga({ tipo: 'otro', fechaDocumento: "'; drop", s3Key: 'k' }), 'otro-sin-fecha.pdf');
    const cabecera = _interno.contentDispositionAdjunto("a'b.pdf");
    assert.equal(cabecera, "attachment; filename=\"a_b.pdf\"; filename*=UTF-8''a%27b.pdf");
});

test('el frontend pide el enlace al hacer clic en Descargar y no usa una URL de la lista', () => {
    const fuenteTsx = leer('Frontend', 'src', 'components', 'PapelesDelCaso.tsx');
    assert.match(fuenteTsx, /getEnlacePapel\(/);
    assert.doesNotMatch(fuenteTsx, /href=\{p\.url\}/);
    assert.doesNotMatch(leer('Frontend', 'src', 'api', 'incidents.api.ts'), /Enlace firmado de 15 minutos\.\s*\n\s*url: string/);
});

// ─── 7. Exportación para el titular ──────────────────────────────────────────

test('la exportación incluye los casos donde la persona figura en cualquier rol del inventario, sin datos de terceros', () => {
    const yo = 'p-yo';
    const caso = (incidentId, extra) => ({
        incidentId, tipo: 'accidente', fecha: '2026-10-01', gravedad: 'grave', diasPerdidos: 9, obraId: 'o-1', estado: 'cerrado',
        descripcion: 'Relato con nombres de terceros', createdAt: '2026-10-01T10:00:00.000Z', ...extra,
    });
    const registros = {
        INCIDENTS_TABLE: [
            caso('i-afectado', {}),
            caso('i-reporto', { reportadoPor: yo }),
            caso('i-clasifico', { triaje: { clasificadoPor: yo, anteriores: [] } }),
            caso('i-cerro', { cierre: { cerradoPor: yo } }),
            caso('i-reabrio', { reaperturas: [{ reabiertoPor: yo }] }),
            caso('i-verifico', { gobernanza: { verificadoPor: yo } }),
            caso('i-responsable', { gobernanza: { responsableId: yo } }),
            caso('i-papel', { papeles: [{ subidoPor: yo }] }),
            caso('i-ajeno', { reportadoPor: 'otra', cierre: { cerradoPor: 'otra' } }),
            { ...caso('i-traza#traza', {}), reportadoPor: yo },
        ],
    };
    const salida = construirExportacion({ persona: { personaId: yo, nombre: 'Yo' }, registros, incidentesAfectado: new Set(['i-afectado']) });
    const lista = salida.secciones.incidentes.datos;
    assert.deepEqual(lista.map((i) => i.incidentId).sort(), ['i-afectado', 'i-cerro', 'i-clasifico', 'i-papel', 'i-reabrio', 'i-reporto', 'i-responsable', 'i-verifico'].sort());
    const por = (id) => lista.find((i) => i.incidentId === id);
    assert.equal(por('i-afectado').participacion, 'persona afectada');
    assert.equal(por('i-afectado').diasPerdidos, 9);
    assert.equal(por('i-reporto').participacion, 'reportado por ti');
    assert.equal(por('i-cerro').participacion, 'participaste en el caso');
    assert.equal(por('i-cerro').diasPerdidos, undefined, 'los días perdidos son de la persona afectada');
    assert.ok(!JSON.stringify(lista).includes('Relato con nombres'), 'sin el relato');
});

test('`realizadoPor.personaId` sale de la sesión, no del cuerpo de la petición', async () => {
    const id = await crearAccidente({ realizadoPor: { personaId: 'otra-persona', nombre: 'Sara', cargo: 'Supervisora' } });
    assert.equal(guardado(id).realizadoPor.personaId, gestora);
    assert.equal(guardado(id).realizadoPor.nombre, 'Sara');
    const sin = await crearAccidente();
    assert.equal(guardado(sin).realizadoPor.personaId, gestora);
    assert.doesNotMatch(leer('Frontend', 'src', 'pages', 'IncidentReportar.tsx'), /realizadoPor: \{\s*personaId/);
});

// ─── 10. Fotos: reintento ante un 409 ────────────────────────────────────────

test('subirYAdjuntarFotos reintenta una vez, con las mismas claves, si adjuntar choca con otro cambio (409)', async () => {
    const llamadas = [];
    let respuestas = [{ success: false, codigo: 'CONFLICTO' }, { success: true }];
    const cliente = {
        incidentsApi: {
            uploadEvidence: async ({ fileName }) => ({ success: true, data: { uploadUrl: 'https://s3.test/x', uploadHeaders: {}, s3Key: `k-${fileName}` } }),
            agregarEvidencias: async (id, claves) => { llamadas.push([id, claves]); return respuestas.shift(); },
        },
    };
    const original = Module._load;
    Module._load = function (solicitud, padre, ...resto) {
        if (solicitud === '../api/client' && /subirFotos\.ts$/.test(padre?.filename || '')) return cliente;
        return original.call(this, solicitud, padre, ...resto);
    };
    const fetchOriginal = global.fetch;
    global.fetch = async () => ({ ok: true });
    try {
        const { subirYAdjuntarFotos } = cargarTs('subirFotos.ts');
        const fotos = [{ name: 'a.jpg', type: 'image/jpeg' }, { name: 'b.jpg', type: 'image/jpeg' }];
        const ok = await subirYAdjuntarFotos('i-1', fotos);
        assert.deepEqual(llamadas, [['i-1', ['k-a.jpg', 'k-b.jpg']], ['i-1', ['k-a.jpg', 'k-b.jpg']]]);
        assert.deepEqual(ok, { adjuntas: ['k-a.jpg', 'k-b.jpg'], sinAdjuntar: 0 });

        // Dos conflictos seguidos: no insiste más de una vez.
        llamadas.length = 0;
        respuestas = [{ success: false, codigo: 'CONFLICTO' }, { success: false, codigo: 'CONFLICTO' }, { success: true }];
        const falla = await subirYAdjuntarFotos('i-1', fotos);
        assert.equal(llamadas.length, 2);
        assert.deepEqual(falla, { adjuntas: [], sinAdjuntar: 2 });

        // Otro error no se reintenta.
        llamadas.length = 0;
        respuestas = [{ success: false, error: 'No tienes permiso' }];
        await subirYAdjuntarFotos('i-1', fotos);
        assert.equal(llamadas.length, 1);
    } finally {
        Module._load = original;
        global.fetch = fetchOriginal;
    }
});

test('agregarEvidencias usa el elemento que el handler ya leyó: no lo vuelve a leer', async () => {
    const id = await crearAccidente();
    const leido = guardado(id);
    const lecturas = [];
    const enviar = DynamoDBDocumentClient.prototype.send;
    DynamoDBDocumentClient.prototype.send = async function (cmd) {
        if (cmd.constructor.name === 'GetCommand' && cmd.input.TableName === 'INCIDENTS_TABLE') lecturas.push(cmd.input.Key);
        return enviar.call(this, cmd);
    };
    try {
        const clave = `tenants/${A}/incidentes/${id}/f1.jpg`;
        const r = await new IncidentsRepository().agregarEvidencias(leido, [clave]);
        assert.deepEqual(r.evidencias, [clave]);
        assert.deepEqual(lecturas, [], 'sin lectura repetida');
    } finally {
        DynamoDBDocumentClient.prototype.send = enviar;
    }
});

// ─── 11. Elementos sin updatedAt ─────────────────────────────────────────────

test('un incidente sin `updatedAt` se puede escribir con cada escritura del caso (y un doble que lo rechace como DynamoDB lo detecta)', async () => {
    const repo = new IncidentsRepository();
    const sinFecha = async () => {
        const id = await crearAccidente();
        delete guardado(id).updatedAt;
        return id;
    };

    // El doble rechaza un valor indefinido que la expresión usa, como DynamoDB.
    const id0 = await sinFecha();
    await assert.rejects(() => repo.dynamo.send(new UpdateCommand({
        TableName: 'INCIDENTS_TABLE', Key: { incidentId: id0 }, UpdateExpression: 'SET x = :u', ConditionExpression: 'updatedAt = :leido',
        ExpressionAttributeValues: { ':u': 1, ':leido': undefined },
    })), /not defined/);

    const a = await sinFecha();
    const actualizado = await repo.actualizarCaso(guardado(a), { diasPerdidos: 4 });
    assert.equal(actualizado.diasPerdidos, 4);
    assert.ok(actualizado.updatedAt, 'queda con fecha');
    // Con fecha, el bloqueo optimista sigue funcionando.
    await assert.rejects(() => repo.actualizarCaso({ ...guardado(a), updatedAt: '1999-01-01T00:00:00.000Z' }, { diasPerdidos: 5 }), /cambió/);

    const b = await sinFecha();
    const clave = `tenants/${A}/incidentes/${b}/f1.jpg`;
    assert.deepEqual((await repo.agregarEvidencias(guardado(b), [clave])).evidencias, [clave]);

    const c = await sinFecha();
    const s3 = require('../lib/clients/s3').s3Client;
    const enviarS3 = s3.send;
    s3.send = async () => ({ ContentType: 'application/pdf', ContentLength: 10, ChecksumSHA256: 'h', VersionId: 'v' });
    try {
        const { papel: p } = await repo.registrarPapel(guardado(c), { s3Key: `tenants/${A}/incidentes/${c}/papeles/diat-1.pdf`, tipo: 'diat', papelId: '1', nombreArchivo: 'd.pdf', personaId: gestora });
        assert.equal(p.tipo, 'diat');
        assert.equal(guardado(c).papeles.length, 1);
    } finally {
        s3.send = enviarS3;
    }
});

// ─── 12. Código muerto y módulos ─────────────────────────────────────────────

test('el handler de incidentes no deja código muerto: ni `esSupervisorOSuperior` ni marcas de edición', () => {
    const handler = leer('Backend', 'handlers', 'incidents-module', 'handler.js');
    assert.doesNotMatch(handler, /esSupervisorOSuperior/);
    assert.doesNotMatch(handler, /existing code/);
    assert.doesNotMatch(leer('Backend', 'handlers', 'personas-module', 'handler.js'), /let personas = await personaService\.listByTenant/);
});

test('`updateMedidaEstado` usa la lista de estados de lib/casos, y ClasificacionDelCaso las listas de utils/casos', () => {
    assert.doesNotMatch(leer('Backend', 'handlers', 'incidents-module', 'incidents.repository.js'), /estadosValidos/);
    const clasificacion = leer('Frontend', 'src', 'components', 'ClasificacionDelCaso.tsx');
    assert.match(clasificacion, /TIPOS_HALLAZGO, TIPOS_INCIDENTE/);
    assert.doesNotMatch(clasificacion, /const TIPOS:|const GRAVEDADES:/);
    assert.doesNotMatch(leer('Frontend', 'src', 'pages', 'Incidents.tsx'), /workersApi\.list\(\)/);
});

test('lib/casos.js solo tiene lo que espeja el frontend; lo del servidor está en lib/casos-servidor.js', () => {
    for (const nombre of ['resumenDelCaso', 'conMedidasNumeradas', 'conVistoPor', 'investigacionAnterior', 'evaluarCierre']) {
        assert.equal(casos[nombre], undefined, `${nombre} no va en casos.js`);
        assert.equal(typeof casosServidor[nombre], 'function', `${nombre} va en casos-servidor.js`);
    }
    const E = cargarTs('casos.ts');
    for (const nombre of ['resumenDelCaso', 'conMedidasNumeradas', 'conVistoPor']) assert.equal(E[nombre], undefined);
    assert.match(leer('Frontend', 'src', 'utils', 'casos.ts'), /tieneInforme/);
});

test('evaluarCierre: el mismo veredicto para cualquier ruta', () => {
    const { evaluarCierre } = casosServidor;
    const hallazgo = { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', triaje: {}, evidencias: ['k'], gobernanza: { responsableId: 'p', plazoRespuestaISO: '2026-12-01' } };
    assert.deepEqual(evaluarCierre(hallazgo, '  Listo  '), { comentario: 'Listo' });
    assert.equal(evaluarCierre(hallazgo, '').estado, 400);
    assert.equal(evaluarCierre(hallazgo, 'x'.repeat(casos.MAX_COMENTARIO_CIERRE + 1)).estado, 400);
    assert.equal(evaluarCierre({ ...hallazgo, gobernanza: { estadoCierre: 'cerrado' } }, 'x').estado, 409);
    const sinFoto = evaluarCierre({ ...hallazgo, evidencias: [] }, 'x');
    assert.equal(sinFoto.estado, 409);
    assert.deepEqual(sinFoto.pendientes, ['Falta: Al menos una foto del hallazgo.']);
    const accidente = { tipo: 'accidente', clasificacion: 'incidente', gravedad: 'leve', triaje: {}, papeles: [{ tipo: 'diat' }, { tipo: 'plan_medidas' }] };
    assert.equal(evaluarCierre(accidente, 'x').estado, 409, 'falta el informe');
    assert.deepEqual(evaluarCierre(accidente, 'x', { conInforme: true }), { comentario: 'x' });
});

// ─── 13. Lectura de casos y avisos ───────────────────────────────────────────

test('el panel del FUF lee los casos sin construir el repositorio de incidentes completo', () => {
    const estructura = leer('Backend', 'handlers', 'estructura-module', 'handler.js');
    assert.doesNotMatch(estructura, /IncidentsRepository/);
    assert.match(estructura, /casosDeLaEmpresa\(/);
});

test('el aviso a prevención llega a todos los destinatarios aunque uno falle, escribiendo en paralelo acotado', async () => {
    const svc = new PersonaService();
    const ids = [];
    for (let i = 0; i < 12; i++) {
        const rut = ((n) => {
            let suma = 0; let mult = 2;
            for (const d of String(n).split('').reverse()) { suma += Number(d) * mult; mult = mult === 7 ? 2 : mult + 1; }
            const r = 11 - (suma % 11);
            return `${n}-${r === 11 ? '0' : r === 10 ? 'K' : r}`;
        })(18000000 + i);
        const id = (await svc.crear(A, { rut, nombre: `Prev${i}`, rol: 'prevencionista' })).persona.personaId;
        doble.items('PERSONAS_TABLE').find((x) => x.personaId === id).estado = 'activo';
        ids.push(id);
    }
    const enviar = DynamoDBDocumentClient.prototype.send;
    let simultaneas = 0; let maxima = 0;
    DynamoDBDocumentClient.prototype.send = async function (cmd) {
        if (cmd.constructor.name === 'PutCommand' && cmd.input.TableName === 'INBOX_TABLE') {
            simultaneas++; maxima = Math.max(maxima, simultaneas);
            await new Promise((r) => setTimeout(r, 5));
            simultaneas--;
            if (cmd.input.Item.recipientId === ids[3]) throw Object.assign(new Error('caída'), { name: 'InternalServerError' });
        }
        return enviar.call(this, cmd);
    };
    try {
        await new IncidentsRepository().avisarPrevencion({ incidentId: 'i-aviso', tenantId: A, tipo: 'accidente', clasificacion: 'incidente', gravedad: 'leve', fecha: '2026-11-20', reportadoPor: gestora }, {});
    } finally {
        DynamoDBDocumentClient.prototype.send = enviar;
    }
    const recibieron = doble.items('INBOX_TABLE').map((m) => m.recipientId);
    for (const id of ids) assert.equal(recibieron.includes(id), id !== ids[3], id === ids[3] ? 'el que falló no recibió' : 'el resto sí recibió');
    assert.ok(maxima > 1 && maxima <= 5, `escrituras a la vez: ${maxima}`);
});
