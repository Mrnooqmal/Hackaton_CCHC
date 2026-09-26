// Los informes firmados del Art. 71 guardan su contenido cifrado, una sola vez,
// y siguen pudiendo probarse aunque cambie la llave.
//
// Antes, el informe de investigación y el registro AT/EP guardaban su contenido
// en claro y DOS veces (`snapshot` y `contenido`), con el RUT del accidentado y
// de los entrevistados, o con la aptitud laboral y los protocolos de vigilancia
// de cada persona — y las dos copias iban al índice. Estas pruebas fijan:
//
//   1. en la tabla no queda nada de eso en claro, ni duplicado;
//   2. la huella se calculó sobre el claro, así que re-cifrar (lo que hace una
//      rotación de llave) no la invalida, y alterar el contenido sí;
//   3. el contenido firmado no sale por la API, ni cifrado.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { docClient } = require('../lib/clients/dynamodb');
const { s3Client } = require('../lib/clients/s3');
const { crearTablaTenants } = require('./doble-tabla-tenants');
const { FirmaService } = require('../lib/services/FirmaService');
const { PersonaService } = require('../lib/services/PersonaService');
const { RegistroService } = require('../lib/services/RegistroService');
const { cifrarSobre, descifrarSobre } = require('../lib/cifradoCampo');
const { calcularHuella } = require('../lib/huella');
const { descifrarDocumento, llaveDe } = require('../lib/arregloSensible');

const EMPRESA = 't-1';
const RUT_AFECTADO = '12.345.678-5';
const RUT_ENTREVISTADO = '9.876.543-3';

const INCIDENTE = {
    incidentId: 'inc-1', obraId: 'o-1', tenantId: EMPRESA,
    fecha: '2026-09-20', hora: '10:15', gravedad: 'grave', esFatal: false, diasPerdidos: 30,
    descripcion: 'Caída desde andamio',
    afectado: { nombreCompleto: 'Juan Pérez Soto', rut: RUT_AFECTADO, cargo: 'Maestro', puestoAlMomentoAccidente: 'Andamio norte' },
    relatoAccidente: 'Perdió el equilibrio al cambiar de nivel sin arnés.',
    causasRaiz: [{ causa: 'Baranda incompleta' }],
    entrevistados: [{ nombre: 'Pedro Díaz', rut: RUT_ENTREVISTADO, cargo: 'Capataz' }],
};

const CONSOLIDADO = {
    tenantId: EMPRESA, obraId: 'o-1', periodo: { desde: '2026-09-01', hasta: '2026-09-30' },
    generadoEn: '2026-09-25T12:00:00.000Z',
    indicadores: { tasaAccidentabilidad: 2.5 },
    incidentes: [{ incidentId: 'inc-1', gravedad: 'grave', diasPerdidos: 30 }],
    vigilanciaSalud: {
        enVigilancia: 1, totalActivos: 10,
        personas: [{ personaId: 'p-1', nombre: 'Juan Pérez', protocolos: ['silice'], aptitudLaboral: 'no_apto_temporal' }],
    },
};

let tabla;
let documentos;
let htmls;
let originales;

beforeEach(() => {
    require('../lib/llaveTenant')._olvidarCache();
    tabla = crearTablaTenants([EMPRESA]);
    documentos = [];
    htmls = [];
    originales = {
        send: docClient.send,
        s3: s3Client.send,
        crear: FirmaService.crear,
        getById: PersonaService.prototype.getById,
        consolidado: RegistroService.prototype.construirSnapshotConsolidado,
    };
    docClient.send = async (cmd) => {
        const deTenants = tabla.responder(cmd);
        if (deTenants !== undefined) return deTenants;
        if (cmd.constructor.name === 'PutCommand') { documentos.push(cmd.input.Item); return {}; }
        return {};
    };
    s3Client.send = async (cmd) => { htmls.push(String(cmd.input.Body || '')); return {}; };
    FirmaService.crear = async ({ personaId, tenantId }) => ({
        signatureId: 's-1', token: 'SIG-PRUEBA', personaId, tenantId,
        personaNombre: 'Ana Rojas', personaRut: '11.111.111-1', tipoFirma: 'documento',
        fecha: '2026-09-25', horario: '12:00', timestamp: '2026-09-25T12:00:00.000Z', ipAddress: '1.2.3.4',
    });
    PersonaService.prototype.getById = async (id) => ({ personaId: id, tenantId: EMPRESA, nombre: 'Ana', apellido: 'Rojas' });
    RegistroService.prototype.construirSnapshotConsolidado = async () => structuredClone(CONSOLIDADO);
});

afterEach(() => {
    docClient.send = originales.send;
    s3Client.send = originales.s3;
    FirmaService.crear = originales.crear;
    PersonaService.prototype.getById = originales.getById;
    RegistroService.prototype.construirSnapshotConsolidado = originales.consolidado;
});

const generar = {
    'informe de investigación (Art. 71)': () => new RegistroService().generarInformeInvestigacion({
        tenantId: EMPRESA, obraId: 'o-1', incident: structuredClone(INCIDENTE),
        firmante: { personaId: 'p-firma', pin: '1234' },
    }),
    'registro AT/EP (Arts. 71-72)': () => new RegistroService().generarRegistroATEP({
        tenantId: EMPRESA, obraId: 'o-1', periodo: CONSOLIDADO.periodo,
        firmante: { personaId: 'p-firma', pin: '1234' },
    }),
};

