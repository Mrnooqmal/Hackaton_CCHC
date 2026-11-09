/**
 * Emisión de vales de firma para el modo sin conexión.
 *
 * Es el único momento en que el PIN del trabajador entra al sistema para este
 * flujo: se valida acá, con red, y a cambio se entregan vales de un solo uso que
 * el dispositivo puede guardar sin riesgo. El PIN no vuelve a salir del teclado.
 *
 * Ver `lib/services/ValeFirmaService.js` para el diseño completo.
 */

const { success, error } = require('../../lib/utils/response');
const { verifyPin } = require('../../lib/utils/validation');
const { PersonaService } = require('../../lib/services/PersonaService');
const { ValeFirmaService } = require('../../lib/services/ValeFirmaService');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { conNeutro } = require('../../lib/degradacion');
const { verificarConLimite } = require('../../lib/limitePin');
const { PERMISSIONS } = require('../../lib/permissions');
const { obraDeLaEmpresa } = require('../../lib/auth/pertenencia');

/**
 * POST /firmas/vales
 *
 * Body: { personaId?, obraId, pin, cantidad?, deviceId? }
 *
 * `obraId` es la obra del turno: el vale queda atado a la persona y a esa obra,
 * y la persona tiene que estar asignada a ella.
 *
 * `personaId` se omite cuando la persona pide vales para sí misma. En el
 * dispositivo de quien asiste (supervisor, prevencionista) se indica el
 * trabajador, y es ÉL quien teclea su PIN: quien asiste no puede obtener vales de
 * nadie sin que esa persona ponga su PIN delante suyo.
 */
module.exports.emitir = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const body = JSON.parse(event.body || '{}');
        const personaId = body.personaId || sesion.personaId;

        if (!body.pin) {
            return error('Debes ingresar tu PIN para habilitar la firma sin conexión', 400);
        }
        if (!body.obraId) {
            return error('Indica la obra del turno para habilitar la firma sin conexión', 400);
        }

        // Pedir vales para otra persona es el mismo acto que la firma asistida.
        if (personaId !== sesion.personaId && !sesionPuede(sesion, PERMISSIONS.OBRA_FIRMA_ASISTIDA)) {
            return error('No tienes permiso para habilitar la firma sin conexión de otra persona', 403);
        }

        const personaService = new PersonaService();
        const persona = await conNeutro('vale.persona', () => personaService.getById(personaId), null);
        if (!persona || persona.tenantId !== sesion.tenantId) {
            return error('Persona no encontrada', 404);
        }
        // La obra, de la empresa; y la persona, asignada a ella. 404 en los dos
        // casos: que exista en otra empresa, o que la persona esté en otra obra,
        // no se informa.
        if (!await obraDeLaEmpresa(body.obraId, sesion)) return error('Obra no encontrada', 404);
        if (!(persona.obraIds || []).includes(body.obraId)) return error('Persona no encontrada en esta obra', 404);
        if (!persona.habilitado) {
            return error('La persona no ha completado su enrolamiento', 400);
        }
        // Una persona desvinculada no recibe vales: sería firma a su nombre.
        if (['desvinculado', 'suspendido', 'inactivo'].includes(persona.estado)) {
            return error('La persona está desvinculada de la empresa', 400);
        }
        if (!persona.tienePinConfigurado()) {
            return error('La persona no tiene PIN configurado', 400);
        }

        const chequeo = await verificarConLimite(persona, body.pin, verifyPin);
        if (!chequeo.ok) {
            // 400 y no 401: el cliente lee todo 401 como sesión vencida, y un PIN mal
            // escrito cerraba la sesión de quien estaba firmando.
            return error(chequeo.mensaje, chequeo.bloqueada ? 423 : (chequeo.debeCambiar ? 409 : 400));
        }

        const { vales, expiraEn, vigenciaHoras } = await ValeFirmaService.emitir({
            personaId: persona.personaId,
            tenantId: persona.tenantId,
            obraId: body.obraId,
            cantidad: body.cantidad,
            deviceId: body.deviceId || null,
            emitidoPor: sesion.personaId,
        });

        return success({
            // Única vez que los vales existen fuera del dispositivo: el servidor
            // solo guarda su hash.
            vales,
            personaId: persona.personaId,
            obraId: body.obraId,
            expiraEn,
            vigenciaHoras,
            mensaje: `Firma sin conexión habilitada por ${vigenciaHoras} horas.`,
        });
    } catch (err) {
        console.error('Error emitiendo vales de firma:', err);
        return error('No se pudo habilitar la firma sin conexión', 500);
    }
};
