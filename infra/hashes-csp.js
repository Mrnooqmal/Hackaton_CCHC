#!/usr/bin/env node
/**
 * Hashes de los scripts en línea que la CSP tiene que autorizar.
 *
 * Son dos: los `<script>` sin `src` del index.html construido, y el que dispara
 * la impresión en los informes (`src/utils/informesHtml.ts`), que se abren como
 * `blob:` y heredan la política de la página.
 *
 * Lo usan los dos scripts de infra, y por eso vive en un solo lugar:
 *
 *   - `desplegar-infra-frontend.sh` arma la política con estos hashes;
 *   - `desplegar-frontend.sh` se niega a publicar un build cuyos scripts no estén
 *     en la política activa de su distribución. Con la CSP activa, un script en
 *     línea que no está en la política no corre: un cambio a `index.html`
 *     publicado sin redesplegar la infra dejaría la aplicación en blanco.
 *
 * Uso:
 *   node infra/hashes-csp.js <dist/index.html> <src/utils/informesHtml.ts>
 *       imprime los hashes, separados por espacios
 *   node infra/hashes-csp.js --verificar "<política>" <dist/index.html> <src/utils/informesHtml.ts>
 *       sale con 1 y lista los que faltan si alguno no está en la política
 */

const fs = require('fs');
const crypto = require('crypto');

const hash = (texto) => `'sha256-${crypto.createHash('sha256').update(texto, 'utf8').digest('base64')}'`;

/** Hashes, sin repetir y ordenados, de los scripts en línea de los dos archivos. */
function hashesEnLinea(indexHtml, informesTs) {
    const enLinea = [
        ...[...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]),
        ...[...informesTs.matchAll(/<script>(.*?)<\/script>/g)].map((m) => m[1]),
    ];
    return [...new Set(enLinea.map(hash))].sort();
}

/** Los hashes que la política no autoriza en `script-src`. */
function faltantes(politica, hashes) {
    const scriptSrc = (String(politica).split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src ')) || '')
        .split(/\s+/);
    return hashes.filter((h) => !scriptSrc.includes(h));
}

module.exports = { hashesEnLinea, faltantes };

if (require.main === module) {
    const args = process.argv.slice(2);
    const verificar = args[0] === '--verificar';
    const politica = verificar ? args[1] : null;
    const [index, informes] = verificar ? args.slice(2) : args;
    if (!index || !informes || (verificar && politica === undefined)) {
        console.error('uso: node infra/hashes-csp.js [--verificar "<política>"] <index.html> <informesHtml.ts>');
        process.exit(2);
    }
    const hashes = hashesEnLinea(fs.readFileSync(index, 'utf8'), fs.readFileSync(informes, 'utf8'));
    if (hashes.length === 0) {
        console.error('No se encontraron scripts en línea: revisar antes de armar o comprobar una CSP.');
        process.exit(1);
    }
    if (!verificar) {
        console.log(hashes.join(' '));
    } else {
        const falta = faltantes(politica, hashes);
        if (falta.length) {
            console.error(`Scripts en línea que la CSP activa no autoriza: ${falta.join(' ')}`);
            process.exit(1);
        }
    }
}
