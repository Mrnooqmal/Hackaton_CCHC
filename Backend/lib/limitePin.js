/**
 * Límite de intentos de PIN (H-2).
 *
 * Con scrypt (D-7) probar los 10.000 PIN de cuatro dígitos ya cuesta 15-20
 * minutos de tráfico visible en vez de segundos. Pero visible no es lo mismo
 * que bloqueado, y nadie está mirando ese tráfico todavía. Esto es lo que
 * falta: un tope real, y una alarma que sí lo mire.
 *
 * ── El contador es por persona, no por sesión ni por IP ──────────────────────
 *
 * Los cuatro lugares donde se verifica un PIN (vales, firma directa, cambio de
 * PIN, enrolamiento) exigen sesión, y para actuar sobre el PIN de OTRA persona
 * además exigen el permiso de firma asistida. El atacante más probable no es
 * un desconocido —eso ya lo detiene el autorizador— sino alguien con sesión
 * válida probando el PIN de una persona puntual de su cuadrilla, o una sesión
 * robada. La persona atacada es siempre la misma aunque la sesión cambie; la
 * IP en terreno no sirve para nada, sale toda por la misma NAT de la obra.
 *
 * ── Progresión ────────────────────────────────────────────────────────────
 *
 * 1-4 fallos: nada, solo cuenta. Cinco intentos antes del primer bloqueo es
 * deliberadamente generoso — es un teclado numérico usado con guantes o bajo
 * lluvia, y bloquear a la tercera equivocación sería fricción real contra
 * quien no está atacando nada.
 *
 *   fallo 5  → 1 minuto
 *   fallo 10 → 5 minutos
 *   fallo 15 → 15 minutos
 *   fallo 20 y cada 5 en adelante → 60 minutos (tope)
 *
 * El contador se resetea a cero en el primer PIN correcto. Agotar el espacio
 * completo bajo esta progresión (2.000 ciclos de 5 intentos, casi todos
 * pagando el tope de 60 min) toma semanas, no minutos.
 *
 * ── Mientras está bloqueada ───────────────────────────────────────────────
 *
 * Un intento que llega bloqueado se rechaza SIN correr scrypt y SIN tocar el
 * contador ni el bloqueo. Incrementar durante el bloqueo dejaría que alguien
 * alargue el castigo de otra persona a pura fuerza de peticiones vacías.
 *
 * ── Hacia afuera ──────────────────────────────────────────────────────────
 *
 * El bloqueo SÍ se comunica, a diferencia del login o la recuperación de
 * contraseña. Ahí la ambigüedad protege contra enumerar cuentas que no se sabe
 * si existen; acá quien prueba el PIN ya sabe que la persona existe —la eligió
 * de su propia cuadrilla, o es la suya—, así que decir "inténtalo de nuevo en
 * N minutos" no filtra nada nuevo y sí es información operativa legítima para
 * quien solo se equivocó.
 */

const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./clients/dynamodb');
const { huellaIntentoPin } = require('./cifradoCampo');

const PERSONAS_TABLE = process.env.PERSONAS_TABLE || 'Personas';

/** Cada cuántos fallos se evalúa un nuevo bloqueo. */
const CADA = 5;

/** Duración del bloqueo por nivel (índice 0 = primer bloqueo, fallo 5). */
const DURACIONES_SEGUNDOS = [60, 300, 900, 3600];
const duracionPara = (fallos) => {
    const nivel = Math.floor(fallos / CADA) - 1;
    const idx = Math.min(nivel, DURACIONES_SEGUNDOS.length - 1);
    return DURACIONES_SEGUNDOS[idx];
};

const NOMBRE_METRICA = 'PinBloqueado';
const ESPACIO = 'BuildAndServe';

/**
 * Métrica separada de `FallosDependencia` (`lib/degradacion.js`) a propósito:
 * esa alarma dispara con un solo evento porque un fallo de dependencia nunca
 * es esperable. Un bloqueo de PIN sí lo es —alguien se equivoca un mal día—,
 * así que comparten el mecanismo (EMF, sin filtro por log group) pero no la
 * alarma: la de bloqueos necesita su propio umbral, más alto, para no
 * saturarse con el uso normal y seguir sirviendo cuando de verdad hay alguien
 * recorriendo PIN.
 */
