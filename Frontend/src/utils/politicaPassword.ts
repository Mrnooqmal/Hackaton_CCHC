/**
 * Política de contraseña, la misma en el onboarding, el cambio (y primer
 * ingreso) y el restablecimiento (H-21). El servidor aplica las mismas reglas
 * en `Backend/lib/utils/politicaPassword.js`.
 */
export const MIN_PASSWORD = 8;

export const requisitosPassword = (p: string) => [
    { label: `${MIN_PASSWORD} caracteres o más`, ok: p.length >= MIN_PASSWORD },
    { label: 'Una letra', ok: /[a-zA-Z]/.test(p) },
    { label: 'Un número', ok: /[0-9]/.test(p) },
];

export const passwordCumple = (p: string) => requisitosPassword(p).every((r) => r.ok);
