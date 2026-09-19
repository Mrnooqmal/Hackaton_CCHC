// Aislamiento entre empresas — obras, estructura preventiva y empresa.
//
// Segundo tramo del mismo cierre que `aislamiento-tenant.test.js`. Las tres
// reglas son las mismas: dato de otra empresa → 404, actor desde la sesión,
// permiso exigido siempre (no solo cuando el cliente se identifica).
//
// El caso más grave de este tramo estaba en la configuración de la empresa: el
// módulo de tenants tomaba el `tenantId` del path sin compararlo con la sesión,
// así que cualquier usuario podía reescribir los ROLES de otra empresa — es
// decir, su control de acceso completo.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const obras = require('../handlers/obras-module/handler');
const estructura = require('../handlers/estructura-module/handler');
const empresa = require('../handlers/tenants-module/handler');

const EMPRESA_A = 't-empresa-a';
const EMPRESA_B = 't-empresa-b';

const PERMISOS_AMPLIOS = [
    'obras.ver', 'obras.crear', 'obras.detalle', 'empresa.ver', 'empresa.roles',
    'empresa.cargos', 'empresa.epp', 'empresa.identidad', 'cargos.gestionar',
].join(',');

const sesionDe = (tenantId, extra = {}) => ({
    requestContext: {
        authorizer: {
            lambda: {
                sessionId: 's-1',
                personaId: extra.personaId || 'p-a',
                tenantId,
                rol: extra.rol || 'jefe_obra',
                permisos: extra.permisos !== undefined ? extra.permisos : PERMISOS_AMPLIOS,
            },
        },
    },
});

