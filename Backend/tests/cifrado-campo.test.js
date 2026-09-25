// Cifrado de campo (D-10): RUT buscable por HMAC, sobre de cifrado para todo
// lo demás. Lo que fijan estas pruebas:
//
//   1. el RUT y la salud NUNCA se escriben en claro en la tabla;
//   2. el RUT se busca por su HMAC, determinista, sin descifrar nada;
//   3. una ficha legada (RUT en claro, sin migrar) se sigue leyendo igual —
//      "leer y reparar", sin script de migración;
//   4. la llave de datos es por EMPRESA, no por persona ni por valor: dos
//      altas simultáneas en un tenant nuevo no crean dos llaves distintas;
//   5. restriccionLaboral se cifra IGUAL cuando es `null`, no solo cuando
//      tiene contenido — el mismo patrón de falla silenciosa que ya se evitó
//      en las respuestas de encuesta, aplicado acá.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.TENANTS_TABLE = 'tenants-prueba-cifrado';
process.env.PERSONAS_TABLE = 'personas-prueba-cifrado';
process.env.CREDENCIAL_SCRYPT_LN = '10';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { crearTablaTenants } = require('./doble-tabla-tenants');

const { docClient } = require('../lib/clients/dynamodb');
const cifradoCampo = require('../lib/cifradoCampo');
const llaveTenant = require('../lib/llaveTenant');
const { PersonaService } = require('../lib/services/PersonaService');

// ─── El módulo de cifrado, aislado ───────────────────────────────────────────

describe('cifradoCampo', () => {
    test('el HMAC del RUT es determinista', async () => {
        const a = await cifradoCampo.hmacRut('12.345.678-5');
        const b = await cifradoCampo.hmacRut('12.345.678-5');
        assert.equal(a, b);
    });

    test('el HMAC no distingue formato: con puntos, sin puntos, minúscula', async () => {
        const variantes = ['12.345.678-5', '12345678-5', '12.345.678-5'.toLowerCase()];
        const hmacs = await Promise.all(variantes.map((r) => cifradoCampo.hmacRut(r)));
        assert.equal(new Set(hmacs).size, 1, 'el mismo RUT en distinto formato da el mismo HMAC');
    });

    test('RUT distintos dan HMAC distintos', async () => {
        const a = await cifradoCampo.hmacRut('12.345.678-5');
        const b = await cifradoCampo.hmacRut('98.765.432-1');
        assert.notEqual(a, b);
    });

    test('el sobre no expone el valor en claro en ninguno de sus campos', async () => {
        const sobre = await cifradoCampo.cifrarSobre('12.345.678-5');
        const serializado = JSON.stringify(sobre);
        assert.equal(serializado.includes('12.345.678-5'), false);
    });

    test('cifrar y descifrar un sobre da el valor original', async () => {
        const sobre = await cifradoCampo.cifrarSobre({ dato: 'algo sensible' });
        const claro = await cifradoCampo.descifrarSobre(sobre);
        assert.deepEqual(claro, { dato: 'algo sensible' });
    });

    test('cifrarConLlaveDatos: null es "nada que cifrar", no produce sobre', async () => {
        const { plaintext } = await cifradoCampo.generarLlaveReutilizable();
        assert.equal(cifradoCampo.cifrarConLlaveDatos(null, plaintext), null);
    });

    test('cifrarConLlaveDatosSiempre: null SÍ produce un sobre real', async () => {
        const { plaintext } = await cifradoCampo.generarLlaveReutilizable();
        const sobre = cifradoCampo.cifrarConLlaveDatosSiempre(null, plaintext);
        assert.ok(sobre && sobre.c, 'hay un sobre de verdad, no null');
        assert.equal(cifradoCampo.descifrarConLlaveDatosSiempre(sobre, plaintext), null);
    });

    test('una llave reutilizable cifra y descifra muchos valores sin volver a KMS', async () => {
        const { plaintext } = await cifradoCampo.generarLlaveReutilizable();
        const valores = Array.from({ length: 50 }, (_, i) => ({ i }));
        const sobres = valores.map((v) => cifradoCampo.cifrarConLlaveDatos(v, plaintext));
        const descifrados = sobres.map((s) => cifradoCampo.descifrarConLlaveDatos(s, plaintext));
        assert.deepEqual(descifrados, valores);
    });
});

// ─── La llave compartida por tenant ──────────────────────────────────────────

