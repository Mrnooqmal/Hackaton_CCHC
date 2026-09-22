/**
 * Licencias de alta: la invitación de un solo uso con la que una empresa hace su
 * propio onboarding.
 *
 * ── El modelo ────────────────────────────────────────────────────────────────
 *
 * El alta de empresas no puede ser pública —ya lo fue, protegida por un código
 * compartido que además estaba vacío— y tampoco puede seguir siendo un script
 * que teclea los datos de otro. La licencia separa las dos autorizaciones:
 *
 *   - **quién puede dar de alta una empresa**: nosotros, con credenciales de AWS,
 *     emitiendo la licencia (`scripts/emitir-licencia.js`);
 *   - **quién llena los datos de esa empresa**: su administrador, por interfaz,
 *     una sola vez, con el enlace que le llegó por correo.
 *
 * Es el mismo patrón que la recuperación de contraseña y que los vales de firma:
 * el secreto vive en el correo de quien lo recibe, acá se guarda solo su hash, y
 * se consume una vez.
 *
 * ── Por qué el hash es la clave primaria ─────────────────────────────────────
 *
 * Para poder consumir la licencia con una escritura condicionada sobre la clave,
 * sin pasar por un índice. Un índice global es de consistencia eventual: ya nos
 * pasó con los vales, donde uno recién emitido podía leerse como inexistente.
 * Acá sería peor —"tu enlace no sirve" a quien acaba de recibirlo—, así que el
 * camino caliente no toca ningún índice.
 *
 * El `licenciaId` es solo para hablar de una licencia sin tener su token: es lo
 * que muestra el listado y lo que recibe `--revocar`.
 */

