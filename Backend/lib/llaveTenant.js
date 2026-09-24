/**
 * Llaves de datos compartidas por empresa, para lo que se cifra en volumen.
 *
 * ── El problema que resuelve ──────────────────────────────────────────────
 *
 * El diseño por omisión de "cifrado de sobre" es una llave de datos POR VALOR:
 * cada RUT, cada ficha de salud, su propia llamada a `kms:GenerateDataKey` al
 * escribir y a `kms:Decrypt` al leer. Es el radio de exposición más chico
 * posible, y es el correcto para un valor que se lee de a uno.
 *
 * No lo es para el plantel de una empresa. Listar 200 personas, o que el
 * expediente de cumplimiento cuente cuántas están en vigilancia de salud,
 * pasan por CADA persona del tenant en una sola operación: con una llave por
 * valor, eso son 200 llamadas a KMS para una sola pantalla.
 *
 * La solución es la misma que ya se aprobó para las encuestas: una llave de
 * datos por EMPRESA (no por persona, no por valor), generada una vez,
 * reutilizada para cifrar el campo de cada persona de esa empresa. Leer el
 * plantel completo pasa a costar 1 llamada a KMS —para desenvolver la llave
 * del tenant—, no N. El radio de exposición si esa llave se compromete es una
 * empresa entera, que es el mismo radio que ya existe hoy si alguien lee esa
 * partición de la tabla sin cifrado: no es peor que el statu quo, es mejor.
 *
 * ── Dos llaves, no una ────────────────────────────────────────────────────
 *
 * El RUT y la salud tienen cada uno su propia llave de datos, independiente.
 * No se comparten porque no tienen el mismo radio de exposición aceptable: son
 * secretos distintos, protegen datos de sensibilidad distinta, y rotar uno no
 * debería obligar a rotar el otro.
 *
 * ── Dónde vive la llave envuelta ──────────────────────────────────────────
 *
 * En el propio elemento del tenant (`rutPersonasDataKey`, `saludDataKey`):
 * `{k: CiphertextBlob en base64, kid}`. Nace en el primer uso —el primer
 * `crear()` o la primera lectura de una ficha sin migrar de ese tenant— con
 * una escritura condicionada (`attribute_not_exists`) para que dos altas
 * simultáneas en una empresa recién creada no generen dos llaves distintas y
 * dejen una persona cifrada con la que perdió la carrera.
 */

const { UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./clients/dynamodb');
const { generarLlaveReutilizable, desenvolverLlave } = require('./cifradoCampo');

const TENANTS_TABLE = process.env.TENANTS_TABLE || 'Tenants';

const PROPOSITOS = {
    RUT_PERSONAS: 'rutPersonasDataKey',
    SALUD: 'saludDataKey',
};

// Caché por contenedor: `tenantId:proposito -> llave desenvuelta (Buffer)`.
// No expira. Si la llave de un tenant rota, entra una NUEVA bajo el mismo
// nombre de atributo —no hay versión que conservar acá, a diferencia de la
// pimienta de credenciales, porque rotar implica re-cifrar cada valor de ese
// tenant de una vez (ver nota de rotación más abajo), no una convivencia
// progresiva de dos versiones.
const cache = new Map();

const claveCache = (tenantId, proposito) => `${tenantId}:${proposito}`;

/**
 * Devuelve la llave de datos DESENVUELTA (Buffer de 32 bytes) para un
 * propósito y un tenant, creándola si es la primera vez que ese tenant la
 * necesita.
 *
 * @param {string} tenantId
 * @param {string} atributo - uno de los valores de `PROPOSITOS` (p. ej.
 *        `PROPOSITOS.RUT_PERSONAS`), no la clave del objeto. Quien llama
 *        siempre debería escribir `PROPOSITOS.RUT_PERSONAS`, nunca el nombre
 *        del atributo a mano.
 * @returns {Promise<Buffer>}
 */
async function llaveDeTenant(tenantId, atributo) {
    if (!Object.values(PROPOSITOS).includes(atributo)) {
        throw new Error(`Propósito de llave desconocido: ${atributo}`);
    }

    const clave = claveCache(tenantId, atributo);
    if (cache.has(clave)) return cache.get(clave);

    const key = { PK: `TENANT#${tenantId}`, SK: `METADATA#${tenantId}` };
    const res = await docClient.send(new GetCommand({ TableName: TENANTS_TABLE, Key: key }));
    let envuelta = res.Item?.[atributo];

    if (!envuelta) {
        envuelta = await crearLlaveDeTenant(tenantId, atributo, key);
    }

    const plaintext = await desenvolverLlave(envuelta);
    cache.set(clave, plaintext);
    return plaintext;
}

/**
 * Genera y persiste la llave, con una escritura condicionada para que dos
 * altas simultáneas en un tenant nuevo no produzcan dos llaves: quien pierde
 * la carrera relee y usa la del ganador, en vez de cifrar con una llave que
 * el propio tenant ya no reconoce.
 */
async function crearLlaveDeTenant(tenantId, atributo, key) {
    const nueva = await generarLlaveReutilizable();
    const envuelta = { k: nueva.k, kid: nueva.kid };

    try {
        await docClient.send(new UpdateCommand({
            TableName: TENANTS_TABLE,
            Key: key,
            UpdateExpression: `SET ${atributo} = :envuelta`,
            ConditionExpression: `attribute_not_exists(${atributo})`,
            ExpressionAttributeValues: { ':envuelta': envuelta },
        }));
        return envuelta;
    } catch (err) {
        if (err.name !== 'ConditionalCheckFailedException') throw err;
        // Alguien más la creó primero: usar la que quedó.
        const res = await docClient.send(new GetCommand({ TableName: TENANTS_TABLE, Key: key }));
        return res.Item[atributo];
    }
}

module.exports = {
    llaveDeTenant,
    PROPOSITOS,
    // Solo para pruebas: la caché es por contenedor.
    _olvidarCache: () => cache.clear(),
};
