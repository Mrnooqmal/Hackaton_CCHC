// El PIN y la contraseña, guardados con una función de costo.
//
// Antes eran SHA-256 de una pasada sobre un texto predecible. Lo que estas
// pruebas fijan no es solo "ahora usamos scrypt", sino las tres propiedades por
// las que el cambio sirve de algo:
//
//   1. cada hash lleva adentro con qué se hizo, para que la PRÓXIMA migración no
//      sea un censo a ciegas;
//   2. lo guardado con el esquema viejo se sigue pudiendo verificar, y al
//      verificarse se avisa que hay que reemplazarlo —si no, el cambio deja
//      afuera a quien ya tenía credencial;
//   3. una pimienta que este despliegue no conoce NO se responde como
//      "credencial incorrecta": se falla. Esa es la misma degradación insegura
//      que acabamos de sacar del sistema, aplicada al peor lugar posible.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const PERSONA = 'p-1';
const OTRA_PERSONA = 'p-2';

// El módulo lee la pimienta y el costo del entorno en cada llamada, así que se
// pueden mover entre pruebas sin recargar nada.
const conEntorno = async (vars, fn) => {
    const previo = {};
    for (const [k, v] of Object.entries(vars)) {
        previo[k] = process.env[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    try {
        return await fn();
    } finally {
        for (const [k, v] of Object.entries(previo)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    }
};

// Costo mínimo: estas pruebas verifican el formato y las decisiones, no la
// lentitud. El costo real se mide contra la Lambda, no acá.
const BARATO = { CREDENCIAL_SCRYPT_LN: '10' };

const credenciales = require('../lib/credenciales');

// La pimienta se cachea por contenedor; entre pruebas se vacía a mano.
beforeEach(() => credenciales._olvidarPimienta());

// ─── Formato: el algoritmo viaja con el hash ─────────────────────────────────

test('el hash guarda con qué se hizo', async () => {
    await conEntorno(BARATO, async () => {
        const hash = await credenciales.hashear('1234', PERSONA);

        assert.match(hash, /^\$scrypt\$ln=10,r=8,p=1,pv=\d+\$/);

        const info = credenciales.describir(hash);
        assert.equal(info.algoritmo, 'scrypt');
        assert.deepEqual(info.params, { ln: 10, r: 8, p: 1 });
    });
});

test('el mismo secreto dos veces da dos hashes distintos', async () => {
    await conEntorno(BARATO, async () => {
        const a = await credenciales.hashear('1234', PERSONA);
        const b = await credenciales.hashear('1234', PERSONA);

        assert.notEqual(a, b, 'sal aleatoria por hash: dos PIN iguales no se ven iguales en la tabla');
        assert.ok((await credenciales.verificar('1234', a, PERSONA)).valido);
        assert.ok((await credenciales.verificar('1234', b, PERSONA)).valido);
    });
});

test('el secreto correcto entra y el incorrecto no', async () => {
    await conEntorno(BARATO, async () => {
        const hash = await credenciales.hashear('Contraseña-larga-1', PERSONA);

        assert.equal((await credenciales.verificar('Contraseña-larga-1', hash, PERSONA)).valido, true);
        assert.equal((await credenciales.verificar('Contraseña-larga-2', hash, PERSONA)).valido, false);
        assert.equal((await credenciales.verificar('', hash, PERSONA)).valido, false);
    });
});

test('el hash de una persona no sirve para otra', async () => {
    await conEntorno(BARATO, async () => {
        const hash = await credenciales.hashear('1234', PERSONA);

        assert.equal((await credenciales.verificar('1234', hash, OTRA_PERSONA)).valido, false);
    });
});

test('un hash corrupto o de otro formato no valida nada', async () => {
    await conEntorno(BARATO, async () => {
        for (const basura of ['', null, 'texto suelto', '$scrypt$mal$x$y', '$argon2id$v=19$m=1$x$y']) {
            assert.equal((await credenciales.verificar('1234', basura, PERSONA)).valido, false);
        }
    });
});

// ─── La migración que viene ──────────────────────────────────────────────────

test('lo guardado con el esquema viejo se verifica y se marca para reemplazo', async () => {
    await conEntorno({ ...BARATO, PIN_SALT: undefined }, async () => {
        // Exactamente lo que hay hoy en la tabla: SHA-256 de una pasada, con la
        // sal que nunca estuvo declarada y por lo tanto valía "undefined".
        const legado = crypto.createHash('sha256')
            .update(`1234-${PERSONA}-${process.env.PIN_SALT}`)
            .digest('hex');

        const res = await credenciales.verificar('1234', legado, PERSONA);

        assert.equal(res.valido, true, 'quien ya tiene credencial debe poder entrar');
        assert.equal(res.obsoleto, true, 'y su hash debe reemplazarse en ese mismo momento');
        assert.equal(res.motivo, 'sha256-legado');
        assert.equal((await credenciales.verificar('9999', legado, PERSONA)).valido, false);
    });
});

test('subir el costo marca lo anterior como obsoleto sin invalidarlo', async () => {
    const hashBarato = await conEntorno(BARATO, () => credenciales.hashear('1234', PERSONA));

    await conEntorno({ CREDENCIAL_SCRYPT_LN: '11' }, async () => {
        const res = await credenciales.verificar('1234', hashBarato, PERSONA);

        assert.equal(res.valido, true, 'el costo viejo sigue siendo válido: nadie queda afuera');
        assert.equal(res.obsoleto, true, 'pero se reemplaza al primer uso');
    });
});

// ─── La pimienta ─────────────────────────────────────────────────────────────

test('sin la pimienta, el hash no se puede probar', async () => {
    const conSecreto = await conEntorno(
        { ...BARATO, CREDENCIAL_PEPPER: 'secreto-del-servidor', CREDENCIAL_PEPPER_V: '1' },
        () => credenciales.hashear('1234', PERSONA),
    );

    assert.equal(credenciales.describir(conSecreto).pv, 1);

    // Un volcado de la tabla sin el secreto del servidor: los 10.000 PIN posibles
    // no alcanzan, porque falta un factor que no está en la tabla.
    await conEntorno({ ...BARATO, CREDENCIAL_PEPPER: 'otra-cosa', CREDENCIAL_PEPPER_V: '1' }, async () => {
        assert.equal((await credenciales.verificar('1234', conSecreto, PERSONA)).valido, false);
    });
});

test('una pimienta desconocida falla, no contesta "incorrecta"', async () => {
    const conSecreto = await conEntorno(
        { ...BARATO, CREDENCIAL_PEPPER: 'secreto-del-servidor', CREDENCIAL_PEPPER_V: '2' },
        () => credenciales.hashear('1234', PERSONA),
    );

    await conEntorno({ ...BARATO, CREDENCIAL_PEPPER: 'v3', CREDENCIAL_PEPPER_V: '3', CREDENCIAL_PEPPER_ANTERIORES: undefined }, async () => {
        await assert.rejects(
            () => credenciales.verificar('1234', conSecreto, PERSONA),
            (err) => err.codigo === 'PIMIENTA_DESCONOCIDA',
            'no se puede juzgar la credencial: decir que no coincide sería mentir',
        );
    });
});

test('rotar la pimienta deja entrar con la anterior y marca el reemplazo', async () => {
    const conV1 = await conEntorno(
        { ...BARATO, CREDENCIAL_PEPPER: 'pimienta-1', CREDENCIAL_PEPPER_V: '1' },
        () => credenciales.hashear('1234', PERSONA),
    );

    await conEntorno({
        ...BARATO,
        CREDENCIAL_PEPPER: 'pimienta-2',
        CREDENCIAL_PEPPER_V: '2',
        CREDENCIAL_PEPPER_ANTERIORES: '1:pimienta-1',
    }, async () => {
        const res = await credenciales.verificar('1234', conV1, PERSONA);
        assert.equal(res.valido, true);
        assert.equal(res.obsoleto, true);
    });
});

// ─── El ingreso reemplaza el hash viejo ──────────────────────────────────────

test('entrar con un hash del esquema viejo lo reemplaza en el momento', async () => {
    const { docClient } = require('../lib/clients/dynamodb');
    const auth = require('../handlers/auth/handler');

    await conEntorno({ ...BARATO, PIN_SALT: undefined }, async () => {
        const legado = crypto.createHash('sha256')
            .update(`Clave-vieja-1-${PERSONA}-${process.env.PIN_SALT}`)
            .digest('hex');

        const ficha = {
            PK: 'TENANT#t-1', SK: `PERSONA#${PERSONA}`,
            personaId: PERSONA, tenantId: 't-1',
            rut: '12.345.678-5', nombre: 'Juan', apellido: 'Pérez',
            rol: 'trabajador', estado: 'activo', tieneAccesoWeb: true,
            habilitado: true, passwordHash: legado,
        };

        const escrituras = [];
        const original = docClient.send;
        docClient.send = async (cmd) => {
            const nombre = cmd.constructor.name;
            if (nombre === 'ScanCommand') return { Items: [ficha] };
            if (nombre === 'UpdateCommand') { escrituras.push(cmd.input); return {}; }
            if (nombre === 'GetCommand') return { Item: ficha };
            return {};
        };

        try {
            const res = await auth.login({ body: JSON.stringify({ rut: '12.345.678-5', password: 'Clave-vieja-1' }), requestContext: { http: {} }, headers: {} });
            assert.equal(res.statusCode, 200, 'quien ya tenía contraseña entra igual');

            const rehasheo = escrituras.find((e) => JSON.stringify(e.ExpressionAttributeValues || {}).includes('$scrypt$'));
            assert.ok(rehasheo, 'y sale con el hash nuevo guardado, sin que se le pida nada');

            const nuevo = rehasheo.ExpressionAttributeValues[':ph'];
            assert.equal((await credenciales.verificar('Clave-vieja-1', nuevo, PERSONA)).valido, true);
            assert.equal((await credenciales.verificar('Clave-vieja-1', nuevo, PERSONA)).obsoleto, false);
        } finally {
            docClient.send = original;
        }
    });
});
