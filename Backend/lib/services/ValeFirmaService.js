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

/** Tope de vales por solicitud (una firma consume uno). */
const MAX_POR_SOLICITUD = 20;

/**
 * Cuántos se emiten si no se pide otra cantidad: un turno de terreno firma pocas
 * cosas (la charla, una entrega de EPP, alguna encuesta), y menos vales en el
 * equipo es menos lo que puede usar quien lo tome.
 */
const VALES_POR_TURNO = 5;

/**
 * Hasta cuándo se acepta un vale vencido, mandando la firma a revisión. Después
 * de esto se rechaza: la cadena de prueba ya no se sostiene.
 */
const VENTANA_REVISION_DIAS = 30;

/** Igual que el token de sesión: se guarda el hash, el vale solo existe en el dispositivo. */
const hashVale = (vale) => crypto.createHash('sha256').update(String(vale)).digest('hex');

/** ¿El vale estaba vencido en ese momento? En un reintento cuenta cuándo se gastó, no cuándo se reintenta. */
const vencidoAl = (registro, momento) => new Date(registro.expiresAt) < new Date(momento);

/** Motivo de anulación de los vales de una persona desvinculada (ver `consumir`). */
const MOTIVO_DESVINCULACION = 'desvinculacion';

const PERSONAS_TABLE = process.env.PERSONAS_TABLE || 'Personas';

/**
 * Vales inválidos presentados a nombre de una persona antes de anular los suyos.
 *
 * En el equipo, los vales se guardan cifrados con una llave derivada del PIN,
 * sin etiqueta de verificación y con un solo byte de comprobación (ver
 * Frontend/src/utils/valesCifrados.ts). Quien copie el almacenamiento puede
 * descartar PIN fuera de la app, pero le quedan cientos o miles de candidatos
 * y solo puede confirmarlos presentando vales aquí. Cada vale que no existe,
 * presentado a nombre de una persona de la empresa, cuenta; al quinto se anulan
 * los vales vigentes de esa persona y queda registrado.
 *
 * El contador vuelve a cero solo al emitir vales nuevos, que exige el PIN con
 * red. Un vale válido NO lo reinicia: quien ya acertó con un candidato no debe
 * ganar más intentos para el resto.
 */
const MAX_VALES_INVALIDOS = 5;
const MOTIVO_VALES_INVALIDOS = 'vales_invalidos';

const MOTIVOS = {
    NO_EXISTE: 'no_existe',
    OTRA_PERSONA: 'otra_persona',
    OTRA_EMPRESA: 'otra_empresa',
    OTRA_OBRA: 'otra_obra',
    YA_USADO: 'ya_usado',
    DEMASIADO_VIEJO: 'demasiado_viejo',
    REVOCADO: 'revocado',
};

class ValeFirmaService {
    /**
     * Emite vales para una persona. Quien llama ya validó su PIN.
     *
     * @returns {Promise<{vales: string[], expiraEn: string}>} los vales EN CLARO.
     *          Es la única vez que existen fuera del dispositivo: no se guardan.
     */
    static async emitir({ personaId, tenantId, obraId, cantidad = VALES_POR_TURNO, deviceId = null, emitidoPor = null }) {
        // El vale queda atado a la persona y a la obra del turno (no a cada
        // documento o actividad, para que una charla armada en terreno también se
        // pueda firmar). Sin obra no se emite.
        if (!obraId) throw new Error('Falta la obra del turno para emitir vales');
        const n = Math.min(Math.max(Number(cantidad) || VALES_POR_TURNO, 1), MAX_POR_SOLICITUD);
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
                    obraId,
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

        // Emitir exige el PIN con red: la persona demostró conocerlo. El conteo de
        // vales inválidos empieza de nuevo.
        try {
            await docClient.send(new UpdateCommand({
                TableName: PERSONAS_TABLE,
                Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
                UpdateExpression: 'SET valesInvalidos = :cero',
                ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeValues: { ':cero': 0 },
            }));
        } catch (err) {
            if (err.name !== 'ConditionalCheckFailedException') throw err;
        }

        return { vales, expiraEn: expira.toISOString(), vigenciaHoras: VIGENCIA_HORAS };
    }

