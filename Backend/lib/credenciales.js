/**
 * Hasheo de credenciales: PIN de firma y contraseña de acceso web.
 *
 * ── Qué había ────────────────────────────────────────────────────────────────
 *
 * Una pasada de SHA-256 sobre `${secreto}-${personaId}-${PIN_SALT}`. SHA-256 es
 * rápido a propósito: una GPU corriente hace miles de millones por segundo. Con
 * la tabla de personas en la mano, los 10.000 PIN posibles de cuatro dígitos se
 * recorren en microsegundos, y las contraseñas caen por diccionario. Para
 * empeorarlo, `PIN_SALT` nunca estuvo declarada en `serverless.yml`: en AWS valía
 * `undefined`, así que el hash era SHA-256 de un texto enteramente predecible.
 *
 * ── Qué hay ahora ────────────────────────────────────────────────────────────
 *
 * scrypt, que es lento y caro EN MEMORIA a propósito. El parámetro N fija cuánta
 * memoria hay que sostener para cada intento, y esa memoria es justo lo que una
 * GPU no puede multiplicar por miles. Cada hash lleva su propia sal aleatoria.
 *
 * ── Por qué el formato lleva el algoritmo adentro ────────────────────────────
 *
 *   $scrypt$ln=15,r=8,p=1,pv=1$<sal>$<derivada>        (base64url)
 *
 * El día que haya que subir el costo o cambiar de función —y lo va a haber— la
 * tabla tendrá hashes de dos épocas conviviendo. Sin esta marca no hay forma de
 * saber cuál es cuál salvo adivinando por el largo, y la migración se vuelve un
 * censo a ciegas. Con ella, `verificar` sabe leer lo viejo, lo compara bien, y
 * avisa con `obsoleto: true` para que quien pueda escribir lo reemplace en el
 * momento en que la persona entra con su credencial en la mano. El costo de
 * llevar la marca se paga una vez; el de no llevarla se paga en cada cambio.
 *
 * `pv` es la versión de la pimienta (ver abajo), y viaja por la misma razón.
 *
 * ── La pimienta ──────────────────────────────────────────────────────────────
 *
 * Un PIN de cuatro dígitos tiene 10.000 combinaciones. Ninguna función de costo
 * arregla eso: a 100 ms por intento, probarlas todas contra un hash robado toma
 * menos de veinte minutos. Lo que sí lo arregla es que el atacante no tenga todo
 * lo necesario: la pimienta es un secreto del servidor, no de la tabla. Quien se
 * lleve un volcado de DynamoDB y no el secreto no puede probar ni un intento. Es
 * la diferencia entre "PIN de cuatro dígitos" y "PIN de cuatro dígitos más una
 * llave de 256 bits".
 *
 * Vive en SSM como SecureString cifrado con la CMK del sistema, y se lee EN
 * EJECUCIÓN, no al desplegar. La diferencia importa: una variable de entorno de
 * Lambda resuelta desde `serverless.yml` termina escrita en claro dentro de la
 * plantilla de CloudFormation, que queda guardada y la puede leer cualquiera con
 * permiso de lectura sobre el stack. Un secreto que viaja en la plantilla no es
 * un secreto. El costo de leerlo en ejecución es una llamada a SSM por
 * contenedor nuevo, que queda en caché mientras ese contenedor viva.
 *
 * Es también la razón por la que la pimienta se versiona y no se pisa: rotarla
 * invalida todos los hashes hechos con la anterior. Con `pv` guardado, los dos
 * juegos conviven y cada credencial se actualiza sola al usarse.
 */

const crypto = require('crypto');

// ─── Parámetros ──────────────────────────────────────────────────────────────

// ln es log2(N). N=2^15 con r=8 obliga a sostener 32 MB por intento.
// La elección está medida contra la Lambda real, no estimada: ver
// `docs/gobernanza-y-seguridad-de-datos.md`, decisión D-7.
// Se lee del entorno en cada uso, y no una vez al cargar el módulo: subir el
// costo es cambiar una variable y desplegar, sin tocar código, y cada hash se
// va actualizando solo a medida que su dueño entra.
const paramsActuales = () => ({
    ln: Number(process.env.CREDENCIAL_SCRYPT_LN || 15),
    r: 8,
    p: 1,
});

const LARGO_DERIVADA = 32;
const LARGO_SAL = 16;

// scrypt en Node aborta si el cálculo excede `maxmem`, cuyo valor por omisión
// son 32 MB: justo el borde de N=2^15. Se declara con holgura para que subir un
// escalón de costo no falle por un límite que no tiene nada que ver.
const maxmem = ({ ln, r, p }) => 256 * 2 ** ln * r + 128 * r * p + 1024 * 1024;

