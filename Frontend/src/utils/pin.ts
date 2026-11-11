/**
 * Largo del PIN de firma: 4 dígitos, igual que el servidor
 * (Backend/lib/utils/validation.js, LARGO_PIN).
 *
 * El 8 de noviembre de 2026 pasó a 6 y el 9 volvió a 4, por decisión de Adrean:
 * con el sobre (D-37) y el corte del servidor al quinto vale inválido, el riesgo
 * que queda es asumible (registrado en D-35).
 */
export const LARGO_PIN = 4;