const crypto = require('crypto');
const { PutCommand, GetCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../clients/dynamodb');
const { registrarFallo } = require('../degradacion');

const LICENCIAS_TABLE = process.env.LICENCIAS_TABLE || 'Licencias';

/** Vigencia por omisión del enlace. */
const DIAS_VIGENCIA = 7;

/** Cuánto sobrevive el registro después de vencer, para poder explicarlo. */
const DIAS_RETENCION = 90;

const ESTADOS = { EMITIDA: 'emitida', USADA: 'usada', REVOCADA: 'revocada' };

/**
 * Motivos por los que una licencia no sirve. **No salen hacia afuera**: la
 * respuesta pública es siempre la misma. Se registran por dentro, porque
 * distinguir "vencida" de "ya usada" es justo lo que necesita quien atiende a
 * una empresa que no puede entrar.
 */
const MOTIVOS = {
    NO_EXISTE: 'no_existe',
    VENCIDA: 'vencida',
    REVOCADA: 'revocada',
    YA_USADA: 'ya_usada',
};

/** Igual que el token de sesión: el token son 32 bytes aleatorios, así que no
 *  hay espacio de búsqueda que precalcular y no lleva sal. */
const hashLicencia = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

class LicenciaService {
    /**
     * Emite una licencia. Devuelve el token EN CLARO: es la única vez que existe
     * fuera del correo de su destinatario.
     */
    static async emitir({ email, prellenado = {}, emitidaPor, diasVigencia = DIAS_VIGENCIA }) {
        if (!email) throw new Error('La licencia necesita el correo de su destinatario');

        const token = crypto.randomBytes(32).toString('hex');
        const ahora = new Date();
        const expira = new Date(ahora.getTime() + diasVigencia * 24 * 60 * 60 * 1000);
        const licenciaId = uuidv4();

        await docClient.send(new PutCommand({
            TableName: LICENCIAS_TABLE,
            Item: {
                licenciaHash: hashLicencia(token),
                licenciaId,
                // El correo queda FIJADO acá. El formulario no lo puede cambiar:
                // si pudiera, una licencia emitida para una empresa serviría para
                // dar de alta a cualquier otra.
                email: String(email).trim().toLowerCase(),
                prellenado: {
                    nombre: prellenado.nombre || null,
                    rutEmpresa: prellenado.rutEmpresa || null,
                },
                estado: ESTADOS.EMITIDA,
                expiresAt: expira.toISOString(),
                emitidaPor: emitidaPor || 'operador',
                emitidaEn: ahora.toISOString(),
                usedAt: null,
                usedIp: null,
                tenantId: null,
                // Previsto, no implementado: el día que haya planes, el plan se
                // acuerda al emitir la invitación, no después.
                plan: null,
                ttl: Math.floor(expira.getTime() / 1000) + DIAS_RETENCION * 24 * 60 * 60,
            },
            ConditionExpression: 'attribute_not_exists(licenciaHash)',
        }));

        return { token, licenciaId, expiraEn: expira.toISOString(), diasVigencia };
    }

    /**
     * ¿Sirve este enlace? Devuelve `{ok:false, motivo}` con el motivo REAL, que
     * quien llama debe registrar y no devolver.
     */
    static async validar(token) {
        if (!token) return { ok: false, motivo: MOTIVOS.NO_EXISTE };

        const res = await docClient.send(new GetCommand({
            TableName: LICENCIAS_TABLE,
            Key: { licenciaHash: hashLicencia(token) },
            ConsistentRead: true,
        }));

        const licencia = res.Item;
        if (!licencia) return { ok: false, motivo: MOTIVOS.NO_EXISTE };
        if (licencia.estado === ESTADOS.REVOCADA) return { ok: false, motivo: MOTIVOS.REVOCADA, licencia };
        if (licencia.estado === ESTADOS.USADA || licencia.usedAt) {
            return { ok: false, motivo: MOTIVOS.YA_USADA, licencia };
        }
        if (new Date(licencia.expiresAt) < new Date()) {
            return { ok: false, motivo: MOTIVOS.VENCIDA, licencia };
        }

        return { ok: true, licencia };
    }

    /**
     * Consume la licencia. Escritura condicionada: de dos peticiones simultáneas
     * con el mismo enlace, una sola gana, y por lo tanto se crea una sola
     * empresa. La condición mira el estado Y la ausencia de `usedAt`, que son dos
     * formas de decir lo mismo y hacen imposible un consumo doble aunque alguien
     * toque una de las dos a mano.
     */
    static async consumir(token, { ip = null } = {}) {
        const previo = await this.validar(token);
        if (!previo.ok) return previo;

        const ahora = new Date().toISOString();
        try {
            const res = await docClient.send(new UpdateCommand({
                TableName: LICENCIAS_TABLE,
                Key: { licenciaHash: hashLicencia(token) },
                UpdateExpression: 'SET estado = :usada, usedAt = :ahora, usedIp = :ip',
                ConditionExpression: 'estado = :emitida AND (attribute_not_exists(usedAt) OR usedAt = :nulo)',
                ExpressionAttributeValues: {
                    ':usada': ESTADOS.USADA,
                    ':emitida': ESTADOS.EMITIDA,
                    ':ahora': ahora,
                    ':ip': ip,
                    ':nulo': null,
                },
                ReturnValues: 'ALL_NEW',
            }));
            return { ok: true, licencia: res.Attributes };
        } catch (err) {
            if (err.name === 'ConditionalCheckFailedException') {
                // Alguien llegó primero con el mismo enlace.
                return { ok: false, motivo: MOTIVOS.YA_USADA, licencia: previo.licencia };
            }
            throw err;
        }
    }

    /**
     * Devuelve la licencia al estado emitido.
     *
     * Solo se llama cuando el alta falló DESPUÉS de consumirla, y solo puede
     * hacerlo quien ganó el consumo: la condición exige que la licencia esté
     * usada con la marca de tiempo exacta que devolvió `consumir`. Sin esto, un
     * error a mitad del alta dejaría a la empresa con un enlace quemado y sin
     * empresa creada.
     */
    static async liberar(token, usedAtEsperado) {
        try {
            await docClient.send(new UpdateCommand({
                TableName: LICENCIAS_TABLE,
                Key: { licenciaHash: hashLicencia(token) },
                UpdateExpression: 'SET estado = :emitida, usedAt = :nulo, usedIp = :nulo',
                ConditionExpression: 'estado = :usada AND usedAt = :esperado',
                ExpressionAttributeValues: {
                    ':emitida': ESTADOS.EMITIDA,
                    ':usada': ESTADOS.USADA,
                    ':esperado': usedAtEsperado,
                    ':nulo': null,
                },
            }));
            return true;
        } catch (err) {
            // Que no se pueda liberar no puede tapar el error original del alta.
            registrarFallo('licencia.liberar', err, { usedAtEsperado });
            return false;
        }
    }

    /** Marca la empresa creada con esta licencia. Traza, no condición. */
    static async anotarTenant(token, tenantId) {
        await docClient.send(new UpdateCommand({
            TableName: LICENCIAS_TABLE,
            Key: { licenciaHash: hashLicencia(token) },
            UpdateExpression: 'SET tenantId = :t',
            ExpressionAttributeValues: { ':t': tenantId },
        }));
    }

    /** Anula una licencia que todavía no se usó. Por `licenciaId`, que es lo
     *  único que el operador tiene después de enviar el correo. */
    static async revocar(licenciaId, { revocadaPor = 'operador' } = {}) {
        const licencia = (await this.listar()).find((l) => l.licenciaId === licenciaId);
        if (!licencia) return { ok: false, motivo: MOTIVOS.NO_EXISTE };
        if (licencia.estado === ESTADOS.USADA) return { ok: false, motivo: MOTIVOS.YA_USADA, licencia };

        await docClient.send(new UpdateCommand({
            TableName: LICENCIAS_TABLE,
            Key: { licenciaHash: licencia.licenciaHash },
            UpdateExpression: 'SET estado = :rev, revocadaEn = :ahora, revocadaPor = :quien',
            ConditionExpression: 'estado <> :usada',
            ExpressionAttributeValues: {
                ':rev': ESTADOS.REVOCADA,
                ':usada': ESTADOS.USADA,
                ':ahora': new Date().toISOString(),
                ':quien': revocadaPor,
            },
        }));
        return { ok: true, licencia };
    }

    /** Todas las licencias, para el listado del operador. Recorre la tabla: son
     *  decenas y esto no corre en el camino de nadie. */
    static async listar() {
        const res = await docClient.send(new ScanCommand({ TableName: LICENCIAS_TABLE }));
        return (res.Items || []).sort((a, b) => String(b.emitidaEn).localeCompare(String(a.emitidaEn)));
    }

    /** Estado de cara al operador, ya resuelto el vencimiento. */
    static estadoVisible(licencia) {
        if (licencia.estado === ESTADOS.USADA) return 'usada';
        if (licencia.estado === ESTADOS.REVOCADA) return 'revocada';
        return new Date(licencia.expiresAt) < new Date() ? 'vencida' : 'vigente';
    }
}

module.exports = { LicenciaService, MOTIVOS, ESTADOS, hashLicencia, DIAS_VIGENCIA };
