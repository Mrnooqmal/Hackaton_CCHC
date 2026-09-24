/**
 * Cifrado de campo: RUT buscable por HMAC, y sobres de cifrado de sobre para
 * todo lo demás que no se busca (RUT de referencia, salud, respuestas de
 * encuesta).
 *
 * ── Por qué dos mecanismos, no uno ───────────────────────────────────────────
 *
 * Solo dos entidades se BUSCAN por RUT: personas (dentro de su empresa, y
 * global para el login) y empresas (unicidad al dar de alta). En todo lo demás
 * —firmas, incidentes, documentos, actividades, solicitudes— el RUT es una
 * copia de referencia que se muestra, nunca se filtra por ella. Por eso solo
 * `hmac()` existe para buscar, y solo se usa en dos lugares; el resto usa
 * `cifrarSobre()`, que es deliberadamente NO determinista —dos cifrados del
 * mismo valor dan resultados distintos— porque ahí no hace falta buscar, y un
 * valor que no se busca no debería poder correlacionarse por su cifrado.
 *
 * ── El HMAC ───────────────────────────────────────────────────────────────
 *
 * HMAC-SHA256 con una llave propia en SSM, separada de `CREDENCIAL_PEPPER`
 * (D-7): son secretos de propósito distinto —uno protege contraseñas y PIN, el
 * otro hace buscable un RUT sin guardarlo en claro— y si uno se compromete el
 * otro no debería caer con él. Mismo patrón: `SecureString` cifrado con la CMK
 * del sistema, leído en ejecución (nunca resuelto al desplegar, para que no
 * quede escrito en la plantilla de CloudFormation), cacheado por contenedor,
 * versionado para poder rotar.
 *
 * El RUT se normaliza ANTES de calcular el HMAC (sin puntos ni guión, DV en
 * mayúscula) para que ".", mayúsculas o el formato de entrada no produzcan un
 * HMAC distinto del mismo RUT — si no, la búsqueda fallaría por formato, no
 * por identidad.
 *
 * ── El cifrado de sobre ──────────────────────────────────────────────────────
 *
 * `kms:GenerateDataKey` contra la CMK del sistema (`ClaveDatos`, ya declarada,
 * ya con los permisos concedidos a toda función) genera una llave de datos por
 * operación; AES-256-GCM local con esa llave cifra el valor; se guarda
 * `{c, iv, tag, k, kid, v}` — la llave de datos viaja ENVUELTA (`k`, el
 * `CiphertextBlob` que devuelve KMS), nunca en claro. Para descifrar hace falta
 * `kms:Decrypt` sobre `k` primero.
 *
 * `cifrarSoloConLlave` / `descifrarSoloConLlave` existen aparte para el caso de
 * "un sobre por encuesta": una sola llave de datos generada una vez y
 * reutilizada para cifrar la respuesta de cada destinatario, para no pagar una
 * llamada a KMS por persona. `cifrarSobre`/`descifrarSobre` (con KMS adentro)
 * son para todo lo demás, donde cada valor es su propio sobre independiente.
 */

const crypto = require('crypto');

const ALGORITMO = 'aes-256-gcm';
const LARGO_IV = 12;

// ─── El HMAC ─────────────────────────────────────────────────────────────────

let cacheHmacKey = null;

const leerDeSSM = async (nombre) => {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
    const cliente = new SSMClient({});
    const res = await cliente.send(new GetParameterCommand({ Name: nombre, WithDecryption: true }));
    return res.Parameter?.Value || '';
};

/**
 * Devuelve `{ valor, version }` de la llave de HMAC.
 *
 * `CAMPO_HMAC_KEY` en el entorno gana sobre SSM: lo que usan las pruebas y el
 * desarrollo local, donde no hay nada que proteger.
 */
const obtenerLlaveHmac = async () => {
    const delEntorno = process.env.CAMPO_HMAC_KEY;
    if (delEntorno) return { valor: delEntorno, version: Number(process.env.CAMPO_HMAC_KEY_V || 1) };

    const parametro = process.env.CAMPO_HMAC_KEY_PARAM;
    if (!parametro) {
        const err = new Error('Falta CAMPO_HMAC_KEY_PARAM: no hay dónde buscar la llave de HMAC');
        err.codigo = 'HMAC_SIN_LLAVE';
        throw err;
    }

    if (!cacheHmacKey) {
        const { registrarFallo } = require('./degradacion');
        let valor;
        try {
            valor = await leerDeSSM(parametro);
        } catch (err) {
            // Igual que la pimienta de credenciales: un fallo de SSM NO se
            // degrada a "sin llave", porque eso volvería toda búsqueda por
            // RUT una búsqueda que nunca encuentra nada, en silencio.
            registrarFallo('cifrado.hmacKey', err, { parametro });
            throw err;
        }
        if (!valor) {
            const err = new Error(`El parámetro ${parametro} existe pero vino vacío`);
            err.codigo = 'HMAC_KEY_VACIA';
            throw err;
        }
        cacheHmacKey = { valor, version: Number(process.env.CAMPO_HMAC_KEY_V || 1) };
    }
    return cacheHmacKey;
};

