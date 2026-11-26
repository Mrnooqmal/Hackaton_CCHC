/**
 * Política de contraseña, una sola para toda la plataforma (H-21): el alta de
 * empresa, el cambio de contraseña (incluido el primer ingreso) y el
 * restablecimiento por correo. Antes el onboarding pedía 8 caracteres con letra
 * y número y los otros dos solo 6 caracteres.
 *
 * Solo aplica al ELEGIR una contraseña: las ya guardadas siguen sirviendo para
 * entrar. El frontend repite las mismas reglas en `src/utils/politicaPassword.ts`.
 */

const MIN_PASSWORD = 8;

/** @returns {string|null} el motivo del rechazo, o null si cumple. */
function problemaPassword(password) {
    if (!password || String(password).length < MIN_PASSWORD) {
        return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`;
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        return 'La contraseña debe combinar letras y números';
    }
    return null;
}

module.exports = { MIN_PASSWORD, problemaPassword };