    /**
     * Cuenta un vale inexistente presentado a nombre de una persona y, al quinto,
     * anula sus vales vigentes. Solo cuenta para personas de la empresa de la
     * sesión que sincroniza: la condición sobre la clave evita crear registros
     * fantasma con un personaId inventado.
     *
     * @returns {Promise<{invalidos: number, anulados: boolean}>}
     */
    static async registrarInvalido({ personaId, tenantId }) {
        if (!personaId || !tenantId) return { invalidos: 0, anulados: false };
        let invalidos;
        try {
            const r = await docClient.send(new UpdateCommand({
                TableName: PERSONAS_TABLE,
                Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
                UpdateExpression: 'ADD valesInvalidos :uno',
                ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeValues: { ':uno': 1 },
                ReturnValues: 'UPDATED_NEW',
            }));
            invalidos = Number(r.Attributes?.valesInvalidos || 0);
        } catch (err) {
            if (err.name === 'ConditionalCheckFailedException') return { invalidos: 0, anulados: false };
            throw err;
        }
        if (invalidos < MAX_VALES_INVALIDOS || invalidos % MAX_VALES_INVALIDOS !== 0) return { invalidos, anulados: false };

        const resultado = await ValeFirmaService.revocarDePersona(personaId, { tenantId, motivo: MOTIVO_VALES_INVALIDOS, por: null });
        try {
            // Métrica embebida (EMF), armada campo a campo como en `limitePin`:
            // solo identificadores y conteos.
            const linea = {
                _aws: {
                    Timestamp: Date.now(),
                    CloudWatchMetrics: [{ Namespace: 'BuildAndServe', Dimensions: [['stage']], Metrics: [{ Name: 'ValesInvalidos', Unit: 'Count' }] }],
                },
                stage: process.env.STAGE || 'desconocido',
                ValesInvalidos: 1,
                tenantId,
                personaId,
                invalidos,
                revocados: resultado.revocados,
            };
            console.error('VALES_INVALIDOS', JSON.stringify(linea));
        } catch { /* registrar no puede romper la anulación */ }
        return { invalidos, anulados: true };
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
    static async consumir({ vale, personaId, tenantId = null, obraId = null, deviceId = null, idFirmaLocal = null }) {
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
        if (!registro) {
            // Un vale que no existe es lo que produce un PIN equivocado al
            // descifrar en el equipo: cuenta para la persona (ver MAX_VALES_INVALIDOS).
            const { anulados } = await ValeFirmaService.registrarInvalido({ personaId, tenantId });
            return { ok: false, motivo: MOTIVOS.NO_EXISTE, anulados };
        }
        if (registro.personaId !== personaId) return { ok: false, motivo: MOTIVOS.OTRA_PERSONA };
        // La cola sin conexión la puede sincronizar cualquier sesión de la
        // empresa, nunca una de otra: el vale tiene que ser de la empresa de lo
        // que se firma.
        if (tenantId && registro.tenantId !== tenantId) return { ok: false, motivo: MOTIVOS.OTRA_EMPRESA };
        // El vale de la obra X sirve para lo de la obra X y para lo que no tiene
        // obra (los documentos de empresa, como el Reglamento Interno). Un vale
        // sin obra no se acepta: desde que se exige al emitir, no debería existir.
        if (!registro.obraId || (obraId && registro.obraId !== obraId)) return { ok: false, motivo: MOTIVOS.OTRA_OBRA };
        // Un vale anulado por DESVINCULACIÓN se puede gastar igual, y la firma
        // entra en revisión (ver FirmaService): pudo haberse tomado en terreno
        // antes de desvincular, y descartarla destruiría evidencia. Cualquier
        // otra anulación (PIN restablecido, contención) se rechaza.
        const porDesvinculacion = Boolean(registro.revocadoEn) && registro.motivoRevocacion === MOTIVO_DESVINCULACION;

        // Reintento de la MISMA firma: el vale se gastó en un intento anterior
        // que no alcanzó a escribir la firma (o cuya respuesta se perdió). La
        // firma la identifica el equipo con `idFirmaLocal`, que se anota al
        // gastar. Con el mismo identificador es la misma firma y sigue; con otro
        // es un segundo uso y se rechaza. Sin esto, una falla justo después de
        // gastar el vale perdía la firma: el reintento recibía "ya usado".
        if (registro.usedAt) {
            if (idFirmaLocal && registro.usadoPara === idFirmaLocal) {
                return {
                    ok: true, vale: registro, vencido: vencidoAl(registro, registro.usedAt), reintento: true,
                    revocadoPorDesvinculacion: porDesvinculacion,
                };
            }
            return { ok: false, motivo: MOTIVOS.YA_USADO };
        }
        if (registro.revocadoEn && !porDesvinculacion) {
            return { ok: false, motivo: MOTIVOS.REVOCADO, motivoRevocacion: registro.motivoRevocacion || null };
        }

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
                UpdateExpression: 'SET usedAt = :ahora, deviceIdUso = :dev, usadoPara = :para',
                // Ni gastado ni revocado: con la condición simétrica de
                // `revocarDePersona`, consumir y revocar se excluyen aunque
                // lleguen a la vez. Un vale anulado por desvinculación se gasta
                // si sigue anulado por eso mismo.
                ConditionExpression: porDesvinculacion
                    ? '(attribute_not_exists(usedAt) OR usedAt = :nulo) AND motivoRevocacion = :desv'
                    : '(attribute_not_exists(usedAt) OR usedAt = :nulo) AND attribute_not_exists(revocadoEn)',
                ExpressionAttributeValues: {
                    ':ahora': ahora.toISOString(),
                    ':dev': deviceId || null,
                    ':para': idFirmaLocal || null,
                    ':nulo': null,
                    ...(porDesvinculacion ? { ':desv': MOTIVO_DESVINCULACION } : {}),
                },
            }));
        } catch (err) {
            // La condición falló: otro intento lo gastó primero, o se revocó
            // entre la lectura y la escritura. Se relee para decir cuál. Si el
            // que lo gastó fue un intento de esta misma firma (dos envíos a la
            // vez), es el mismo caso que el reintento.
            if (err.name === 'ConditionalCheckFailedException') {
                const ahoraRes = await docClient.send(new GetCommand({
                    TableName: VALES_TABLE, Key: { valeHash: registro.valeHash }, ConsistentRead: true,
                }));
                const actual = ahoraRes.Item || {};
                if (actual.usedAt && idFirmaLocal && actual.usadoPara === idFirmaLocal) {
                    return {
                        ok: true, vale: actual, vencido: vencidoAl(actual, actual.usedAt), reintento: true,
                        revocadoPorDesvinculacion: actual.motivoRevocacion === MOTIVO_DESVINCULACION,
                    };
                }
                if (!actual.usedAt && actual.revocadoEn) {
                    return { ok: false, motivo: MOTIVOS.REVOCADO, motivoRevocacion: actual.motivoRevocacion || null };
                }
                return { ok: false, motivo: MOTIVOS.YA_USADO };
            }
            throw err;
        }

        return { ok: true, vale: registro, vencido, revocadoPorDesvinculacion: porDesvinculacion };
    }

    /**
     * La credencial de una firma con vale, tal como la manda el equipo. Una sola
     * definición para los tres caminos que aceptan vales (documento, asistencia
     * y encuesta).
     */
    static credencialDelCuerpo(body = {}) {
        return {
            vale: body.vale,
            deviceId: body.deviceId || null,
            timestampLocal: body.timestampLocal || null,
            idFirmaLocal: typeof body.idFirmaLocal === 'string' && body.idFirmaLocal ? body.idFirmaLocal.slice(0, 100) : null,
        };
    }

    /**
     * Invalida los vales sin usar de una persona en una empresa. Se usa al
     * restablecer su PIN: los vales se desbloquearon con el PIN anterior, y si
     * ese PIN es el que estaba comprometido, los vales que alguien retenga en un
     * equipo siguen firmando a su nombre sin conexión.
     *
     * Hasta el 27 de septiembre de 2026 esto no tenía llamadores, y se tragaba
     * los errores: si la consulta fallaba devolvía "0 revocados" como si no
     * hubiera nada que revocar. Ahora la consulta falla hacia arriba, y cada vale
     * que no se pudo revocar se cuenta aparte, para que quien llama sepa que
     * quedó trabajo sin hacer en vez de creer que se hizo.
     *
     * Revocar ya no escribe `usedAt`: un vale revocado no es un vale usado, y el
     * acta tiene que poder distinguirlos. `revocadoEn` y la condición de
     * `consumir` se excluyen mutuamente, así que un vale nunca termina gastado Y
     * revocado aunque ambas cosas pasen a la vez.
     *
     * El índice proyecta solo `usedAt` (D-8), así que la empresa se exige en la
     * condición de la escritura y no en la lectura.
     *
     * @returns {Promise<{revocados: number, noAplicaban: number, fallidos: number}>}
     *          `noAplicaban`: ya usado, ya revocado, o de otra empresa.
     */
    static async revocarDePersona(personaId, { tenantId, motivo, por }) {
        if (!tenantId) throw new Error('revocarDePersona: falta la empresa');
        const resultado = { revocados: 0, noAplicaban: 0, fallidos: 0 };
        const ahora = new Date().toISOString();

        let desde;
        do {
            const pagina = await docClient.send(new QueryCommand({
                TableName: VALES_TABLE,
                IndexName: 'personaId-index',
                KeyConditionExpression: 'personaId = :p',
                ExpressionAttributeValues: { ':p': personaId },
                ExclusiveStartKey: desde,
            }));
            for (const registro of (pagina.Items || [])) {
                if (registro.usedAt) { resultado.noAplicaban += 1; continue; }
                try {
                    await docClient.send(new UpdateCommand({
                        TableName: VALES_TABLE,
                        Key: { valeHash: registro.valeHash },
                        UpdateExpression: 'SET revocadoEn = :ahora, motivoRevocacion = :motivo, revocadoPor = :por',
                        ConditionExpression: 'tenantId = :t AND (attribute_not_exists(usedAt) OR usedAt = :nulo)'
                            + ' AND attribute_not_exists(revocadoEn)',
                        ExpressionAttributeValues: {
                            ':ahora': ahora, ':motivo': motivo || null, ':por': por || null,
                            ':t': tenantId, ':nulo': null,
                        },
                    }));
                    resultado.revocados += 1;
                } catch (err) {
                    if (err.name === 'ConditionalCheckFailedException') resultado.noAplicaban += 1;
                    else resultado.fallidos += 1;
                }
            }
            desde = pagina.LastEvaluatedKey;
        } while (desde);

        return resultado;
    }
}

module.exports = {
    ValeFirmaService,
    VALES_TABLE,
    VIGENCIA_HORAS,
    MAX_POR_SOLICITUD,
    VALES_POR_TURNO,
    MOTIVO_DESVINCULACION,
    MOTIVO_VALES_INVALIDOS,
    MAX_VALES_INVALIDOS,
    VENTANA_REVISION_DIAS,
    MOTIVOS,
    hashVale,
};
