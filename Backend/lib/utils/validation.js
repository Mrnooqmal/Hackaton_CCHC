const { validate, format, clean } = require('rut.js');
const crypto = require('crypto');
const credenciales = require('../credenciales');

// Sal del token de firma. El hasheo de credenciales ya NO pasa por acá: usa
// scrypt con sal por hash y pimienta de servidor (`lib/credenciales.js`).
const PIN_SALT = process.env.PIN_SALT;

/**
 * Valida y formatea un RUT chileno
 * @param {string} rut - RUT a validar
 * @returns {{ valid: boolean, formatted: string | null }}
 */
const validateRut = (rut) => {
    if (!rut) return { valid: false, formatted: null };

    const cleaned = clean(rut);
    const isValid = validate(cleaned);

    return {
        valid: isValid,
        formatted: isValid ? format(cleaned) : null,
    };
};

/**
 * RUT parcial, para respuestas que no exigen la identidad completa.
 *
 * Deja los tres últimos dígitos del cuerpo y el dígito verificador: alcanza para
 * que quien ya tiene el RUT a la vista confirme que la firma es de esa persona, y
 * no alcanza para llevarse el dato de quien solo pasaba por ahí. Se usa en la
 * verificación pública de firmas (`GET /signatures/verify/{token}`), que es
 * pública por diseño: cualquiera con el token de una firma puede comprobarla.
 *
 * @param {string} rut
 * @returns {string|null} p. ej. "···.678-5"
 */
const enmascararRut = (rut) => {
    if (!rut) return null;
    const limpio = String(rut).replace(/[.\s]/g, '').toUpperCase();
    const partes = limpio.split('-');
    const cuerpo = partes[0] || '';
    const dv = partes.length > 1 ? partes[1] : cuerpo.slice(-1);
    const soloCuerpo = partes.length > 1 ? cuerpo : cuerpo.slice(0, -1);
    const visibles = soloCuerpo.slice(-3);
    return `···.${visibles}-${dv}`;
};

/**
 * Valida campos requeridos en un objeto
 * @param {Object} obj - Objeto a validar
 * @param {string[]} requiredFields - Lista de campos requeridos
 * @returns {{ valid: boolean, missing: string[] }}
 */
const validateRequired = (obj, requiredFields) => {
    const missing = requiredFields.filter(
        (field) => obj[field] === undefined || obj[field] === null || obj[field] === ''
    );
    return {
        valid: missing.length === 0,
        missing,
    };
};

/**
 * Genera un token de firma único con alta entropía
 * Formato: SIG-[timestamp]-[random]-[checksum]
 * @returns {string}
 */
const generateSignatureToken = () => {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    const checksum = crypto
        .createHash('sha256')
        .update(`${timestamp}-${random}-${PIN_SALT}`)
        .digest('hex')
        .substring(0, 6);
    return `SIG-${timestamp}-${random}-${checksum}`.toUpperCase();
};

/**
 * Hashea un PIN de 4 dígitos.
 *
 * La función de costo y su formato viven en `lib/credenciales.js`; acá queda
 * solo la regla de negocio de qué es un PIN válido.
 *
 * @param {string} pin - PIN de 4 dígitos
 * @param {string} personaId - ID de la persona, al que queda atada la credencial
 * @returns {Promise<string>} Hash del PIN, con su algoritmo y parámetros adentro
 */
const hashPin = async (pin, personaId) => {
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        throw new Error('PIN debe ser de 4 dígitos numéricos');
    }

    return credenciales.hashear(pin, personaId);
};

/**
 * Verifica si un PIN coincide con el hash almacenado.
 *
 * @returns {Promise<boolean>}
 */
const verifyPin = async (pin, storedHash, personaId) => {
    if (!pin || !storedHash || !personaId) return false;
    const { valido } = await credenciales.verificar(pin, storedHash, personaId);
    return valido;
};

/**
 * Valida formato de PIN
 * @param {string} pin - PIN a validar
 * @returns {{ valid: boolean, error?: string }}
 */
const validatePin = (pin) => {
    if (!pin) {
        return { valid: false, error: 'PIN es requerido' };
    }
    if (typeof pin !== 'string' || pin.length !== 4) {
        return { valid: false, error: 'PIN debe tener 4 dígitos' };
    }
    if (!/^\d{4}$/.test(pin)) {
        return { valid: false, error: 'PIN debe contener solo números' };
    }
    return { valid: true };
};

/**
 * Hashea una contraseña alfanumérica.
 *
 * @param {string} password - Contraseña
 * @param {string} personaId - ID de la persona
 * @returns {Promise<string>} Hash con su algoritmo y parámetros adentro
 */
const hashPassword = async (password, personaId) => {
    if (!password || password.length < 4) {
        throw new Error('La contraseña debe tener al menos 4 caracteres');
    }

    return credenciales.hashear(password, personaId);
};

/**
 * Verifica si una contraseña coincide con el hash almacenado.
 *
 * Quien además pueda ESCRIBIR debería usar `credenciales.verificar` directo y
 * mirar `obsoleto`: el ingreso es el único momento en que la contraseña en claro
 * está disponible para reemplazar un hash viejo por uno al costo vigente.
 *
 * @returns {Promise<boolean>}
 */
const verifyPassword = async (password, storedHash, personaId) => {
    if (!password || !storedHash || !personaId) return false;
    const { valido } = await credenciales.verificar(password, storedHash, personaId);
    return valido;
};

/**
 * Genera una contraseña temporal robusta
 * @param {number} length - Longitud de la contraseña
 * @returns {string}
 */
const generateTempPassword = (length = 10) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let result = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
        result += chars.charAt(randomBytes[i] % chars.length);
    }
    return result;
};

// Mapeo canónico de nombres de rol a IDs del sistema.
// Permite guardar "Jefe de Obra", "Prevencionista", etc. verbatim
// sin romper los checks de autorización internos.
const ROLE_CANONICAL = {
    'admin': 'admin',
    'administrador': 'admin',
    'jefe_obra': 'jefe_obra',
    'jefe de obra': 'jefe_obra',
    'jefe_de_obra': 'jefe_obra',
    'supervisor': 'supervisor',
    'prevencionista': 'prevencionista',
    'trabajador': 'trabajador',
    'colaborador': 'trabajador',
    'relator': 'relator',
};

/**
 * Normaliza un nombre de rol al ID canónico del sistema.
 * Permite comparar 'Prevencionista', 'prevencionista', 'Jefe de Obra', etc.
 * @param {string} rol
 * @returns {string}
 */
const normalizeRol = (rol) => {
    if (!rol || typeof rol !== 'string') return '';
    const lower = rol.toLowerCase().trim();
    return ROLE_CANONICAL[lower] || lower.replace(/\s+/g, '_');
};

module.exports = {
    validateRut,
    enmascararRut,
    validateRequired,
    generateSignatureToken,
    hashPin,
    verifyPin,
    validatePin,
    hashPassword,
    verifyPassword,
    generateTempPassword,
    normalizeRol
};
