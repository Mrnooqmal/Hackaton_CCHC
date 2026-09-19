// Con la contraseña inicial sin cambiar, la sesión no sirve para nada más.
//
// La contraseña de primer ingreso son los primeros cuatro dígitos del RUT, y es
// una decisión deliberada: en terreno mucha gente no tiene correo, y una
// contraseña aleatoria enviada por mail deja a media obra sin poder entrar. Esa
// decisión se sostiene sobre una sola condición —que esa credencial no habilite
// nada salvo reemplazarse— y esa condición es la que fijan estas pruebas.
//
// No era así. La restricción vivía en el router del frontend, o sea que no
// existía: con el token del primer ingreso, una llamada directa listaba el
// personal, leía documentos y pedía vales para firmar sin conexión. Se comprobó
// contra el ambiente de desarrollo antes de cerrarlo.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { conSesion, RUTAS_CON_CREDENCIAL_PROVISIONAL } = require('../lib/auth/sesion');

const evento = (metodo, ruta, { provisional }) => ({
    requestContext: {
        http: { method: metodo, path: ruta },
        authorizer: {
            lambda: {
                sessionId: 's-1',
                personaId: 'p-1',
                tenantId: 't-1',
                rol: 'admin',
                permisos: 'personas.ver,documentos.ver,firmas.crear',
                credencialProvisional: String(provisional),
            },
        },
    },
    rawPath: ruta,
});

test('con la contraseña inicial, solo se puede cambiar la contraseña', () => {
    const res = conSesion(evento('POST', '/auth/change-password', { provisional: true }));

    assert.equal(res.ok, true);
    assert.equal(res.sesion.credencialProvisional, true);
});

test('con la contraseña inicial, el resto del sistema está cerrado', () => {
    const rutas = [
        ['GET', '/personas'],
        ['GET', '/documents'],
        ['GET', '/obras'],
        ['GET', '/estructura/resumen'],
        // La peor de todas: con esto se obtienen vales para firmar sin conexión
        // a nombre propio, con una credencial que todavía es pública.
        ['POST', '/firmas/vales'],
        ['POST', '/personas/p-1/enrolamiento'],
    ];

    for (const [metodo, ruta] of rutas) {
        const res = conSesion(evento(metodo, ruta, { provisional: true }));
        assert.equal(res.ok, false, `${metodo} ${ruta} no debería estar permitido`);
        assert.equal(res.respuesta.statusCode, 403);
        assert.match(res.respuesta.body, /cambiar tu contraseña inicial/);
    }
});

test('una ruta nueva nace cerrada para la credencial provisional', () => {
    // La lista es de permitidos, no de prohibidos: lo que se agregue mañana al
    // sistema no queda accesible por olvidarse de esta regla.
    const res = conSesion(evento('POST', '/ruta/que/todavia/no/existe', { provisional: true }));

    assert.equal(res.ok, false);
    assert.equal(res.respuesta.statusCode, 403);
});

test('con la contraseña ya cambiada, nada de esto aplica', () => {
    for (const [metodo, ruta] of [['GET', '/personas'], ['POST', '/firmas/vales']]) {
        const res = conSesion(evento(metodo, ruta, { provisional: false }));
        assert.equal(res.ok, true);
        assert.equal(res.sesion.credencialProvisional, false);
    }
});

test('sin el dato en el contexto, la sesión es normal', () => {
    // Compatibilidad con sesiones resueltas por un autorizador anterior al
    // cambio: ausente el marcador, no se bloquea. El autorizador siempre lo
    // manda, y su caché dura 60 segundos.
    const ev = evento('GET', '/personas', { provisional: false });
    delete ev.requestContext.authorizer.lambda.credencialProvisional;

    assert.equal(conSesion(ev).ok, true);
});

test('la lista de permitidos es corta y explícita', () => {
    assert.deepEqual(
        [...RUTAS_CON_CREDENCIAL_PROVISIONAL].sort(),
        ['GET /auth/me', 'POST /auth/change-password', 'POST /auth/logout'],
        'agregar algo acá es ampliar lo que se puede hacer con una credencial pública',
    );
});
