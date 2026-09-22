/**
 * Onboarding de una empresa con licencia de un solo uso.
 *
 * Dos rutas públicas, y son públicas por la misma razón que lo es la
 * recuperación de contraseña: **quien las usa todavía no tiene sesión y no puede
 * tenerla**, porque su empresa no existe. La credencial es el token del enlace.
 *
 * Lo que sostiene que esto sea seguro:
 *
 *   - la licencia la emitimos nosotros con credenciales de AWS, no se pide sola;
 *   - sirve una vez, y el consumo es una escritura condicionada: dos envíos
 *     simultáneos del mismo enlace crean UNA empresa;
 *   - el correo del administrador viene de la licencia, no del formulario;
 *   - el `tenantId` lo genera el servidor;
 *   - hacia afuera, un enlace que no sirve siempre dice lo mismo. El motivo real
 *     —vencido, revocado, ya usado— queda registrado adentro, porque es justo lo
 *     que necesita quien atienda a una empresa que no puede entrar.
 */

const { success, error, created } = require('../../lib/utils/response');
const { LicenciaService } = require('../../lib/services/LicenciaService');
const { AltaEmpresaService } = require('../../lib/services/AltaEmpresaService');
const { registrarFallo } = require('../../lib/degradacion');

/** Única respuesta hacia afuera cuando el enlace no sirve. */
const ENLACE_INVALIDO = 'El enlace de activación es inválido o venció. Pide uno nuevo.';

/** Deja el motivo real donde se pueda encontrar, sin decirlo hacia afuera. */
const registrarMotivo = (operacion, motivo, licencia) => {
    registrarFallo(operacion, new Error(`licencia ${motivo}`), {
        motivo,
        licenciaId: licencia?.licenciaId || null,
        email: licencia?.email || null,
    });
};

const ipDe = (event) => event.requestContext?.http?.sourceIp
    || event.requestContext?.identity?.sourceIp
    || null;

/**
 * GET /onboarding/licencia/{token}
 *
 * Devuelve lo MÍNIMO para dibujar el formulario: el correo que quedó fijado y lo
 * que se haya prellenado al emitir. Nada más: este endpoint es público y
 * responde a cualquiera que tenga el enlace.
 */
module.exports.validarLicencia = async (event) => {
    try {
        const { token } = event.pathParameters || {};

        const res = await LicenciaService.validar(token);
        if (!res.ok) {
            registrarMotivo('onboarding.licencia.invalida', res.motivo, res.licencia);
            return error(ENLACE_INVALIDO, 404);
        }

        return success({
            valida: true,
            // Fijado: el formulario lo muestra y no lo deja editar.
            email: res.licencia.email,
            prellenado: {
                nombre: res.licencia.prellenado?.nombre || null,
                rutEmpresa: res.licencia.prellenado?.rutEmpresa || null,
            },
            expiraEn: res.licencia.expiresAt,
        });
    } catch (err) {
        console.error('Error validando licencia:', err);
        return error('No se pudo validar el enlace', 500);
    }
};

/**
 * POST /onboarding/completar
 *
 * Body: { token, empresa: { nombre, rutEmpresa }, admin: { rut, nombre,
 *         apellidoPaterno, apellidoMaterno, password, confirmarPassword } }
 *
 * El orden importa y está elegido:
 *
 *   1. se valida TODO y se comprueban los conflictos, sin escribir. Un RUT
 *      repetido o una contraseña corta no pueden quemar el enlace;
 *   2. se consume la licencia, de forma condicionada. Acá se decide quién gana
 *      si dos envíos llegan juntos;
 *   3. se crea la empresa. Si esto falla, la licencia se libera, porque quien
 *      ganó el consumo es el único que puede liberarla y sería absurdo dejar a
 *      la empresa sin alta y sin enlace.
 */
module.exports.completar = async (event) => {
    let consumida = null;
    let token = null;

    try {
        const body = JSON.parse(event.body || '{}');
        token = body.token;
        const empresa = body.empresa || {};
        const admin = body.admin || {};

        const previo = await LicenciaService.validar(token);
        if (!previo.ok) {
            registrarMotivo('onboarding.completar.invalida', previo.motivo, previo.licencia);
            return error(ENLACE_INVALIDO, 404);
        }

        if (admin.password !== admin.confirmarPassword) {
            return error('Las contraseñas no coinciden', 400);
        }

        // El correo sale de la licencia, SIEMPRE. Si el cuerpo trae otro, se
        // ignora en silencio: no es un error del usuario, es un intento de usar
        // una invitación ajena, y no hay nada que explicarle a quien lo intenta.
        const datos = {
            nombre: empresa.nombre,
            rutEmpresa: empresa.rutEmpresa,
            admin: {
                rut: admin.rut,
                nombre: admin.nombre,
                apellidoPaterno: admin.apellidoPaterno || '',
                apellidoMaterno: admin.apellidoMaterno || '',
                email: previo.licencia.email,
            },
            password: admin.password,
        };

        // 1. Revisión completa antes de tocar la licencia.
        const revision = await AltaEmpresaService.revisar(datos);
        if (!revision.valido) {
            return error(revision.errores[0], 400);
        }

        // 2. Consumo atómico.
        const consumo = await LicenciaService.consumir(token, { ip: ipDe(event) });
        if (!consumo.ok) {
            registrarMotivo('onboarding.completar.consumo', consumo.motivo, consumo.licencia);
            return error(ENLACE_INVALIDO, 404);
        }
        consumida = consumo.licencia;

        // 3. Alta.
        const { tenant, persona } = await AltaEmpresaService.crear({
            ...datos,
            creadoPor: `licencia:${previo.licencia.licenciaId}`,
        });

        await LicenciaService.anotarTenant(token, tenant.tenantId);

        return created({
            message: 'Empresa creada. Ya puedes iniciar sesión.',
            empresa: { nombre: tenant.nombre, rutEmpresa: tenant.rutEmpresa },
            // Lo justo para que la interfaz mande a iniciar sesión con el RUT
            // correcto. Sin identificadores internos ni sesión regalada: la
            // primera sesión se abre con la contraseña que acaba de elegir.
            administrador: { rut: persona.rut, email: persona.email },
        });
    } catch (err) {
        if (consumida && token) {
            // El alta falló después de consumir: se devuelve el enlace a su
            // dueño. `liberar` solo puede hacerlo quien ganó el consumo.
            await LicenciaService.liberar(token, consumida.usedAt);
        }

        if (err.codigo === 'ALTA_INVALIDA') {
            return error(err.message, 400);
        }
        console.error('Error completando onboarding:', err);
        registrarFallo('onboarding.completar.error', err);
        return error('No se pudo completar el alta. Intenta nuevamente.', 500);
    }
};