describe('llaveTenant', () => {
    let tabla;
    let originalSend;

    const claveDeMetadata = (tenantId) => `TENANT#${tenantId}#METADATA#${tenantId}`;

    beforeEach(() => {
        llaveTenant._olvidarCache();
        // Las empresas que estas pruebas usan ya existen: una llave se pide para
        // una empresa dada de alta, nunca para una que no está.
        tabla = crearTablaTenants(['t-1', 't-2', 't-nuevo']);
        originalSend = docClient.send;
        docClient.send = async (cmd) => tabla.responder(cmd) ?? {};
    });

    afterEach(() => { docClient.send = originalSend; });

    test('la primera vez que un tenant necesita la llave, se crea y se guarda', async () => {
        const llave = await llaveTenant.llaveDeTenant('t-1', llaveTenant.PROPOSITOS.RUT_PERSONAS);
        assert.ok(Buffer.isBuffer(llave));
        assert.equal(tabla.escrituras.length, 1, 'una escritura: la creación');
    });

    test('la segunda vez, se reutiliza la que ya existe (sin nueva escritura)', async () => {
        const a = await llaveTenant.llaveDeTenant('t-1', llaveTenant.PROPOSITOS.RUT_PERSONAS);
        llaveTenant._olvidarCache(); // simula otra invocación (contenedor distinto)
        const b = await llaveTenant.llaveDeTenant('t-1', llaveTenant.PROPOSITOS.RUT_PERSONAS);

        assert.deepEqual(a, b, 'misma llave');
        assert.equal(tabla.escrituras.length, 1, 'no se crea una segunda vez');
    });

    test('tenants distintos pasan por su propia escritura, no comparten fila', async () => {
        // Con la vía de escape de pruebas (CAMPO_CIFRADO_LOCAL_KEY) toda llave
        // "desenvuelta" es la misma llave del entorno —así puede funcionar sin
        // tocar KMS—, así que acá no se compara la llave en sí (eso lo
        // garantiza KMS en producción: `GenerateDataKey` genera una por
        // llamada) sino que cada tenant tiene su propia fila y su propia
        // escritura, independiente de la del otro.
        await llaveTenant.llaveDeTenant('t-1', llaveTenant.PROPOSITOS.RUT_PERSONAS);
        llaveTenant._olvidarCache();
        await llaveTenant.llaveDeTenant('t-2', llaveTenant.PROPOSITOS.RUT_PERSONAS);

        assert.equal(tabla.escrituras.length, 2, 'una creación por tenant, no una compartida');
        assert.ok(tabla.filas.get(claveDeMetadata('t-1'))?.rutPersonasDataKey);
        assert.ok(tabla.filas.get(claveDeMetadata('t-2'))?.rutPersonasDataKey);
    });

    test('RUT y salud son atributos distintos en la fila del tenant', async () => {
        await llaveTenant.llaveDeTenant('t-1', llaveTenant.PROPOSITOS.RUT_PERSONAS);
        await llaveTenant.llaveDeTenant('t-1', llaveTenant.PROPOSITOS.SALUD);

        const fila = tabla.filas.get(claveDeMetadata('t-1'));
        assert.ok(fila.rutPersonasDataKey);
        assert.ok(fila.saludDataKey);
        assert.equal(tabla.escrituras.length, 2, 'dos llaves, dos escrituras');
    });

    test('dos altas simultáneas en un tenant nuevo no crean dos llaves', async () => {
        // La condición del UpdateCommand hace que la segunda pierda la carrera
        // y relea la que ganó, en vez de que cada una cifre con una llave
        // distinta que la otra no reconoce.
        const [a, b] = await Promise.all([
            llaveTenant.llaveDeTenant('t-nuevo', llaveTenant.PROPOSITOS.RUT_PERSONAS),
            llaveTenant.llaveDeTenant('t-nuevo', llaveTenant.PROPOSITOS.RUT_PERSONAS),
        ]);
        assert.deepEqual(a, b);
    });

    test('pedir la llave de una empresa que NO existe falla, y no escribe nada', async () => {
        // Antes seguía de largo y el UpdateCommand —un upsert— fabricaba un
        // `TENANT#<id>` fantasma con solo las llaves adentro. Así apareció
        // `TENANT#default` en dev, que `TenantService.listAll()` levanta como
        // si fuera una empresa.
        await assert.rejects(
            () => llaveTenant.llaveDeTenant('no-existe', llaveTenant.PROPOSITOS.RUT_PERSONAS),
            (err) => err.codigo === 'TENANT_INEXISTENTE'
        );
        assert.equal(tabla.escrituras.length, 0, 'ninguna escritura: no se crea una empresa por la puerta de atrás');
        assert.equal(tabla.filas.get(claveDeMetadata('no-existe')), undefined);
    });

    test('si la empresa se borra entre la lectura y la creación, tampoco resucita', async () => {
        // La carrera que cubre `attribute_exists(PK)`: la lectura la ve, pero
        // cuando llega la escritura ya no está.
        const original = tabla.responder;
        let lecturas = 0;
        docClient.send = async (cmd) => {
            if (cmd.constructor.name === 'GetCommand' && ++lecturas === 1) {
                const r = original(cmd);
                tabla.filas.delete(claveDeMetadata('t-1')); // se borra justo después
                return r;
            }
            return original(cmd) ?? {};
        };

        await assert.rejects(
            () => llaveTenant.llaveDeTenant('t-1', llaveTenant.PROPOSITOS.RUT_PERSONAS),
            (err) => err.codigo === 'TENANT_INEXISTENTE'
        );
        assert.equal(tabla.filas.get(claveDeMetadata('t-1')), undefined, 'la empresa borrada no reaparece');
    });

    test('un propósito que no es RUT_PERSONAS ni SALUD, se rechaza', async () => {
        await assert.rejects(() => llaveTenant.llaveDeTenant('t-1', 'rutPersonasDataKey_mal_escrito'));
    });
});

