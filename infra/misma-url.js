#!/usr/bin/env node
/**
 * ¿Dos URL dicen lo mismo? Mismo origen, misma ruta y los mismos parámetros de
 * consulta, sin importar el orden.
 *
 * Existe por la comprobación del 301 de D-34 en desplegar-infra-frontend.sh: la
 * función de CloudFront arma el destino recorriendo `request.querystring`, y en
 * CloudFront ese objeto no conserva el orden (`?a=1&b=dos` sale como
 * `?b=dos&a=1`). Comparar el texto del Location fallaba siempre, con la
 * redirección funcionando.
 *
 * Los parámetros repetidos cuentan cada uno: `?a=1&a=2` no es lo mismo que `?a=1`.
 *
 * Uso: node infra/misma-url.js <esperada> <recibida>   (sale con 0 si coinciden)
 */

function normalizada(texto) {
    const u = new URL(texto);
    const parametros = [...u.searchParams].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).sort();
    return `${u.origin}${u.pathname}?${parametros.join('&')}`;
}

function mismaUrl(a, b) {
    try {
        return normalizada(a) === normalizada(b);
    } catch {
        return false;
    }
}

module.exports = { mismaUrl };

if (require.main === module) {
    const [esperada, recibida] = process.argv.slice(2);
    if (!esperada || recibida === undefined) {
        console.error('uso: node infra/misma-url.js <esperada> <recibida>');
        process.exit(2);
    }
    process.exit(mismaUrl(esperada, recibida) ? 0 : 1);
}