// ─── La pimienta ─────────────────────────────────────────────────────────────

// Caché por contenedor. No expira: si la pimienta rota, lo que entra es una
// versión NUEVA con otro `pv`, y los contenedores viejos siguen sirviendo la
// anterior sin equivocarse, porque cada hash dice con cuál se hizo.
let cache = null;

const leerDeSSM = async (nombre) => {
    // Carga perezosa: quien no toca credenciales no paga ni el require.
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
    const cliente = new SSMClient({});
    const res = await cliente.send(new GetParameterCommand({ Name: nombre, WithDecryption: true }));
    return res.Parameter?.Value || '';
};

/**
 * Devuelve `{ valor, version, anteriores }`.
 *
 * `CREDENCIAL_PEPPER` en el entorno gana sobre SSM: es lo que usan las pruebas y
 * el desarrollo local, donde no hay nada que proteger.
 *
 * Sin pimienta configurada el sistema funciona igual y lo deja dicho en el hash
 * (`pv=0`). Se prefiere eso a fallar el arranque: un despliegue al que le falta
 * el parámetro no puede dejar a nadie sin poder firmar.
 */
const obtenerPimienta = async () => {
    const delEntorno = process.env.CREDENCIAL_PEPPER;
    const anteriores = new Map();
    for (const par of (process.env.CREDENCIAL_PEPPER_ANTERIORES || '').split(',').filter(Boolean)) {
        const corte = par.indexOf(':');
        if (corte > 0) anteriores.set(Number(par.slice(0, corte)), par.slice(corte + 1));
    }

    if (delEntorno) {
        return { valor: delEntorno, version: Number(process.env.CREDENCIAL_PEPPER_V || 1), anteriores };
    }

    const parametro = process.env.CREDENCIAL_PEPPER_PARAM;
    if (!parametro) return { valor: '', version: 0, anteriores };

    if (!cache) {
        // Un fallo de SSM NO se degrada a "sin pimienta": eso convertiría todas
        // las credenciales del sistema en incorrectas de golpe. Se propaga, y se
        // deja constancia medible, porque desde afuera esto se ve como un 500
        // cualquiera y nadie lo va a reportar como lo que es.
        let valor;
        try {
            valor = await leerDeSSM(parametro);
        } catch (err) {
            require('./degradacion').registrarFallo('credencial.pimienta', err, { parametro });
            throw err;
        }
        if (!valor) {
            const err = new Error(`El parámetro ${parametro} existe pero vino vacío`);
            err.codigo = 'PIMIENTA_VACIA';
            throw err;
        }
        cache = { valor, version: Number(process.env.CREDENCIAL_PEPPER_V || 1), anteriores };
    }
    return { ...cache, anteriores };
};

const pimientaDeVersion = (pv, actual) => {
    if (!pv) return '';
    if (pv === actual.version) return actual.valor;
    const anterior = actual.anteriores.get(pv);
    return anterior === undefined ? null : anterior;
};

// ─── Formato ─────────────────────────────────────────────────────────────────

const b64 = (buf) => buf.toString('base64url');
const deB64 = (txt) => Buffer.from(txt, 'base64url');

/**
 * Lee un hash almacenado. Devuelve `{ algoritmo: 'sha256-legado' }` para lo
 * anterior al formato, que se reconoce por no empezar con `$`.
 */
const describir = (almacenado) => {
    if (!almacenado || typeof almacenado !== 'string') return null;
    if (!almacenado.startsWith('$')) {
        return /^[0-9a-f]{64}$/i.test(almacenado) ? { algoritmo: 'sha256-legado' } : null;
    }

    const partes = almacenado.split('$');
    // ['', algoritmo, params, sal, derivada]
    if (partes.length !== 5 || partes[1] !== 'scrypt') return null;

    const params = {};
    for (const par of partes[2].split(',')) {
        const [clave, valor] = par.split('=');
        params[clave] = Number(valor);
    }
    if (!Number.isInteger(params.ln) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
        return null;
    }

    return {
        algoritmo: 'scrypt',
        params: { ln: params.ln, r: params.r, p: params.p },
        pv: Number.isInteger(params.pv) ? params.pv : 0,
        sal: partes[3],
        derivada: partes[4],
    };
};

// ─── Derivación ──────────────────────────────────────────────────────────────