// Lo que no puede quedar en claro en la tabla, por informe.
const PROHIBIDO = {
    'informe de investigación (Art. 71)': [RUT_AFECTADO, RUT_ENTREVISTADO, 'Juan Pérez Soto', 'Perdió el equilibrio', 'Baranda incompleta'],
    'registro AT/EP (Arts. 71-72)': ['no_apto_temporal', 'silice'],
};

for (const [nombre, generarInforme] of Object.entries(generar)) {
    describe(nombre, () => {
        test('en la tabla, el contenido firmado va cifrado y una sola vez', async () => {
            await generarInforme();
            const [doc] = documentos;

            assert.equal(doc.snapshot, undefined, 'el snapshot en claro ya no se guarda');
            assert.equal(doc.contenido, undefined, 'la copia duplicada `contenido` desapareció');
            assert.ok(doc.snapshotCifrado?.c && doc.snapshotCifrado?.iv && doc.snapshotCifrado?.tag);
            assert.equal(doc.huella.canon, 'json-canonico-v1');

            const guardado = JSON.stringify(doc);
            for (const dato of PROHIBIDO[nombre]) {
                assert.ok(!guardado.includes(dato), `"${dato}" no puede quedar en claro en la tabla`);
            }
        });

        test('la huella guardada corresponde al contenido, y se verifica', async () => {
            await generarInforme();
            assert.equal(await RegistroService.verificarIntegridad(documentos[0]), true);
        });

        test('re-cifrar el contenido —lo que hace una rotación de llave— no invalida la huella', async () => {
            await generarInforme();
            const doc = documentos[0];
            const rotado = { ...doc, snapshotCifrado: await cifrarSobre(await descifrarSobre(doc.snapshotCifrado)) };

            assert.notEqual(rotado.snapshotCifrado.c, doc.snapshotCifrado.c, 'el cifrado cambió');
            assert.equal(await RegistroService.verificarIntegridad(rotado), true, 'la evidencia sigue probándose');
            // Y la razón: si la huella fuera del cifrado, esto la habría roto.
            assert.notEqual(calcularHuella(rotado.snapshotCifrado).valor, calcularHuella(doc.snapshotCifrado).valor);
        });

        test('alterar el contenido y volver a cifrarlo SÍ se detecta', async () => {
            await generarInforme();
            const doc = documentos[0];
            const contenido = await descifrarSobre(doc.snapshotCifrado);
            if (contenido.accidente) contenido.accidente.esFatal = true;
            else contenido.vigilanciaSalud.personas[0].aptitudLaboral = 'apto';
            const adulterado = { ...doc, snapshotCifrado: await cifrarSobre(contenido) };

            assert.equal(await RegistroService.verificarIntegridad(adulterado), false);
        });

        test('la respuesta al cliente no lleva el contenido completo', async () => {
            const respuesta = await generarInforme();
            assert.equal(respuesta.snapshot, undefined);
            assert.equal(respuesta.hash, respuesta.huella.valor, 'la pantalla sigue mostrando la huella');
        });

        test('el archivo de evidencia en S3 sí lleva el contenido legible, con la huella', async () => {
            // Es el documento que se presenta a la fiscalización: tiene que
            // leerse. Vive en el bucket de evidencia, no en la tabla ni en su índice.
            await generarInforme();
            assert.ok(htmls[0].includes(documentos[0].huella.valor));
        });

        test('leer el documento por la API no devuelve el sobre del contenido firmado', async () => {
            await generarInforme();
            const visto = descifrarDocumento(documentos[0], await llaveDe(EMPRESA));
            assert.equal(visto.snapshotCifrado, undefined);
            assert.ok(visto.huella, 'la huella sí, para mostrarla');
        });
    });
}

test('un documento sin contenido firmado no se "verifica": se dice que no hay qué verificar', async () => {
    await assert.rejects(() => RegistroService.verificarIntegridad({ huella: calcularHuella({ a: 1 }) }), /no tiene contenido firmado/);
});

test('la huella sigue calculándose sobre el claro aunque la llave local cambie', async () => {
    // El caso extremo de rotación en pruebas: otra llave local. El sobre viejo
    // ya no se puede abrir con la nueva, pero la huella que se guardó no
    // depende de ninguna de las dos.
    const contenido = RegistroService.construirSnapshotInvestigacion(INCIDENTE, { tenantId: EMPRESA, obraId: 'o-1', generadoEn: 'x' });
    const antes = calcularHuella(contenido).valor;
    const llaveOriginal = process.env.CAMPO_CIFRADO_LOCAL_KEY;
    process.env.CAMPO_CIFRADO_LOCAL_KEY = crypto.randomBytes(32).toString('base64');
    try {
        await cifrarSobre(contenido);
        assert.equal(calcularHuella(contenido).valor, antes);
    } finally {
        process.env.CAMPO_CIFRADO_LOCAL_KEY = llaveOriginal;
    }
});
