/**
 * Permisos efectivos de las personas de UNA empresa, resueltos como lo hace el
 * autorizador: la definición de roles de la empresa (`TenantService.getById` →
 * `toSafeFormat()`) y `personaPuede`, que cae a los permisos por defecto de cada rol
 * cuando la empresa no definió el suyo.
 *
 * Lo usa el aviso de un reporte nuevo (a quién avisar): tiene que contestar lo mismo
 * que el autorizador a "¿esta persona puede X?", y por eso la resolución vive en un
 * solo lugar.
 *
 * Si la empresa no se puede leer se degrada a `null`, o sea a los permisos por
 * defecto de cada rol (`personaPuede` con tenant `null`), y queda constancia medible
 * con la `etiqueta` que da quien llama (`conNeutro`, `FALLO_DEPENDENCIA`): es mejor
 * contestar con los roles estándar que dejar sin respuesta.
 */

const { conNeutro, registrarFallo } = require('../degradacion');
const { TenantService } = require('../services/TenantService');

/** La empresa en formato seguro para `personaPuede`, o `null` si no se pudo leer. */
async function tenantParaPermisos(tenantId, etiqueta = 'permisos.roles') {
    if (!tenantId) return null;
    const tenant = await conNeutro(etiqueta, () => new TenantService().getById(tenantId), null, { tenantId });
    return tenant ? tenant.toSafeFormat() : null;
}

async function tenantParaPermisosEstricto(tenantId) {
    let tenant;
    try {
        tenant = await new TenantService().getById(tenantId);
    } catch (err) {
        registrarFallo('permisos.roles.estricto', err, { tenantId });
        throw Object.assign(new Error('No pudimos comprobar los permisos de la empresa. Intenta de nuevo.'), { statusCode: 503 });
    }
    return tenant ? tenant.toSafeFormat() : null;
}

module.exports = { tenantParaPermisos, tenantParaPermisosEstricto };
