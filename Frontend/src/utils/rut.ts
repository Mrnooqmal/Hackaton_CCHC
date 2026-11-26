/**
 * RUT chileno: dígito verificador (módulo 11).
 *
 * El servidor valida igual (`rut.js` en Backend/lib/utils/validation.js); esto
 * es para avisar al salir del campo sin esperar la red.
 */
export function rutValido(rut: string): boolean {
    const limpio = String(rut || '').replace(/[.\s-]/g, '').toUpperCase();
    if (!/^\d{7,8}[\dK]$/.test(limpio)) return false;
    const cuerpo = limpio.slice(0, -1);
    const dv = limpio.slice(-1);
    let suma = 0;
    let factor = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
        suma += Number(cuerpo[i]) * factor;
        factor = factor === 7 ? 2 : factor + 1;
    }
    const resto = 11 - (suma % 11);
    const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
    return dv === esperado;
}
