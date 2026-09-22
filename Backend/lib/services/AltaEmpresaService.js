/**
 * Alta de una empresa con su administrador.
 *
 * Existe para que haya **un solo** camino de alta. Antes estaba escrito dos
 * veces —en `crear-empresa.js` y en `sembrar-ambiente.js`— con diferencias que
 * nadie había decidido: uno sembraba el catálogo de cargos y el otro no, así que
 * una empresa creada con el primero arrancaba sin saber qué documentos exigirle
 * a nadie. Ahora el onboarding por interfaz es un tercer llamador, y tres copias
 * de esto habría sido garantía de divergencia.
 *
 * Las comprobaciones de unicidad NO se degradan: si la lectura falla, el alta
 * falla. Un "no encontré ninguna empresa con ese RUT" producido por un error de
 * lectura es exactamente el neutro que miente, y acá crearía una empresa
 * duplicada con su propio administrador.
 */

const { TenantService } = require('./TenantService');
const { PersonaService } = require('./PersonaService');
const { validateRut } = require('../utils/validation');
const { buildDefaultCargoCatalog } = require('../ds44');

/** Mínimo exigible a la contraseña que el administrador elige en el onboarding. */
const MIN_PASSWORD = 8;

const politicaPassword = (password) => {
    if (!password || password.length < MIN_PASSWORD) {
        return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`;
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        return 'La contraseña debe combinar letras y números';
    }
    return null;
};

class AltaEmpresaService {
    /**
     * Valida los datos y comprueba conflictos, SIN escribir.
     *
     * Se usa dos veces: en el ensayo del script del operador y antes de consumir
     * la licencia en el onboarding, para que un RUT repetido no queme el enlace.
     *
     * @returns {Promise<{valido: boolean, errores: string[], slug: string, rutEmpresa: string, rutAdmin: string}>}
     */
    static async revisar({ nombre, rutEmpresa, admin = {}, password = null }) {
        const errores = [];

        if (!nombre || !String(nombre).trim()) errores.push('Falta el nombre de la empresa');
        const empresa = validateRut(rutEmpresa);
        if (!empresa.valid) errores.push(`El RUT de la empresa no es válido: ${rutEmpresa || '(vacío)'}`);
        const persona = validateRut(admin.rut);
        if (!persona.valid) errores.push(`El RUT del administrador no es válido: ${admin.rut || '(vacío)'}`);
        if (!admin.nombre || !String(admin.nombre).trim()) errores.push('Falta el nombre del administrador');
        if (!admin.email) errores.push('Falta el correo del administrador');

        if (password !== null) {
            const problema = politicaPassword(password);
            if (problema) errores.push(problema);
        }

        if (errores.length) return { valido: false, errores, slug: null };

        const tenantService = new TenantService();
        const personaService = new PersonaService();
        const slug = tenantService._generarSlug(nombre);

        // Sin `.catch(() => null)`: si esto falla, falla el alta.
        const [porSlug, porRut, personaExistente] = await Promise.all([
            tenantService.getBySlug(slug),
            tenantService.getByRutEmpresa(empresa.formatted),
            personaService.getByRutGlobal(persona.formatted),
        ]);

        if (porSlug) errores.push(`Ya existe una empresa con el nombre "${nombre}"`);
        if (porRut) errores.push(`Ya existe una empresa con el RUT ${empresa.formatted}`);
        if (personaExistente) errores.push(`El RUT ${persona.formatted} ya está registrado en el sistema`);

        return {
            valido: errores.length === 0,
            errores,
            slug,
            rutEmpresa: empresa.formatted,
            rutAdmin: persona.formatted,
        };
    }

    /**
     * Crea la empresa, su catálogo de cargos y su administrador, y la activa.
     *
     * @param {object} datos
     * @param {string|null} datos.password - si viene, el administrador queda con
     *        SU contraseña y sin paso de cambio obligatorio. Si no, se genera una
     *        temporal (camino del script del operador).
     * @returns {Promise<{tenant, persona, passwordTemporal: string|null}>}
     */
    static async crear({ nombre, rutEmpresa, admin, password = null, creadoPor = null }) {
        const revision = await this.revisar({ nombre, rutEmpresa, admin, password });
        if (!revision.valido) {
            const err = new Error(revision.errores[0]);
            err.codigo = 'ALTA_INVALIDA';
            err.errores = revision.errores;
            throw err;
        }

        const tenantService = new TenantService();
        const personaService = new PersonaService();

        // 1. Empresa. Queda en estado 'setup' hasta que tenga administrador.
        const tenant = await tenantService.setup({
            nombre: String(nombre).trim(),
            rutEmpresa: revision.rutEmpresa,
        });

        // 2. Catálogo de cargos con los kits del DS 44. Es lo que hace que, al
        //    vincular a alguien, el sistema sepa qué documentos exigirle. Sin
        //    esto la empresa arranca sin onboarding y hay que armarlo a mano.
        const reglas = { ...(tenant.reglas || {}), cargos: buildDefaultCargoCatalog() };
        await tenantService.updateConfig(tenant.tenantId, { reglas });

        // 3. Administrador.
        const { persona, passwordTemporal } = await personaService.crear(tenant.tenantId, {
            rut: revision.rutAdmin,
            nombre: admin.nombre,
            apellidoPaterno: admin.apellidoPaterno || '',
            apellidoMaterno: admin.apellidoMaterno || '',
            email: admin.email,
            rol: 'admin',
            tieneAccesoWeb: true,
            password: password || undefined,
            creadoPor,
        });

        // 4. Vincular y activar: una empresa sin administrador vinculado queda
        //    inservible, así que esto no es un paso opcional.
        await tenantService.updateConfig(tenant.tenantId, { adminPersonaId: persona.personaId });
        const activo = await tenantService.activar(tenant.tenantId);

        return { tenant: activo || tenant, persona, passwordTemporal };
    }
}

module.exports = { AltaEmpresaService, politicaPassword, MIN_PASSWORD };