const ev = (sesion, metodo, ruta, body) => ({
    ...sesion,
    requestContext: { ...sesion.requestContext, http: { method: metodo, path: ruta } },
    rawPath: ruta,
    queryStringParameters: null,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

let store;
let originalSend;

beforeEach(() => {
    store = { items: [], item: null, escrituras: [] };
    originalSend = docClient.send;
    docClient.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        if (nombre === 'GetCommand') {
            // Como DynamoDB: la lectura por clave resuelve contra lo que hay en
            // la tabla. Importa porque los índices ya no proyectan la ficha
            // entera y `getById` lee el índice y después la tabla.
            const k = cmd.input?.Key || {};
            const enTabla = (store.items || []).find((i) => i.PK === k.PK && i.SK === k.SK);
            return { Item: enTabla || store.item || undefined };
        }
        if (nombre === 'QueryCommand') return { Items: store.items };
        if (nombre === 'ScanCommand') return { Items: store.items };
        if (nombre === 'UpdateCommand') { store.escrituras.push(cmd.input); return { Attributes: store.item || store.items[0] }; }
        if (nombre === 'PutCommand') { store.escrituras.push(cmd.input); return {}; }
        if (nombre === 'DeleteCommand') { store.escrituras.push(cmd.input); return {}; }
        return {};
    };
});

afterEach(() => { docClient.send = originalSend; });

const obraItem = (tenantId, obraId) => ({
    PK: `TENANT#${tenantId}`, SK: `OBRA#${obraId}`,
    obraId, tenantId, nombre: 'Edificio Costanera', estado: 'activa',
    faseDeming: 'plan', etapaActual: 'excavacion',
});

// ─── Obras ───────────────────────────────────────────────────────────────────

test('una obra de otra empresa no se lee', async () => {
    store.items = [obraItem(EMPRESA_B, 'o-b')];

    const res = await obras.obrasHandler(ev(sesionDe(EMPRESA_A), 'GET', '/obras/o-b'));

    assert.equal(res.statusCode, 404);
    assert.doesNotMatch(res.body, /Costanera/, 'no se filtra el nombre de la obra ajena');
});

test('una obra de otra empresa no se edita (ni deja un registro fantasma)', async () => {
    // El detalle importante: la escritura usa `TENANT#<empresa de la sesión>` como
    // clave, así que sin comprobar pertenencia el update no fallaba — creaba una
    // obra nueva en la empresa propia con el id de la ajena.
    store.items = [obraItem(EMPRESA_B, 'o-b')];

    const res = await obras.obrasHandler(ev(sesionDe(EMPRESA_A), 'PUT', '/obras/o-b', { nombre: 'Renombrada' }));

    assert.equal(res.statusCode, 404);
    assert.equal(store.escrituras.length, 0);
});

test('sin permiso no se crea una obra, aunque no se mande creadorId', async () => {
    const res = await obras.obrasHandler(ev(
        sesionDe(EMPRESA_A, { rol: 'colaborador', permisos: 'obras.ver' }),
        'POST', '/obras', { nombre: 'Obra nueva' },
    ));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

test('sin permiso no se avanza la fase de una obra', async () => {
    store.items = [obraItem(EMPRESA_A, 'o-a')];

    const res = await obras.obrasHandler(ev(
        sesionDe(EMPRESA_A, { rol: 'colaborador', permisos: 'obras.ver' }),
        'POST', '/obras/o-a/avanzar-fase-deming',
    ));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

test('el registro AT/EP no se firma sin PIN', async () => {
    // Admitía `metodo: 'PRESENCIAL'`, que valida siempre, y el firmante venía en
    // el cuerpo: se podía emitir evidencia legal a nombre de cualquiera.
    store.items = [obraItem(EMPRESA_A, 'o-a')];

    const res = await obras.obrasHandler(ev(
        sesionDe(EMPRESA_A), 'POST', '/obras/o-a/registros/at-ep',
        { firmante: { personaId: 'el-gerente' }, metodo: 'PRESENCIAL' },
    ));

    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /PIN/);
    assert.equal(store.escrituras.length, 0);
});

test('no se genera un registro AT/EP sobre una obra ajena', async () => {
    store.items = [obraItem(EMPRESA_B, 'o-b')];

    const res = await obras.obrasHandler(ev(
        sesionDe(EMPRESA_A), 'POST', '/obras/o-b/registros/at-ep',
        { firmante: { personaId: 'p-a', pin: '1234' } },
    ));

    assert.equal(res.statusCode, 404);
    assert.equal(store.escrituras.length, 0);
});

// ─── Estructura preventiva ───────────────────────────────────────────────────

test('sin permiso no se constituye un órgano, aunque no se mande solicitanteId', async () => {
    // Antes `puedeAdministrar` devolvía true si el cuerpo no traía solicitante:
    // omitir el campo constituía o disolvía un comité paritario.
    const res = await estructura.estructuraHandler(ev(
        sesionDe(EMPRESA_A, { rol: 'colaborador', permisos: 'actividades.ver' }),
        'POST', '/estructura/organos', { tipo: 'CPHS', ambito: 'empresa' },
    ));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

test('sin permiso no se disuelve un órgano', async () => {
    const res = await estructura.estructuraHandler(ev(
        sesionDe(EMPRESA_A, { rol: 'colaborador', permisos: 'actividades.ver' }),
        'POST', '/estructura/organos/org-1/disolver', { motivo: 'porque sí' },
    ));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

test('sin permiso no se acredita a un miembro del órgano', async () => {
    const res = await estructura.estructuraHandler(ev(
        sesionDe(EMPRESA_A, { rol: 'colaborador', permisos: 'actividades.ver' }),
        'PUT', '/estructura/organos/org-1/miembros/m-1/acreditacion', { acreditacion: { cursoOpr: true } },
    ));

    assert.equal(res.statusCode, 403);
});

test('no se acredita un órgano con el acta de otra empresa', async () => {
    // El vínculo documental es lo que da por cumplido el requisito del FUF.
    store.item = { documentId: 'd-b', tenantId: EMPRESA_B, tipo: 'ACTA_REUNION_CPHS' };

    const res = await estructura.estructuraHandler(ev(
        sesionDe(EMPRESA_A), 'POST', '/estructura/organos/org-1/documentos',
        { clave: 'actaConstitucion', documentoId: 'd-b' },
    ));

    assert.equal(res.statusCode, 404);
    assert.equal(store.escrituras.length, 0);
});

test('sin sesión no se responde nada de la estructura preventiva', async () => {
    const res = await estructura.estructuraHandler({
        requestContext: { http: { method: 'GET' } }, rawPath: '/estructura/organos',
    });

    assert.equal(res.statusCode, 401);
});

// ─── Empresa ─────────────────────────────────────────────────────────────────

test('la configuración de otra empresa no se lee', async () => {
    store.item = { PK: `TENANT#${EMPRESA_B}`, tenantId: EMPRESA_B, nombre: 'Constructora Rival' };

    const res = await empresa.tenantsHandler(ev(sesionDe(EMPRESA_A), 'GET', `/tenants/${EMPRESA_B}`));

    assert.equal(res.statusCode, 404);
    assert.doesNotMatch(res.body, /Rival/);
});

test('los roles de otra empresa no se reescriben', async () => {
    // El peor caso del módulo: `roles` ES el control de acceso de esa empresa.
    const res = await empresa.tenantsHandler(ev(
        sesionDe(EMPRESA_A), 'PUT', `/tenants/${EMPRESA_B}`,
        { roles: [{ id: 'admin', nombre: 'Administrador', permisos: ['*'] }] },
    ));

    assert.equal(res.statusCode, 404);
    assert.equal(store.escrituras.length, 0);
});

test('sin el permiso de roles no se tocan los roles de la propia empresa', async () => {
    const res = await empresa.tenantsHandler(ev(
        sesionDe(EMPRESA_A, { rol: 'supervisor', permisos: 'empresa.ver' }),
        'PUT', `/tenants/${EMPRESA_A}`,
        { roles: [{ id: 'colaborador', nombre: 'Colaborador', permisos: [] }] },
    ));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

test('el catálogo de EPP de otra empresa no se modifica', async () => {
    const res = await empresa.tenantsHandler(ev(
        sesionDe(EMPRESA_A), 'POST', `/tenants/${EMPRESA_B}/epp`, { nombre: 'Casco' },
    ));

    assert.equal(res.statusCode, 404);
    assert.equal(store.escrituras.length, 0);
});

test('el listado de empresas devuelve solo la propia', async () => {
    // Devolvía todas las empresas de la plataforma —nombre, RUT y dotación— a
    // cualquier sesión.
    store.item = { PK: `TENANT#${EMPRESA_A}`, SK: `METADATA#${EMPRESA_A}`, tenantId: EMPRESA_A, nombre: 'Constructora Propia' };

    const res = await empresa.tenantsHandler(ev(sesionDe(EMPRESA_A), 'GET', '/tenants'));

    const { data } = JSON.parse(res.body);
    assert.equal(data.total, 1);
    assert.equal(data.tenants[0].tenantId, EMPRESA_A);
});

test('sin sesión no se responde nada de la empresa', async () => {
    const res = await empresa.tenantsHandler({
        requestContext: { http: { method: 'GET' } }, rawPath: '/tenants',
    });

    assert.equal(res.statusCode, 401);
});
