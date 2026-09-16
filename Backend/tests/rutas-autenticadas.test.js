// Ninguna ruta queda sin autenticación por descuido.
//
// Esta prueba es la primera de las dos llaves del cierre por omisión. Lee
// `serverless.yml` y exige que toda ruta HTTP declare el autorizador, salvo las
// que están en la lista blanca de abajo. Si alguien agrega un handler nuevo y se
// olvida del autorizador, la build falla antes de desplegar.
//
// La segunda llave es `conSesion()` en `lib/auth/sesion.js`: corta con 401 si el
// contexto del autorizador no llegó, aunque la ruta estuviera abierta. Una es
// para que el error se vea temprano; la otra para que, si igual se cuela, el
// endpoint quede cerrado y no abierto.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const YML = path.join(__dirname, '..', 'serverless.yml');

/**
 * Rutas deliberadamente públicas, con su razón.
 *
 * Agregar algo acá es una decisión de seguridad, no un trámite: obliga a
 * escribir por qué esa ruta puede responder sin sesión.
 */
const PUBLICAS = {
    'POST /auth/login': 'Emite la sesión. No puede exigir una.',
    'POST /auth/select-tenant': 'Segundo paso del login cuando la persona pertenece a varias empresas.',
    'POST /auth/forgot-password': 'Quien la usa, por definición, no puede autenticarse.',
    'POST /auth/reset-password': 'Se autentica con el token de un solo uso del correo.',
    'POST /auth/validate-token': 'Comprueba un token; el token es la credencial.',
    'GET /signatures/verify/{token}': 'Verificación pública de una firma. El token del enlace es la credencial.',
    'GET /tenants/validate': 'Alta de empresa: comprueba disponibilidad antes de que exista sesión.',
    'POST /tenants/setup': 'Crea la empresa y su primer administrador. Gateada por TENANT_SIGNUP_CODE.',
    'GET /personas/validate': 'Alta de empresa: valida el RUT del administrador antes de que exista sesión.',
};

/** Extrae cada ruta de `serverless.yml` y si declara autorizador. */
function rutasDeclaradas() {
    const lineas = fs.readFileSync(YML, 'utf8').split('\n');
    const rutas = [];

    for (let i = 0; i < lineas.length; i++) {
        if (lineas[i].trim() !== '- httpApi:') continue;

        let metodo = null;
        let ruta = null;
        let tieneAutorizador = false;

        // El bloque del evento son las líneas indentadas que siguen.
        for (let j = i + 1; j < lineas.length; j++) {
            const l = lineas[j];
            if (l.trim() === '' || !l.startsWith('          ')) break;
            const t = l.trim();
            if (t.startsWith('path:')) ruta = t.slice(5).trim();
            if (t.startsWith('method:')) metodo = t.slice(7).trim().toUpperCase();
            if (t.startsWith('authorizer:')) tieneAutorizador = true;
        }

        if (ruta) rutas.push({ id: `${metodo} ${ruta}`, ruta, metodo, tieneAutorizador });
    }
    return rutas;
}

test('el archivo de configuración se puede leer y tiene rutas', () => {
    const rutas = rutasDeclaradas();
    assert.ok(rutas.length > 50, `se esperaban más de 50 rutas, se encontraron ${rutas.length}`);
});

test('ninguna ruta queda sin autorizador fuera de la lista blanca', () => {
    const abiertas = rutasDeclaradas()
        .filter((r) => !r.tieneAutorizador)
        .filter((r) => !PUBLICAS[r.id])
        .map((r) => r.id);

    assert.deepEqual(
        abiertas,
        [],
        'Rutas sin autenticación y sin justificación declarada:\n  ' + abiertas.join('\n  ')
        + '\n\nSi la ruta debe ser pública, agrégala a PUBLICAS con su razón.'
    );
});

test('la lista blanca no contiene rutas que ya no existen', () => {
    // Una lista blanca que envejece deja permisos declarados sobre rutas
    // fantasma y esconde el tamaño real de la superficie pública.
    const ids = new Set(rutasDeclaradas().map((r) => r.id));
    const huerfanas = Object.keys(PUBLICAS).filter((id) => !ids.has(id));
    assert.deepEqual(huerfanas, [], `Rutas públicas declaradas que ya no existen: ${huerfanas.join(', ')}`);
});

test('las rutas públicas son pocas y conocidas', () => {
    // Un tope que obliga a justificar el crecimiento de la superficie pública.
    assert.ok(
        Object.keys(PUBLICAS).length <= 10,
        `La superficie pública creció a ${Object.keys(PUBLICAS).length} rutas. Revísala antes de subir el tope.`
    );
});

test('el endpoint de prueba de correo no vuelve a aparecer', () => {
    // Estuvo expuesto en producción: permitía disparar correos desde el
    // remitente verificado y registraba RUT y contraseña temporal en CloudWatch.
    const rutas = rutasDeclaradas().map((r) => r.ruta);
    assert.ok(!rutas.includes('/test-email'), '/test-email volvió a declararse');
});
