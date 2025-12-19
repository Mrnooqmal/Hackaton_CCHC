const { validate, format, clean } = require('rut.js');

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
 * Genera un token de firma único
 * @returns {string}
 */
const generateSignatureToken = () => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `SIG-${timestamp}-${random}`.toUpperCase();
};

module.exports = { validateRut, validateRequired, generateSignatureToken };