const derivar = (secreto, sal, params, pimientaUsada) => new Promise((resolver, rechazar) => {
    // Separador NUL: ni el secreto ni el contexto pueden contenerlo, así que dos
    // entradas distintas no pueden producir el mismo texto de partida.
    const entrada = `${secreto}\u0000${pimientaUsada}`;
    crypto.scrypt(
        entrada, sal, LARGO_DERIVADA,
        { N: 2 ** params.ln, r: params.r, p: params.p, maxmem: maxmem(params) },
        (err, clave) => (err ? rechazar(err) : resolver(clave)),
    );
});

// El contexto (personaId) va dentro de la sal, no de la contraseña: mantiene el
// hash atado a la persona —una ficha robada no sirve en otra— sin quitarle
// entropía a la sal aleatoria.
const salCompleta = (salAleatoria, contexto) =>
    Buffer.concat([salAleatoria, Buffer.from(`\u0000${contexto || ''}`, 'utf8')]);

/**
 * Hashea un secreto. Devuelve la cadena completa, lista para guardar.
 *
 * @param {string} secreto - PIN o contraseña en claro.
 * @param {string} contexto - personaId al que queda atada la credencial.
 * @returns {Promise<string>}
 */
const hashear = async (secreto, contexto) => {
    if (!secreto) throw new Error('No hay secreto que hashear');

    const params = paramsActuales();
    const actual = await obtenerPimienta();
    const salAleatoria = crypto.randomBytes(LARGO_SAL);
    const derivada = await derivar(secreto, salCompleta(salAleatoria, contexto), params, actual.valor);

    return `$scrypt$ln=${params.ln},r=${params.r},p=${params.p},pv=${actual.version}$${b64(salAleatoria)}$${b64(derivada)}`;
};

// Lo que hacía el sistema antes. Se conserva SOLO para poder verificar lo que ya
// está guardado: nada vuelve a escribirse en este formato.
//
// `PIN_SALT` se lee tal cual estaba —incluso ausente, donde el literal resultaba
// ser la cadena "undefined"—, porque reproducir el error es lo único que permite
// validar a quien ya tiene su credencial puesta y reemplazarla por una buena.
const hashLegado = (secreto, contexto) => crypto
    .createHash('sha256')
    .update(`${secreto}-${contexto}-${process.env.PIN_SALT}`)
    .digest('hex');

const igualdadConstante = (a, b) => {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Verifica un secreto contra lo almacenado.
 *
 * @returns {Promise<{valido: boolean, obsoleto: boolean, motivo?: string}>}
 *   `obsoleto` indica que la credencial es válida pero está guardada con un
 *   algoritmo, un costo o una pimienta que ya no son los vigentes. Quien pueda
 *   escribir debería re-hashearla en ese mismo momento: es la única ocasión en
 *   que el secreto en claro está disponible.
 */
const verificar = async (secreto, almacenado, contexto) => {
    const nulo = { valido: false, obsoleto: false };
    if (!secreto || !almacenado) return nulo;

    const info = describir(almacenado);
    if (!info) return nulo;

    if (info.algoritmo === 'sha256-legado') {
        return {
            valido: igualdadConstante(hashLegado(secreto, contexto), almacenado),
            obsoleto: true,
            motivo: 'sha256-legado',
        };
    }

    const actual = await obtenerPimienta();
    const pimientaUsada = pimientaDeVersion(info.pv, actual);
    if (pimientaUsada === null) {
        // Hash hecho con una pimienta que este despliegue no conoce. No es
        // "credencial incorrecta": es una credencial que NO SE PUEDE juzgar, y
        // decir que no coincide sería exactamente la degradación insegura que se
        // acaba de sacar del sistema.
        const err = new Error(`No está disponible la pimienta de versión ${info.pv}`);
        err.codigo = 'PIMIENTA_DESCONOCIDA';
        throw err;
    }

    let derivada;
    try {
        derivada = await derivar(secreto, salCompleta(deB64(info.sal), contexto), info.params, pimientaUsada);
    } catch {
        return nulo;
    }

    const valido = igualdadConstante(b64(derivada), info.derivada);
    const vigentes = paramsActuales();
    const desactualizado = info.params.ln !== vigentes.ln
        || info.params.r !== vigentes.r
        || info.params.p !== vigentes.p
        || info.pv !== actual.version;

    return { valido, obsoleto: valido && desactualizado, motivo: desactualizado ? 'parametros' : undefined };
};

module.exports = {
    hashear,
    // Solo para pruebas: la caché es por contenedor y no se vacía en producción.
    _olvidarPimienta: () => { cache = null; },
    verificar,
    describir,
    paramsActuales,
};