const registrarBloqueo = (personaId, fallos, segundos) => {
    try {
        const linea = {
            _aws: {
                Timestamp: Date.now(),
                CloudWatchMetrics: [{
                    Namespace: ESPACIO,
                    Dimensions: [['stage']],
                    Metrics: [{ Name: NOMBRE_METRICA, Unit: 'Count' }],
                }],
            },
            stage: process.env.STAGE || process.env.AWS_LAMBDA_FUNCTION_NAME?.split('-')[1] || 'desconocido',
            [NOMBRE_METRICA]: 1,
            personaId,
            fallosConsecutivos: fallos,
            bloqueoSegundos: segundos,
        };
        console.error('PIN_BLOQUEADO', JSON.stringify(linea));
    } catch { /* registrar no puede romper el rechazo que ya se decidió */ }
};

const minutos = (segundos) => Math.ceil(segundos / 60);

/**
 * PIN de 6 dígitos desde el 8 de noviembre de 2026 (lib/utils/validation.js).
 * Para firmar y para pedir vales solo se acepta uno de 6. Uno de 4 —el de antes—
 * solo sirve para cambiarlo (`permitirAnterior`), y fuera de ese caso ni
 * siquiera se compara con el guardado: no da pistas sobre el PIN viejo ni
 * cuenta como intento fallido.
 */
const FORMATO_PIN = /^\d{6}$/;
const FORMATO_PIN_ANTERIOR = /^\d{4}$/;
const MENSAJE_DEBE_CAMBIAR = 'Los PIN de firma ahora son de 6 dígitos. Si el tuyo es de 4, cámbialo en Configuración antes de firmar.';

/** Lo lanza `verificarConLimiteOLanzar` con un PIN de 4 fuera del cambio de PIN. */
class PinDebeCambiarError extends Error {
    constructor() {
        super(MENSAJE_DEBE_CAMBIAR);
        this.codigo = 'PIN_DEBE_CAMBIAR';
        this.statusCode = 409;
    }
}

/** Error que devuelve el bloqueo cuando se lanza desde una capa sin HTTP
 *  (PersonaService), para que el handler que sí tiene HTTP responda 423. */
class PinBloqueadoError extends Error {
    constructor(hasta) {
        const min = minutos((new Date(hasta) - new Date()) / 1000);
        super(`Cuenta bloqueada temporalmente por intentos fallidos. Inténtalo de nuevo en ${min} minuto${min === 1 ? '' : 's'}.`);
        this.codigo = 'PIN_BLOQUEADO';
        this.statusCode = 423;
        this.hasta = hasta;
    }
}

/**
 * Verifica un PIN respetando el bloqueo de la persona.
 *
 * @param {object} persona - ya cargada por el llamador (getById reciente).
 * @param {string} pinIngresado
 * @param {(pin: string, hash: string, personaId: string) => Promise<boolean>} verificar
 *        inyectado para no crear una dependencia circular con validation.js.
 * @returns {Promise<{ok: boolean, bloqueada: boolean, hasta: string|null, mensaje: string|null}>}
 */
