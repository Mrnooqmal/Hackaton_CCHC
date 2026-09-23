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
async function verificarConLimite(persona, pinIngresado, verificar) {
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

    const valido = await verificar(pinIngresado, persona._pinHash, persona.personaId);

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
async function verificarConLimiteOLanzar(persona, pinIngresado, verificar) {
    const r = await verificarConLimite(persona, pinIngresado, verificar);
    if (r.bloqueada) throw new PinBloqueadoError(r.hasta);
    return r.ok;
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
    PinBloqueadoError,
    NOMBRE_METRICA,
    CADA,
    DURACIONES_SEGUNDOS,
};
