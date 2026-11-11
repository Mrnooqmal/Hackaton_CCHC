/** "1 firma pendiente", "2 firmas pendientes". Nunca "firma(s)". */
const plural = (n, uno, varios) => `${n} ${Number(n) === 1 ? uno : varios}`;

module.exports = { plural };
