// Aviso de privacidad (deber de información, Ley 21.719).
//
// El titular tiene que poder saber quién es el responsable, quién trata sus
// datos y dónde (las transferencias internacionales), qué datos y para qué,
// cuánto se guardan, sus derechos, los plazos y que puede reclamar ante la
// Agencia. El aviso se arma de las mismas fuentes que la retención y el registro
// de tratamientos: si una cambia, el aviso cambia con ella.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { avisoDePrivacidad, ENCARGADOS } = require('../lib/gobernanza/aviso');
const { FUENTES } = require('../lib/gobernanza/inventario');
const { FINALIDADES, BASES_SIN_CONSENTIMIENTO } = require('../lib/gobernanza/consentimiento');

test('cada categoría del inventario aparece, con su finalidad y su plazo de conservación', () => {
    const a = avisoDePrivacidad({ empresa: 'Constructora Uno' });
    assert.equal(a.tratamientos.length, FUENTES.length);
    for (const f of FUENTES) {
        const t = a.tratamientos.find((x) => x.categoria === f.nombre);
        assert.ok(t, f.nombre);
        assert.equal(t.finalidad, f.finalidad);
        assert.ok(t.conservacion && !/undefined/.test(t.conservacion), `${f.nombre}: plazo`);
    }
    assert.ok(a.tratamientos.some((t) => t.contieneSalud), 'dice qué categorías traen salud');
    assert.match(a.enElEquipo, /solo el servidor puede abrirlo/, 'lo que queda en el equipo para firmar sin señal');
    assert.match(a.enElEquipo, /12 horas/);
});

test('responsable, encargados y transferencias internacionales', () => {
    const a = avisoDePrivacidad({ empresa: 'Constructora Uno' });
    assert.equal(a.responsable.nombre, 'Constructora Uno');
    const aws = a.encargados.find((e) => /Amazon Web Services/.test(e.quien));
    assert.ok(aws && aws.transferenciaInternacional && /Estados Unidos/.test(aws.donde), 'el alojamiento en Estados Unidos se informa');
    const google = a.encargados.find((e) => /Google/.test(e.quien));
    assert.equal(google.soloConConsentimiento, 'dictado_voz_ia', 'Google solo con el consentimiento del dictado');
    assert.ok(FINALIDADES[google.soloConConsentimiento]);
    assert.equal(avisoDePrivacidad({}).responsable.nombre, 'Tu empleador', 'sin empresa no inventa un nombre');
});

test('bases, consentimientos, derechos, plazos y reclamo ante la Agencia', () => {
    const a = avisoDePrivacidad({ empresa: 'X', config: { plazoRespuestaDias: 30, prorrogaDias: 30, bloqueoDiasHabiles: 2 } });
    assert.equal(a.bases.length, BASES_SIN_CONSENTIMIENTO.length);
    assert.deepEqual(a.consentimientos.map((c) => c.finalidad).sort(), Object.keys(FINALIDADES).sort());
    for (const d of ['Acceso', 'Rectificación', 'Supresión', 'Oposición', 'Bloqueo', 'Revocar']) {
        assert.ok(a.derechos.some((x) => x.derecho.includes(d)), d);
    }
    assert.match(a.plazos.texto, /30 días corridos/);
    assert.match(a.plazos.texto, /2 días hábiles/);
    assert.match(a.plazos.texto, /gratuito/);
    assert.match(a.reclamo, /Agencia de Protección de Datos Personales/);
    assert.ok(a.version);
});

test('los plazos del aviso siguen la configuración de derechos', () => {
    const a = avisoDePrivacidad({ config: { plazoRespuestaDias: 20, prorrogaDias: 10, bloqueoDiasHabiles: 3 } });
    assert.deepEqual([a.plazos.respuestaDias, a.plazos.prorrogaDias, a.plazos.bloqueoDiasHabiles], [20, 10, 3]);
});

test('el registro de tratamientos usa los mismos textos que el aviso', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'registro-tratamientos.js'), 'utf8');
    assert.ok(s.includes("require('../lib/gobernanza/aviso')"));
    assert.ok(!/const PLAZO = \{/.test(s), 'sin copia propia de los plazos');
});

test('la ruta del titular entrega el aviso con la empresa de la sesión', async () => {
    const { PersonaService } = require('../lib/services/PersonaService');
    const { TenantService } = require('../lib/services/TenantService');
    const gp = PersonaService.prototype.getById;
    const gt = TenantService.prototype.getById;
    let empresaPedida = null;
    PersonaService.prototype.getById = async () => ({ personaId: 'p1', tenantId: 't-A' });
    TenantService.prototype.getById = async (id) => { empresaPedida = id; return { nombre: 'Constructora A' }; };
    try {
        const titular = require('../handlers/gobernanza/titular');
        const res = await titular.atender({
            rawPath: '/gobernanza/mis-datos/aviso',
            requestContext: { http: { method: 'GET', path: '/gobernanza/mis-datos/aviso' },
                authorizer: { lambda: { sessionId: 's', personaId: 'p1', tenantId: 't-A', rol: 'trabajador', permisos: '', credencialProvisional: 'false' } } },
            headers: {}, queryStringParameters: { tenantId: 't-B' },
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.equal(empresaPedida, 't-A', 'la empresa sale de la sesión, no de la consulta');
        assert.equal(JSON.parse(res.body).data.responsable.nombre, 'Constructora A');
    } finally {
        PersonaService.prototype.getById = gp;
        TenantService.prototype.getById = gt;
    }
});

test('un encargado nuevo tiene que decir dónde está', () => {
    for (const e of ENCARGADOS) {
        assert.ok(e.quien && e.que && e.donde, e.quien);
        assert.equal(typeof e.transferenciaInternacional, 'boolean', e.quien);
    }
});