/** Normaliza un RUT para que el mismo RUT dé siempre el mismo HMAC, sin
 *  importar puntos, guión o mayúscula del dígito verificador. */
const normalizarRut = (rut) => String(rut || '').replace(/[.\s]/g, '').toUpperCase();

/**
 * HMAC-SHA256 determinista de un RUT ya normalizado. Es lo único de este
 * módulo que se usa para BUSCAR: solo `PersonaService` (RUT dentro de la
 * empresa y global) y `TenantService` (RUT de empresa) lo llaman.
 *
 * @returns {Promise<string>} hex, prefijado con la versión de la llave
 *          (`v1:...`) por la misma razón que el hash de credenciales guarda su
 *          algoritmo: el día que la llave rote, hace falta saber con cuál se
 *          calculó cada HMAC ya guardado.
 */
const hmacRut = async (rut) => {
    const { valor, version } = await obtenerLlaveHmac();
    const digest = crypto.createHmac('sha256', valor).update(normalizarRut(rut)).digest('hex');
    return `v${version}:${digest}`;
};

// ─── El cifrado de sobre ─────────────────────────────────────────────────────

const cifrarConLlave = (texto, llave) => {
    const iv = crypto.randomBytes(LARGO_IV);
    const cipher = crypto.createCipheriv(ALGORITMO, llave, iv);
    const c = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
    return { c: c.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
};

const descifrarConLlave = (sobre, llave) => {
    const decipher = crypto.createDecipheriv(ALGORITMO, llave, Buffer.from(sobre.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sobre.tag, 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(sobre.c, 'base64')),
        decipher.final(),
    ]).toString('utf8');
};

const kmsKeyId = () => {
    const id = process.env.CAMPO_CIFRADO_KMS_KEY_ID;
    if (!id) throw new Error('Falta CAMPO_CIFRADO_KMS_KEY_ID: no hay con qué envolver la llave de datos');
    return id;
};

const clienteKMS = () => {
    const { KMSClient } = require('@aws-sdk/client-kms');
    return new KMSClient({});
};

/**
 * Vía de escape para pruebas: `CAMPO_CIFRADO_LOCAL_KEY` (32 bytes en base64)
 * reemplaza KMS por completo —sin red, sin AWS— igual que `CREDENCIAL_PEPPER`
 * reemplaza SSM para las credenciales. Hace falta ADEMÁS de esa vía porque
 * generar y desenvolver llaves de datos son llamadas de red a KMS, no un
 * cómputo local como scrypt: sin esto, cada prueba que cifrara algo tendría
 * que hablar con AWS de verdad.
 *
 * No envuelve nada de verdad: la "llave envuelta" queda marcada (`kid: 'local'`)
 * y `desenvolverLlave`/`descifrarSobre` la reconocen y resuelven con la misma
 * llave del entorno, sin tocar la red.
 */
const llaveLocalDePrueba = () => {
    const b64 = process.env.CAMPO_CIFRADO_LOCAL_KEY;
    return b64 ? Buffer.from(b64, 'base64') : null;
};

/**
 * Cifra un valor con una llave de datos NUEVA (una llamada a KMS por
 * operación). Para un valor suelto — RUT de referencia, salud, cualquier campo
 * que sea su propio sobre.
 *
 * @returns {Promise<object>} `{c, iv, tag, k, kid, v}` listo para guardar.
 */
const cifrarSobre = async (valor) => {
    if (valor === null || valor === undefined) return null;
    const local = llaveLocalDePrueba();
    if (local) {
        const { c, iv, tag } = cifrarConLlave(JSON.stringify(valor), local);
        return { c, iv, tag, k: 'local', kid: 'local', v: 1 };
    }
    const { GenerateDataKeyCommand } = require('@aws-sdk/client-kms');
    const kid = kmsKeyId();
    const gen = await clienteKMS().send(new GenerateDataKeyCommand({ KeyId: kid, KeySpec: 'AES_256' }));
    const { c, iv, tag } = cifrarConLlave(JSON.stringify(valor), gen.Plaintext);
    return { c, iv, tag, k: Buffer.from(gen.CiphertextBlob).toString('base64'), kid, v: 1 };
};

