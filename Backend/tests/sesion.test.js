// Contexto de sesión: la segunda llave del cierre por omisión.
//
// `conSesion()` es lo que impide que un handler quede abierto cuando su ruta se
// declaró sin autorizador. Si esta prueba se rompe, el cierre por omisión deja
// de existir aunque la configuración siga correcta.

const test = require('node:test');
const assert = require('node:assert');

const { conSesion, hashToken, tokenDelEvento } = require('../lib/auth/sesion');

const eventoCon = (contexto) => ({ requestContext: { authorizer: { lambda: contexto } } });

// ─── Cierre por omisión ──────────────────────────────────────────────────────

test('sin contexto del autorizador corta con 401', () => {
    // El caso que importa: una ruta que se declaró sin autorizador. El handler
    // no recibe contexto y debe negarse, no continuar con datos vacíos.
    const r = conSesion({});
    assert.equal(r.ok, false);
    assert.equal(r.respuesta.statusCode, 401);
});

test('con contexto vacío también corta', () => {
    assert.equal(conSesion(eventoCon({})).ok, false);
});

test('sin tenantId corta, aunque venga la persona', () => {
    // Media sesión no es sesión: sin empresa no se puede acotar ninguna consulta.
    assert.equal(conSesion(eventoCon({ personaId: 'p-1' })).ok, false);
});

test('sin personaId corta, aunque venga la empresa', () => {
    assert.equal(conSesion(eventoCon({ tenantId: 't-1' })).ok, false);
});

// ─── Camino feliz ────────────────────────────────────────────────────────────

test('con contexto completo devuelve la sesión', () => {
    const r = conSesion(eventoCon({
        sessionId: 's-1', personaId: 'p-1', tenantId: 't-1', rol: 'admin', permisos: 'a,b,c',
    }));
    assert.equal(r.ok, true);
    assert.equal(r.sesion.personaId, 'p-1');
    assert.equal(r.sesion.tenantId, 't-1');
    assert.deepEqual(r.sesion.permisos, ['a', 'b', 'c']);
});

test('los permisos vacíos no producen una lista con un elemento vacío', () => {
    const r = conSesion(eventoCon({ personaId: 'p-1', tenantId: 't-1', permisos: '' }));
    assert.deepEqual(r.sesion.permisos, []);
});

test('acepta el contexto sin envoltorio lambda', () => {
    // Según la configuración del autorizador el contexto llega en
    // `authorizer.lambda` o directo en `authorizer`. Ambas formas valen.
    const r = conSesion({ requestContext: { authorizer: { personaId: 'p-1', tenantId: 't-1' } } });
    assert.equal(r.ok, true);
});

// ─── El tenantId NO puede venir del cliente ──────────────────────────────────

test('el tenantId del cliente no influye en la sesión', () => {
    // El requisito central: aunque el llamante mande otra empresa por query o
    // por body, la sesión sigue siendo la del token.
    const evento = {
        ...eventoCon({ personaId: 'p-1', tenantId: 't-real' }),
        queryStringParameters: { tenantId: 't-ajeno' },
        body: JSON.stringify({ tenantId: 't-ajeno' }),
    };
    assert.equal(conSesion(evento).sesion.tenantId, 't-real');
});

// ─── Token ───────────────────────────────────────────────────────────────────

test('el hash del token es estable y no es el token', () => {
    const t = 'a'.repeat(64);
    assert.equal(hashToken(t), hashToken(t));
    assert.notEqual(hashToken(t), t);
    assert.equal(hashToken(t).length, 64);
});

test('tokens distintos dan hashes distintos', () => {
    assert.notEqual(hashToken('uno'), hashToken('dos'));
});

test('extrae el token del header Bearer', () => {
    assert.equal(tokenDelEvento({ headers: { authorization: 'Bearer abc123' } }), 'abc123');
    assert.equal(tokenDelEvento({ headers: { Authorization: 'Bearer abc123' } }), 'abc123');
});

test('sin header, con esquema equivocado o vacío devuelve null', () => {
    assert.equal(tokenDelEvento({}), null);
    assert.equal(tokenDelEvento({ headers: {} }), null);
    assert.equal(tokenDelEvento({ headers: { authorization: 'abc123' } }), null);
    assert.equal(tokenDelEvento({ headers: { authorization: 'Basic abc' } }), null);
    assert.equal(tokenDelEvento({ headers: { authorization: 'Bearer ' } }), null);
});
