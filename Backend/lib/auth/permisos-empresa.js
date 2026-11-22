/**
 * Permisos efectivos de las personas de UNA empresa, resueltos como lo hace el
 * autorizador: la definición de roles de la empresa (`TenantService.getById` →
 * `toSafeFormat()`) y `personaPuede`, que cae a los permisos por defecto de cada rol
 * cuando la empresa no definió el suyo.
 *
 * Lo usan el aviso de un reporte nuevo (a quién avisar) y la validación de quién
 * puede quedar a cargo de una medida (alguien que pueda abrir el caso al que lo lleva
 * su aviso): las dos tienen que contestar lo mismo a "¿esta persona puede X?", y por
 * eso la resolución vive en un solo lugar.
 *
 * Si la empresa no se puede leer se degrada a `null`, o sea a los permisos por
 * defecto de cada rol (`personaPuede` con tenant `null`), y queda constancia medible
 * con la `etiqueta` que da quien llama (`conNeutro`, `FALLO_DEPENDENCIA`): es mejor
 * contestar con los roles estándar que dejar sin respuesta.
 */

const { conNeutro } = require('../degradacion');
const { TenantService } = require('../services/TenantService');
const { personaPuede } = require('../permissions');

/** La empresa en formato seguro para `personaPuede`, o `null` si no se pudo leer. */
async function tenantParaPermisos(tenantId, etiqueta = 'permisos.roles') {
    if (!tenantId) return null;
    const tenant = await conNeutro(etiqueta, () => new TenantService().getById(tenantId), null, { tenantId });
    return tenant ? tenant.toSafeFormat() : null;
}

/** ¿Tiene esta persona, de esta empresa, el permiso efectivo `permiso`? */
async function personaTienePermiso(persona, tenantId, permiso, etiqueta) {
    return personaPuede(persona, await tenantParaPermisos(tenantId, etiqueta), permiso);
}

module.exports = { tenantParaPermisos, personaTienePermiso };
