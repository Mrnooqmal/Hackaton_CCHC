// La CSP del frontend pasa a modo activo, sin dejar la aplicación en blanco.
//
// En solo reporte, un script en línea que la política no autoriza se reporta y
// corre igual. En modo activo NO corre: si se publica un index.html con un
// script nuevo sin redesplegar la política, la aplicación queda en blanco para
// todo el mundo. Estas pruebas fijan las piezas que lo impiden:
//
//   - los hashes se calculan en un solo lugar (infra/hashes-csp.js), el mismo
//     para armar la política y para comprobar un build;
//   - la plantilla pone la política activa en la cabecera de seguridad (CloudFront
//     no acepta una cabecera propia con el nombre de una de seguridad), y deja de
//     mandar la de solo reporte;
//   - publicar el frontend se niega si el build no pasa la política activa;
//   - desplegar la infra en modo activo se niega si el frontend que se sirve hoy
//     no pasa la política nueva.
//
// Los scripts de infra no se pueden correr acá (construyen y despliegan): se
// fija su texto, como `doble-dynamo-tablas.js` hace con serverless.yml.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INFRA = path.join(__dirname, '..', '..', 'infra');
const { hashesEnLinea, faltantes } = require(path.join(INFRA, 'hashes-csp.js'));
const leer = (f) => fs.readFileSync(path.join(INFRA, f), 'utf8');
const sha = (t) => `'sha256-${crypto.createHash('sha256').update(t).digest('base64')}'`;

// ─── Hashes ──────────────────────────────────────────────────────────────────

test('hashes: los scripts en línea del index y el de los informes, sin los que tienen src', () => {
    const index = '<html><script>window.a=1</script><script type="module" src="/assets/x.js"></script><script>window.a=1</script></html>';
    const informes = 'const html = `<script>window.print()</script>`;';
    assert.deepEqual(hashesEnLinea(index, informes), [sha('window.a=1'), sha('window.print()')].sort());
});

test('hashes: solo cuenta lo que autoriza script-src', () => {
    const h = sha('x');
    assert.deepEqual(faltantes(`default-src 'self'; script-src 'self' ${h}`, [h]), []);
    // El mismo hash en otra directiva no autoriza el script.
    assert.deepEqual(faltantes(`default-src ${h}; script-src 'self'`, [h]), [h]);
    assert.deepEqual(faltantes('', [h]), [h]);
});

test('hashes: los del frontend actual (index.html e informes) salen iguales que los de la política desplegada hoy', () => {
    // Estos dos son los que tiene la política de las dos distribuciones desde el
    // 30 de septiembre, armada con la versión anterior en Python. Si el cálculo
    // nuevo diera otros, la primera política activa bloquearía la aplicación.
    // Si este cambia porque cambió el script de index.html o de los informes, no
    // es un error: es el aviso de que hay que redesplegar la infra ANTES de
    // publicar ese frontend (desplegar-frontend.sh también lo exige).
    const frontend = path.join(__dirname, '..', '..', 'Frontend');
    const hashes = hashesEnLinea(
        fs.readFileSync(path.join(frontend, 'index.html'), 'utf8'),
        fs.readFileSync(path.join(frontend, 'src', 'utils', 'informesHtml.ts'), 'utf8'),
    );
    assert.deepEqual(hashes, ["'sha256-HKZud+V6bha3laNux4Y/TiH5OVNqBKS9A5ryGHTrdz0='", "'sha256-bFAHt4P5Lf2EVJOMpk9ZiEgN2pCuPJSmyHuaXntlHKs='"]);
});

// ─── Plantilla ───────────────────────────────────────────────────────────────

const plantilla = leer('frontend.yml');

test('plantilla: el modo es un parámetro, activo por omisión, con vuelta a solo reporte', () => {
    assert.match(plantilla, /\n {2}CspModo:\n {4}Type: String\n {4}Default: activa\n {4}AllowedValues: \[activa, solo-reporte\]/);
});

test('plantilla: en modo activo la política va en la cabecera de seguridad, en las dos distribuciones', () => {
    for (const [cond, param] of [['CspActiva', 'Csp'], ['CspActivaDev', 'CspDev']]) {
        assert.ok(plantilla.includes(`ContentSecurityPolicy: !If [${cond}, !Ref ${param}, "frame-ancestors 'none'"]`),
            `${cond}: la política activa tiene que ir en SecurityHeadersConfig, conservando frame-ancestors en solo reporte`);
        assert.match(plantilla, new RegExp(`${cond}: !And \\[!Condition ConCsp(Dev)?, !Equals \\[!Ref CspModo, activa\\]\\]`));
    }
});

test('plantilla: ninguna cabecera propia se llama Content-Security-Policy, y la de solo reporte se apaga en modo activo', () => {
    // CloudFront rechaza la política de cabeceras si una propia repite el nombre
    // de una de seguridad.
    assert.ok(!/Header: Content-Security-Policy\s*\n/.test(plantilla));
    for (const cond of ['CspActiva', 'CspActivaDev']) {
        assert.match(plantilla, new RegExp(`- !If\\n\\s+- ${cond}\\n\\s+- !Ref AWS::NoValue\\n\\s+- Header: Content-Security-Policy-Report-Only`),
            `${cond}: en modo activo no se manda también la de solo reporte`);
    }
    // Los reportes siguen llegando en los dos modos.
    assert.equal((plantilla.match(/Header: Reporting-Endpoints/g) || []).length, 2);
});

// ─── Scripts de despliegue ───────────────────────────────────────────────────

test('publicar el frontend se niega si el build no pasa la CSP activa, antes de subir nada', () => {
    const s = leer('desplegar-frontend.sh');
    const guardia = s.indexOf('if [ "$CSP_MODO" = activa ]; then');
    const verifica = s.indexOf('hashes-csp.js" --verificar "$POLITICA" dist/index.html', guardia);
    const sube = s.indexOf('aws s3 sync dist');
    assert.ok(guardia > 0 && verifica > guardia, 'falta la comprobación contra la política activa');
    assert.ok(verifica < sube, 'la comprobación tiene que correr antes de subir el build');
    // El bloque que sigue a la comprobación, hasta el aviso de éxito, tiene que salir.
    const bloque = s.slice(verifica, s.indexOf('echo "== los scripts en línea del build', verifica));
    assert.match(bloque, /\|\| \{[^}]*\bexit 1; \}\s*$/, 'si el build no pasa, el script tiene que salir');
    assert.ok(s.includes('POLITICA="$(parametro "Csp$SUFIJO")"'), 'la política es la de la distribución del ambiente');
});

test('desplegar la infra: activa por omisión, hashes del script compartido, y comprueba lo servido antes y después', () => {
    const s = leer('desplegar-infra-frontend.sh');
    assert.ok(s.includes('CSP_MODO="${CSP_MODO:-activa}"'));
    assert.ok(s.includes('node "$TMP/wt/infra/hashes-csp.js" dist/index.html src/utils/informesHtml.ts'), 'los hashes salen de hashes-csp.js');
    assert.ok(!s.includes('python3'), 'un solo cálculo de hashes: sin la copia en Python');
    assert.ok(s.includes('"CspModo=$CSP_MODO"'));
    const antes = s.indexOf('--verificar "${par#*:}" "$TMP/servido.html"');
    const despliega = s.indexOf('aws cloudformation deploy');
    assert.ok(antes > 0 && antes < despliega, 'lo servido hoy se comprueba antes de desplegar la política activa');
    assert.ok(s.indexOf("grep -qiE '^content-security-policy:.*script-src'") > despliega, 'después se comprueba la cabecera que llega');
});