async function verificarConLimite(persona, pinIngresado, verificar, { permitirAnterior = false } = {}) {
    const ahora = new Date();

    if (persona.pinBloqueadaHasta && new Date(persona.pinBloqueadaHasta) > ahora) {
        // Bloqueada: se rechaza sin correr scrypt y sin tocar contador ni bloqueo.
        const min = minutos((new Date(persona.pinBloqueadaHasta) - ahora) / 1000);
        return {
            ok: false,
            bloqueada: true,
            hasta: persona.pinBloqueadaHasta,
            mensaje: `Cuenta bloqueada temporalmente por intentos fallidos. Inténtalo de nuevo en ${min} minuto${min === 1 ? '' : 's'}.`,
        };
    }

    // Formato antes de comparar: ni un PIN de 4 (salvo para cambiarlo) ni algo
    // que no sea un PIN llegan a scrypt, y no cuentan como intento.
    const pin = typeof pinIngresado === 'string' ? pinIngresado : '';
    const anterior = FORMATO_PIN_ANTERIOR.test(pin);
    if (!FORMATO_PIN.test(pin) && !(permitirAnterior && anterior)) {
        return {
            ok: false, bloqueada: false, hasta: null, debeCambiar: anterior,
            mensaje: anterior ? MENSAJE_DEBE_CAMBIAR : 'El PIN debe tener 6 dígitos.',
        };
    }

    const valido = await verificar(pin, persona._pinHash, persona.personaId);

    if (valido) {
        await limpiar(persona.tenantId, persona.personaId);
        return { ok: true, bloqueada: false, hasta: null, mensaje: null };
    }

    const { fallos, bloqueadaHasta } = await registrarFalloYQuizasBloquear(persona.tenantId, persona.personaId);
    if (bloqueadaHasta) {
        registrarBloqueo(persona.personaId, fallos, duracionPara(fallos));
        const min = minutos((new Date(bloqueadaHasta) - ahora) / 1000);
        return {
            ok: false,
            bloqueada: true,
            hasta: bloqueadaHasta,
            mensaje: `Cuenta bloqueada temporalmente por intentos fallidos. Inténtalo de nuevo en ${min} minuto${min === 1 ? '' : 's'}.`,
        };
    }

    return { ok: false, bloqueada: false, hasta: null, mensaje: 'PIN incorrecto' };
}

/**
 * Igual que `verificarConLimite`, pero lanza `PinBloqueadoError` en vez de
 * devolver un resultado, para capas de servicio sin contexto HTTP
 * (`PersonaService`). El llamador que sí tiene HTTP debe capturar
 * `err.codigo === 'PIN_BLOQUEADO'` y responder 423.
 */
async function verificarConLimiteOLanzar(persona, pinIngresado, verificar, opciones = {}) {
    const r = await verificarConLimite(persona, pinIngresado, verificar, opciones);
    if (r.bloqueada) throw new PinBloqueadoError(r.hasta);
    if (r.debeCambiar) throw new PinDebeCambiarError();
    return r.ok;
}

/**
 * PIN distintos equivocados que una misma sincronización puede probar sin gastar
 * otro intento. Ver `verificarSobre`.
 */
const PINES_POR_SINCRONIZACION = 3;
const FORMATO_SINCRONIZACION = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Verifica el PIN de un sobre de firma sin conexión (D-36).
 *
 * Un intento por sincronización y por persona, no uno por firma: quien dejó diez
 * firmas con el PIN mal escrito no se bloquea de golpe al volver la señal, y una
 * cola no sirve para bloquear a un compañero.
 *
 * Pero la sincronización la nombra el cliente: si todo lo que llegara con el mismo
 * nombre fuera gratis, sería una forma de probar PIN sin límite. Por eso:
 *   - el mismo PIN equivocado repetido nunca vuelve a contar (no enseña nada);
 *   - hasta 3 PIN distintos equivocados cuentan como un solo intento;
 *   - del cuarto en adelante, cada uno cuenta;
 *   - si dos peticiones chocan al anotar, la que pierde cuenta.
 *
 * @returns {Promise<{ok: boolean, bloqueada?: boolean, comprobado?: boolean, debeCambiar?: boolean}>}
 *   `bloqueada` sin `comprobado`: la cuenta YA estaba bloqueada y este PIN no se
 *   miró; la firma tiene que esperar en la cola. `comprobado` con `ok: false`: el
 *   PIN está mal, y esa firma no va a entrar nunca, aunque este intento haya
 *   provocado el bloqueo (si volviera a la cola, re-bloquearía para siempre).
 */
