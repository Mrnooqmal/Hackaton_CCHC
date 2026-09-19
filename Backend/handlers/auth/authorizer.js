/**
 * Autorizador de API Gateway (HTTP API, tipo REQUEST).
 *
 * Resuelve el token de sesión y entrega a los handlers el contexto autenticado:
 * quién pregunta y, sobre todo, **a qué empresa pertenece**. Ese `tenantId` es
 * el que deben usar los handlers; el que venga del cliente se ignora.
 *
 * Por qué un autorizador propio y no el JWT nativo de API Gateway: el token que
 * emite el login es opaco (32 bytes aleatorios), no un JWT firmado. Cambiarlo a
 * JWT nos haría perder la revocación inmediata en el cierre de sesión, que hoy
 * sí existe.
 *
 * El resultado se cachea 60 segundos por token (`resultTtlInSeconds` en
 * `serverless.yml`). Ese es el precio acordado: un cierre de sesión tarda hasta
 * un minuto en propagarse, a cambio de no leer DynamoDB en cada request.
 */

const { tokenDelEvento, sesionDesdeToken } = require('../../lib/auth/sesion');
const { PersonaService } = require('../../lib/services/PersonaService');
const { TenantService } = require('../../lib/services/TenantService');
const { resolvePersonaPermisos } = require('../../lib/permissions');
const { registrarFallo } = require('../../lib/degradacion');

const personaService = new PersonaService();
const tenantService = new TenantService();

const DENEGAR = { isAuthorized: false };

module.exports.autorizar = async (event) => {
    try {
        const sesion = await sesionDesdeToken(tokenDelEvento(event));
        if (!sesion) return DENEGAR;

        // La sesión guarda el vínculo persona × empresa, pero el estado de la
        // persona puede haber cambiado después de emitirla: una desvinculación no
        // debe esperar a que venza el token.
        const persona = await personaService.getById(sesion.personaId);
        if (!persona) return DENEGAR;
        if (['suspendido', 'inactivo', 'desvinculado'].includes(persona.estado)) return DENEGAR;

        let permisos = [];
        try {
            const tenant = await tenantService.getById(sesion.tenantId);
            permisos = resolvePersonaPermisos(persona, tenant ? tenant.toSafeFormat() : null);
        } catch (permErr) {
            // Sin la definición de roles del tenant se sigue adelante con los
            // permisos base: negar el acceso entero por una lectura fallida
            // convertiría un problema de disponibilidad en uno de autenticación.
            registrarFallo('autorizador.permisos', permErr);
            console.error('Autorizador: no se pudieron resolver permisos:', permErr.message);
            permisos = resolvePersonaPermisos(persona, null);
        }

        return {
            isAuthorized: true,
            // El contexto de API Gateway solo admite valores escalares, así que
            // los permisos viajan como lista separada por comas y `conSesion` los
            // vuelve a partir.
            context: {
                sessionId: sesion.sessionId,
                personaId: sesion.personaId,
                tenantId: sesion.tenantId,
                rol: persona.rol || '',
                permisos: permisos.join(','),
                // Con la contraseña inicial sin cambiar, la sesión existe pero no
                // habilita nada más que cambiarla. Quien decide es `conSesion`,
                // porque esta respuesta se cachea por token y sin mirar la ruta.
                credencialProvisional: String(Boolean(persona.passwordTemporal)),
            },
        };
    } catch (err) {
        // Cualquier fallo inesperado deniega. Un autorizador que deja pasar
        // cuando falla no sirve de nada.
        //
        // Pero desde afuera esto se ve idéntico a un token inválido: una caída de
        // la tabla de sesiones aparece como "tu sesión no vale" para todo el mundo
        // a la vez. La denegación no cambia; el fallo queda medible.
        registrarFallo('autorizador.error', err);
        console.error('Autorizador: error inesperado:', err.message);
        return DENEGAR;
    }
};
