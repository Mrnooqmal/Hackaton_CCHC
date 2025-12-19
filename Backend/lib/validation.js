const { validate, format, clean } = require('rut.js');
const crypto = require('crypto');

// Salt fijo para hasheo de PIN (en producción usar variable de entorno)
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
 * Hashea un PIN de 4 dígitos
 * @param {string} pin - PIN de 4 dígitos
 * @param {string} workerId - ID del trabajador (usado como salt adicional)
 * @returns {string} Hash del PIN
 */
const hashPin = (pin, workerId) => {
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        throw new Error('PIN debe ser de 4 dígitos numéricos');
    }

    return crypto
        .createHash('sha256')
        .update(`${pin}-${workerId}-${PIN_SALT}`)
        .digest('hex');
};

/**
 * Verifica si un PIN coincide con el hash almacenado
 * @param {string} pin - PIN ingresado por el usuario
 * @param {string} storedHash - Hash almacenado del PIN
 * @param {string} workerId - ID del trabajador
 * @returns {boolean}
 */
const verifyPin = (pin, storedHash, workerId) => {
    if (!pin || !storedHash || !workerId) return false;

    try {
        const inputHash = hashPin(pin, workerId);
        return crypto.timingSafeEqual(
            Buffer.from(inputHash, 'hex'),
            Buffer.from(storedHash, 'hex')
        );
    } catch {
        return false;
    }
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
    // Validar que no sea una secuencia obvia
    const obvias = ['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321'];
    if (obvias.includes(pin)) {
        return { valid: false, error: 'PIN demasiado simple, elija otro' };
    }
    return { valid: true };
};

module.exports = {
    validateRut,
    validateRequired,
    generateSignatureToken,
    hashPin,
    verifyPin,
    validatePin
};