// ─── PersonaService: nunca en claro, buscable por HMAC, legado sigue leyendo ─

describe('PersonaService con cifrado de campo', () => {
    let tablaTenants;
    let personasAlmacen;
    let originalSend;

    beforeEach(() => {
        llaveTenant._olvidarCache();
        tablaTenants = crearTablaTenants(['t-1', 't-2', 't-lote']);
        personasAlmacen = [];
        originalSend = docClient.send;
        docClient.send = async (cmd) => {
            const nombre = cmd.constructor.name;
            const input = cmd.input || {};
            const tabla = input.TableName || '';

            if (tabla.includes('tenants-prueba-cifrado')) {
                return tablaTenants.responder(cmd) ?? {};
            }
            if (tabla.includes('personas-prueba-cifrado')) {
                if (nombre === 'PutCommand') { personasAlmacen.push(input.Item); return {}; }
                if (nombre === 'QueryCommand' && input.IndexName === 'tenantRutHmac-index') {
                    const items = personasAlmacen.filter((p) => p.tenantId === input.ExpressionAttributeValues[':tenantId']
                        && p.rutHmac === input.ExpressionAttributeValues[':h']);
                    return { Items: items.map((p) => ({ PK: p.PK, SK: p.SK })) };
                }
                if (nombre === 'QueryCommand' && input.IndexName === 'personaId-index') {
                    const items = personasAlmacen.filter((p) => p.personaId === input.ExpressionAttributeValues[':personaId']);
                    return { Items: items.map((p) => ({ PK: p.PK, SK: p.SK })) };
                }
                if (nombre === 'QueryCommand') {
                    // PK + prefijo (listByTenant)
                    const pk = input.ExpressionAttributeValues[':pk'];
                    return { Items: personasAlmacen.filter((p) => p.PK === pk) };
                }
                if (nombre === 'GetCommand') {
                    return { Item: personasAlmacen.find((p) => p.PK === input.Key.PK && p.SK === input.Key.SK) };
                }
                if (nombre === 'UpdateCommand') {
                    const idx = personasAlmacen.findIndex((p) => p.PK === input.Key.PK && p.SK === input.Key.SK);
                    if (idx === -1) return { Attributes: null };
                    // Aplica cada `#campo = :campo` de la expresión contra el
                    // ítem guardado, igual que haría DynamoDB.
                    const asignaciones = [...input.UpdateExpression.matchAll(/#(\w+) = :(\w+)/g)];
                    const actualizado = { ...personasAlmacen[idx] };
                    for (const [, campo, valorKey] of asignaciones) {
                        actualizado[input.ExpressionAttributeNames[`#${campo}`]] = input.ExpressionAttributeValues[`:${valorKey}`];
                    }
                    personasAlmacen[idx] = actualizado;
                    return { Attributes: actualizado };
                }
            }
            return {};
        };
    });

    afterEach(() => { docClient.send = originalSend; });

    test('crear(): el RUT nunca queda en la tabla en claro', async () => {
        await new PersonaService().crear('t-1', {
            rut: '12.345.678-5', nombre: 'Juan', apellidoPaterno: 'Pérez', rol: 'trabajador',
        });

        assert.equal(personasAlmacen.length, 1);
        const guardado = personasAlmacen[0];
        assert.equal(guardado.rut, undefined, 'no hay un campo `rut` en el ítem guardado');
        assert.ok(guardado.rutCifrado, 'hay un sobre cifrado');
        assert.ok(guardado.rutHmac, 'y un HMAC para buscar');
        assert.equal(JSON.stringify(guardado).includes('12.345.678-5'), false, 'el RUT no aparece en ningún lado del ítem');
    });

    test('crear(): la salud tampoco queda en claro, incluida la restricción null', async () => {
        await new PersonaService().crear('t-1', { rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador' });

        const guardado = personasAlmacen[0];
        assert.equal(guardado.vigilanciaSalud, undefined);
        assert.equal(guardado.restriccionLaboral, undefined);
        assert.ok(guardado.vigilanciaSaludCifrada);
        assert.ok(guardado.restriccionLaboralCifrada, 'incluso siendo null, hay un sobre real');
    });

    test('getByRut encuentra a la persona por su RUT, ya descifrado en memoria', async () => {
        const { persona: creada } = await new PersonaService().crear('t-1', {
            rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador',
        });

        const encontrada = await new PersonaService().getByRut('t-1', '12.345.678-5');

        assert.equal(encontrada.personaId, creada.personaId);
        assert.equal(encontrada.rut, '12.345.678-5');
    });

    test('el mismo RUT en otro tenant no se confunde: cada empresa busca en lo suyo', async () => {
        await new PersonaService().crear('t-1', { rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador' });

        const enOtraEmpresa = await new PersonaService().getByRut('t-2', '12.345.678-5');
        assert.equal(enOtraEmpresa, null);
    });

    test('una ficha legada (RUT en claro, sin migrar) se sigue leyendo igual', async () => {
        // Simula lo que hay hoy en producción: nunca pasó por `crear()` con cifrado.
        personasAlmacen.push({
            PK: 'TENANT#t-1', SK: 'PERSONA#p-legado',
            personaId: 'p-legado', tenantId: 't-1',
            rut: '11.111.111-1', nombre: 'Legado', rol: 'trabajador',
            vigilanciaSalud: { enVigilancia: false }, restriccionLaboral: null,
        });

        const persona = await new PersonaService().getById('p-legado');
        assert.equal(persona.rut, '11.111.111-1', 'se lee en claro, tal cual estaba');
        assert.equal(persona.vigilanciaSalud.enVigilancia, false);
    });

    test('listByTenant: el plantel completo queda con su RUT y salud descifrados', async () => {
        const rutsValidos = ['12.345.678-5', '9.876.543-3', '15.111.222-6'];
        for (const rut of rutsValidos) {
            await new PersonaService().crear('t-lote', { rut, nombre: `Persona ${rut}`, rol: 'trabajador' });
        }
        llaveTenant._olvidarCache(); // simula una invocación nueva, como en producción

        const personas = await new PersonaService().listByTenant('t-lote');

        assert.equal(personas.length, 3);
        for (const p of personas) {
            assert.ok(rutsValidos.includes(p.rut), `RUT descifrado correctamente: ${p.rut}`);
            assert.equal(p.vigilanciaSalud.enVigilancia, false);
        }
    });

    test('actualizar(): guarda vigilanciaSalud cifrada, y se puede releer', async () => {
        const { persona } = await new PersonaService().crear('t-1', {
            rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador',
        });

        await new PersonaService().actualizar('t-1', persona.personaId, {
            vigilanciaSalud: {
                enVigilancia: true, protocolos: ['PREXOR'],
                fechaUltimoExamen: '2026-01-01', aptitudLaboral: 'apto', restricciones: [],
            },
        });

        const releida = await new PersonaService().getById(persona.personaId);
        assert.equal(releida.vigilanciaSalud.enVigilancia, true);
        assert.deepEqual(releida.vigilanciaSalud.protocolos, ['PREXOR']);

        const guardado = personasAlmacen.find((p) => p.personaId === persona.personaId);
        assert.equal(JSON.stringify(guardado).includes('PREXOR'), false, 'no queda en claro en la tabla');
    });

    test('toDynamoItem revienta si falta el cifrado, no escribe un campo vacío', () => {
        const { Persona } = require('../lib/models/Persona');
        const sinCifrar = new Persona({
            personaId: 'p-1', tenantId: 't-1', rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador',
        });
        assert.throws(() => sinCifrar.toDynamoItem(), /rutCifrado/);
    });
});
