/**
 * Vales de firma: credencial de un solo uso para firmar SIN CONEXIÓN.
 *
 * ── El problema ──────────────────────────────────────────────────────────────
 *
 * Firmar sin red obligaba a guardar el PIN del trabajador en el dispositivo, en
 * claro, hasta poder sincronizar: el servidor necesita el PIN para validar la
 * firma, así que el dispositivo no tenía otra cosa que retener. En un equipo
 * compartido de terreno —el caso normal— cualquiera que lo tomara leía los PIN
 * de quienes habían firmado, y con un PIN se firma a nombre de esa persona.
 *
 * ── La solución ──────────────────────────────────────────────────────────────
 *
 * Al empezar el turno, CON red, el trabajador teclea su PIN una vez en ese
 * dispositivo. El servidor lo valida y emite N vales: 32 bytes aleatorios cada
 * uno, de los que solo guarda el hash. El dispositivo guarda los vales; el PIN
 * no se guarda nunca. Sin red, la firma consume un vale. Al sincronizar, el
 * servidor comprueba que el vale existe, que es de esa persona y que no se ha
 * usado antes.
 *
 * Lo que acredita la firma cambia de forma explícita: ya no es el PIN en el
 * instante de firmar, sino un vale que esa persona desbloqueó personalmente con
 * su PIN al inicio del turno. Es una cadena más débil que la firma en línea y
 * más fuerte que la anterior, y —esto es lo que importa— queda declarada en el
 * acta en vez de darse por equivalente.
 *
 * ── Dos decisiones que conviene entender antes de tocar esto ─────────────────
 *
 * 1. **Un vale vencido NO invalida la firma: la manda a revisión.** El turno se
 *    alarga, el equipo no ve red en dos días, y la firma ya ocurrió. Descartarla
 *    destruye evidencia de un acto real y castiga al trabajador por una falla de
 *    red. Pero un vale vencido debilita la prueba, así que la firma se registra
 *    marcada (`requiereRevision`), NO cuenta como cumplimiento hasta que alguien
 *    con permiso la confirma, y el acta dice exactamente qué pasó: cuándo se
 *    emitió el vale, cuándo venció, cuándo se sincronizó y quién la confirmó.
 *    Pasado `VENTANA_REVISION_DIAS` ya no se acepta: en algún punto la cadena es
 *    demasiado débil y un vale viejo no puede resucitar.
 *
 * 2. **El `deviceId` es una traza, no un factor de validación.** Un navegador de
 *    terreno regenera su identificador al limpiar datos o al cambiar de perfil.
 *    Si el vale dependiera de él, el trabajador quedaría sin poder firmar sin red
 *    y sin entender por qué. Acá el `deviceId` se guarda para el acta —en qué
 *    equipo se desbloqueó y en cuál se usó— y NO se compara al validar. Nótese
 *    además que si el navegador pierde su identificador también perdió los vales
 *    (viven en el mismo almacenamiento), así que el caso real no es "vale
 *    rechazado" sino "este equipo se quedó sin vales": se resuelve volviendo a
 *    pedirlos con red, que es un paso que el trabajador ya conoce.
 */

const crypto = require('crypto');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');

const VALES_TABLE = process.env.VALES_TABLE || 'ValesFirma';

/** Vigencia de un vale: un turno. */
const VIGENCIA_HORAS = 12;

/** Cuántos vales se emiten por solicitud (una firma consume uno). */
const MAX_POR_SOLICITUD = 20;

/**
 * Hasta cuándo se acepta un vale vencido, mandando la firma a revisión. Después
 * de esto se rechaza: la cadena de prueba ya no se sostiene.
 */
const VENTANA_REVISION_DIAS = 30;

/** Igual que el token de sesión: se guarda el hash, el vale solo existe en el dispositivo. */
const hashVale = (vale) => crypto.createHash('sha256').update(String(vale)).digest('hex');

const MOTIVOS = {
    NO_EXISTE: 'no_existe',
    OTRA_PERSONA: 'otra_persona',
    YA_USADO: 'ya_usado',
    DEMASIADO_VIEJO: 'demasiado_viejo',
};