/** Descifra un sobre hecho con `cifrarSobre`. */
const descifrarSobre = async (sobre) => {
    if (!sobre) return null;
    if (sobre.kid === 'local') {
        const local = llaveLocalDePrueba();
        return JSON.parse(descifrarConLlave(sobre, local));
    }
    const { DecryptCommand } = require('@aws-sdk/client-kms');
    const desenvuelta = await clienteKMS().send(new DecryptCommand({
        CiphertextBlob: Buffer.from(sobre.k, 'base64'),
        KeyId: sobre.kid,
    }));
    return JSON.parse(descifrarConLlave(sobre, desenvuelta.Plaintext));
};

/**
 * Genera UNA llave de datos para reutilizar en muchos cifrados — "un sobre por
 * encuesta", no uno por respuesta. Quien llama guarda `{k, kid}` una vez (en la
 * encuesta) y usa la llave en claro que devuelve `plaintext` mientras dura la
 * invocación; nunca la persiste.
 */
const generarLlaveReutilizable = async () => {
    const local = llaveLocalDePrueba();
    if (local) return { plaintext: local, k: 'local', kid: 'local' };
    const { GenerateDataKeyCommand } = require('@aws-sdk/client-kms');
    const kid = kmsKeyId();
    const gen = await clienteKMS().send(new GenerateDataKeyCommand({ KeyId: kid, KeySpec: 'AES_256' }));
    return { plaintext: gen.Plaintext, k: Buffer.from(gen.CiphertextBlob).toString('base64'), kid };
};

/** Desenvuelve una llave de datos guardada, UNA vez, para descifrar muchos
 *  sobres hechos con ella (una encuesta con N destinatarios: 1 llamada a KMS,
 *  N descifrados locales). */
const desenvolverLlave = async ({ k, kid }) => {
    if (kid === 'local') return llaveLocalDePrueba();
    const { DecryptCommand } = require('@aws-sdk/client-kms');
    const res = await clienteKMS().send(new DecryptCommand({ CiphertextBlob: Buffer.from(k, 'base64'), KeyId: kid }));
    return res.Plaintext;
};

/** Cifra un valor con una llave de datos ya desenvuelta (ver `generarLlaveReutilizable`/`desenvolverLlave`). */
const cifrarConLlaveDatos = (valor, llavePlaintext) => {
    if (valor === null || valor === undefined) return null;
    return cifrarConLlave(JSON.stringify(valor), llavePlaintext);
};

/** Descifra un sobre hecho con `cifrarConLlaveDatos`, con la misma llave ya desenvuelta. */
const descifrarConLlaveDatos = (sobre, llavePlaintext) => {
    if (!sobre) return null;
    return JSON.parse(descifrarConLlave(sobre, llavePlaintext));
};

/**
 * Igual que `cifrarConLlaveDatos`, pero SIEMPRE produce un sobre, incluso si
 * `valor` es `null`. Para campos donde `null` es un valor legítimo del
 * negocio (restriccionLaboral: "sin restricción") y no "nada que guardar":
 * cifrar solo cuando hay contenido sería condicionar el cifrado al valor, el
 * mismo patrón de falla silenciosa que se evitó en las respuestas de encuesta.
 * `null` viaja envuelto en `{v: null}` para que no lo intercepte el atajo de
 * `cifrarConLlave`.
 */
const cifrarConLlaveDatosSiempre = (valor, llavePlaintext) => cifrarConLlave(JSON.stringify({ v: valor }), llavePlaintext);

/** Descifra un sobre hecho con `cifrarConLlaveDatosSiempre`. */
const descifrarConLlaveDatosSiempre = (sobre, llavePlaintext) => JSON.parse(descifrarConLlave(sobre, llavePlaintext)).v;

module.exports = {
    normalizarRut,
    hmacRut,
    cifrarSobre,
    descifrarSobre,
    generarLlaveReutilizable,
    desenvolverLlave,
    cifrarConLlaveDatos,
    descifrarConLlaveDatos,
    cifrarConLlaveDatosSiempre,
    descifrarConLlaveDatosSiempre,
    // Solo para pruebas: la caché de la llave de HMAC es por contenedor.
    _olvidarLlaveHmac: () => { cacheHmacKey = null; },
};
