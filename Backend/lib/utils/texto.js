/**
 * Cortes de texto que no parten un carácter.
 *
 * `String.prototype.slice` cuenta unidades UTF-16: un emoji (o cualquier carácter
 * fuera del plano básico) ocupa dos, y cortar justo en medio deja una mitad suelta
 * que se ve como un rombo con un signo de interrogación y que algunos sistemas
 * rechazan. Acá se corta por caracteres completos (puntos de código).
 */

/** Los primeros `max` caracteres completos de `texto`. */
const cortar = (texto, max) => {
    const s = String(texto ?? '');
    // Atajo: si ni en unidades UTF-16 llega al tope, no hay nada que cortar.
    if (s.length <= max) return s;
    return Array.from(s).slice(0, max).join('');
};

module.exports = { cortar };