class ValeFirmaService {
    /**
     * Emite vales para una persona. Quien llama ya validó su PIN.
     *
     * @returns {Promise<{vales: string[], expiraEn: string}>} los vales EN CLARO.
     *          Es la única vez que existen fuera del dispositivo: no se guardan.
     */
    static async emitir({ personaId, tenantId, cantidad = 10, deviceId = null, emitidoPor = null }) {
        const n = Math.min(Math.max(Number(cantidad) || 1, 1), MAX_POR_SOLICITUD);
        const ahora = new Date();
        const expira = new Date(ahora.getTime() + VIGENCIA_HORAS * 60 * 60 * 1000);

        const vales = [];
        for (let i = 0; i < n; i += 1) {
            const vale = crypto.randomBytes(32).toString('hex');
            vales.push(vale);
            await docClient.send(new PutCommand({
                TableName: VALES_TABLE,
                Item: {
                    valeHash: hashVale(vale),
                    personaId,
                    tenantId,
                    // Traza, no condición (ver el encabezado).
                    deviceIdEmision: deviceId || null,
                    emitidoPor: emitidoPor || personaId,
                    createdAt: ahora.toISOString(),
                    expiresAt: expira.toISOString(),
                    usedAt: null,
                    // El vale se borra solo bastante después de vencer, para que la
                    // ventana de revisión pueda comprobar que existió.
                    ttl: Math.floor(expira.getTime() / 1000) + VENTANA_REVISION_DIAS * 24 * 60 * 60,
                },
            }));
        }

        return { vales, expiraEn: expira.toISOString(), vigenciaHoras: VIGENCIA_HORAS };
    }

    /**
     * Consume un vale.
     *
     * El uso único se garantiza con una escritura condicional: dos intentos de
     * sincronizar la misma firma no pueden gastar el mismo vale dos veces, aunque
     * lleguen a la vez.
     *
     * @returns {Promise<{ok: boolean, motivo?: string, vale?: object, vencido?: boolean}>}
     */
    static async consumir({ vale, personaId, deviceId = null }) {
        if (!vale) return { ok: false, motivo: MOTIVOS.NO_EXISTE };

        // Lectura directa por clave primaria, y consistente.
        //
        // Antes esto consultaba un índice `valeHash-index` que yo mismo agregué al
        // diseñar los vales y que era una copia completa de la tabla con la MISMA
        // clave: `valeHash` ya es la partición. Además de duplicar hashes de
        // credenciales sin motivo, tenía una consecuencia real: los índices son de
        // consistencia eventual, así que un vale recién emitido podía no estar
        // visible todavía y devolverse como "no existe" a alguien que acababa de
        // pedirlo.
        const res = await docClient.send(new GetCommand({
            TableName: VALES_TABLE,
            Key: { valeHash: hashVale(vale) },
            ConsistentRead: true,
        }));

        const registro = res.Item;
        if (!registro) return { ok: false, motivo: MOTIVOS.NO_EXISTE };
        if (registro.personaId !== personaId) return { ok: false, motivo: MOTIVOS.OTRA_PERSONA };
        if (registro.usedAt) return { ok: false, motivo: MOTIVOS.YA_USADO };

        const ahora = new Date();
        const expira = new Date(registro.expiresAt);
        const vencido = expira < ahora;
        const limite = new Date(expira.getTime() + VENTANA_REVISION_DIAS * 24 * 60 * 60 * 1000);
        if (vencido && limite < ahora) {
            return { ok: false, motivo: MOTIVOS.DEMASIADO_VIEJO, vale: registro };
        }

        try {
            await docClient.send(new UpdateCommand({
                TableName: VALES_TABLE,
                Key: { valeHash: registro.valeHash },
                UpdateExpression: 'SET usedAt = :ahora, deviceIdUso = :dev',
                ConditionExpression: 'attribute_not_exists(usedAt) OR usedAt = :nulo',
                ExpressionAttributeValues: {
                    ':ahora': ahora.toISOString(),
                    ':dev': deviceId || null,
                    ':nulo': null,
                },
            }));
        } catch (err) {
            // La condición falló: otro intento lo gastó primero.
            if (err.name === 'ConditionalCheckFailedException') {
                return { ok: false, motivo: MOTIVOS.YA_USADO };
            }
            throw err;
        }

        return { ok: true, vale: registro, vencido };
    }

    /** Invalida los vales sin usar de una persona (cierre de sesión, desvinculación). */
    static async revocarDePersona(personaId) {
        const res = await docClient.send(new QueryCommand({
            TableName: VALES_TABLE,
            IndexName: 'personaId-index',
            KeyConditionExpression: 'personaId = :p',
            ExpressionAttributeValues: { ':p': personaId },
        })).catch(() => ({ Items: [] }));

        let revocados = 0;
        for (const registro of (res.Items || [])) {
            if (registro.usedAt) continue;
            await docClient.send(new UpdateCommand({
                TableName: VALES_TABLE,
                Key: { valeHash: registro.valeHash },
                UpdateExpression: 'SET usedAt = :ahora, revocado = :si',
                ExpressionAttributeValues: { ':ahora': new Date().toISOString(), ':si': true },
            })).catch(() => {});
            revocados += 1;
        }
        return revocados;
    }
}

module.exports = {
    ValeFirmaService,
    VALES_TABLE,
    VIGENCIA_HORAS,
    MAX_POR_SOLICITUD,
    VENTANA_REVISION_DIAS,
    MOTIVOS,
    hashVale,
};