async function verificarSobre(persona, pinIngresado, verificar, sincronizacion) {
    if (persona.pinBloqueadaHasta && new Date(persona.pinBloqueadaHasta) > new Date()) {
        return { ok: false, bloqueada: true, comprobado: false, hasta: persona.pinBloqueadaHasta };
    }
    const pin = typeof pinIngresado === 'string' ? pinIngresado : '';
    if (!FORMATO_PIN.test(pin)) {
        return { ok: false, bloqueada: false, comprobado: false, debeCambiar: FORMATO_PIN_ANTERIOR.test(pin) };
    }
    if (await verificar(pin, persona._pinHash, persona.personaId)) {
        await limpiar(persona.tenantId, persona.personaId);
        return { ok: true, bloqueada: false, comprobado: true };
    }

    let cuenta = true;
    if (FORMATO_SINCRONIZACION.test(sincronizacion || '')) {
        const previo = persona.intentoSobre?.sincronizacion === sincronizacion ? persona.intentoSobre : null;
        const huellas = previo?.huellas || [];
        const huella = await huellaIntentoPin(persona.personaId, sincronizacion, pin);
        if (huellas.includes(huella)) return { ok: false, bloqueada: false, comprobado: true };
        // El primero de la sincronización cuenta; los dos siguientes distintos, no.
        const gratis = previo && huellas.length < PINES_POR_SINCRONIZACION;
        const version = persona.intentoSobreV || 0;
        try {
            await docClient.send(new UpdateCommand({
                TableName: PERSONAS_TABLE,
                Key: claveDe(persona.tenantId, persona.personaId),
                UpdateExpression: 'SET intentoSobre = :e, intentoSobreV = :nueva',
                ConditionExpression: 'attribute_not_exists(intentoSobreV) OR intentoSobreV = :v',
                ExpressionAttributeValues: {
                    ':e': { sincronizacion, huellas: [...huellas, huella].slice(-8) },
                    ':nueva': version + 1,
                    ':v': version,
                },
            }));
            cuenta = !gratis;
        } catch (err) {
            if (err.name !== 'ConditionalCheckFailedException') throw err;
            cuenta = true;
        }
    }
    if (!cuenta) return { ok: false, bloqueada: false, comprobado: true };

    const { fallos, bloqueadaHasta } = await registrarFalloYQuizasBloquear(persona.tenantId, persona.personaId);
    if (bloqueadaHasta) registrarBloqueo(persona.personaId, fallos, duracionPara(fallos));
    return { ok: false, bloqueada: Boolean(bloqueadaHasta), comprobado: true };
}

/** Igual que en toda la tabla de personas: `PK: TENANT#{tenantId}`,
 *  `SK: PERSONA#{personaId}`. Nunca se resuelve por índice acá — la persona ya
 *  llegó cargada (con su `tenantId`) desde el llamador. */
const claveDe = (tenantId, personaId) => ({ PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` });

/** Incrementa el contador de forma atómica; si el nuevo valor cae en un
 *  múltiplo de `CADA`, fija el bloqueo en la misma operación. */
async function registrarFalloYQuizasBloquear(tenantId, personaId) {
    const incremento = await docClient.send(new UpdateCommand({
        TableName: PERSONAS_TABLE,
        Key: claveDe(tenantId, personaId),
        UpdateExpression: 'ADD pinIntentosFallidos :uno SET updatedAt = :ahora',
        ExpressionAttributeValues: { ':uno': 1, ':ahora': new Date().toISOString() },
        ReturnValues: 'UPDATED_NEW',
    }));
    const fallos = Number(incremento.Attributes?.pinIntentosFallidos || 0);

    if (fallos > 0 && fallos % CADA === 0) {
        const hasta = new Date(Date.now() + duracionPara(fallos) * 1000).toISOString();
        await docClient.send(new UpdateCommand({
            TableName: PERSONAS_TABLE,
            Key: claveDe(tenantId, personaId),
            UpdateExpression: 'SET pinBloqueadaHasta = :hasta',
            ExpressionAttributeValues: { ':hasta': hasta },
        }));
        return { fallos, bloqueadaHasta: hasta };
    }

    return { fallos, bloqueadaHasta: null };
}

/** Limpia el contador y el bloqueo. Se llama en el primer PIN correcto. */
async function limpiar(tenantId, personaId) {
    await docClient.send(new UpdateCommand({
        TableName: PERSONAS_TABLE,
        Key: claveDe(tenantId, personaId),
        UpdateExpression: 'REMOVE pinBloqueadaHasta SET pinIntentosFallidos = :cero',
        ExpressionAttributeValues: { ':cero': 0 },
    }));
}

module.exports = {
    verificarConLimite,
    verificarConLimiteOLanzar,
    verificarSobre,
    PINES_POR_SINCRONIZACION,
    PinBloqueadoError,
    PinDebeCambiarError,
    MENSAJE_DEBE_CAMBIAR,
    NOMBRE_METRICA,
    CADA,
    DURACIONES_SEGUNDOS,
};
