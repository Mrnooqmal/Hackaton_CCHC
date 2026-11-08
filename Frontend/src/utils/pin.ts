/**
 * Largo del PIN de firma: 6 dígitos desde el 8 de noviembre de 2026 (antes 4).
 * Lo mismo exige el servidor (Backend/lib/utils/validation.js, LARGO_PIN).
 *
 * Un PIN de 4 que ya existía solo sirve para cambiarlo: quien entra con uno
 * (`pinDebeCambiar`) pasa por el cambio de PIN antes de seguir.
 */
export const LARGO_PIN = 6;
export const LARGO_PIN_ANTERIOR = 4;
