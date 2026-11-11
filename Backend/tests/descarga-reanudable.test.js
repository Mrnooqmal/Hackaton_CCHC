// La verificación de los despliegues retoma la descarga si se corta
// (infra/descarga.sh). El 10 de noviembre de 2026 el paquete de 41 MB de la
// Lambda se cortó dos veces y el despliegue quedó sin verificar.
//
// Se prueba la función de bash de verdad contra un servidor local que corta la
// conexión a propósito y que, como S3 y CloudFront, atiende peticiones con Range.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');

const INFRA = path.join(__dirname, '..', '..', 'infra');
const CONTENIDO = crypto.randomBytes(300 * 1024);

/** Servidor que entrega a lo más `porRespuesta` bytes por petición y corta. */
function servidor({ porRespuesta = 100 * 1024, falla = false } = {}) {
    const peticiones = [];
    const s = http.createServer((req, res) => {
        peticiones.push(req.headers.range || null);
        if (falla) { res.writeHead(500); res.end(); return; }
        const desde = Number((/bytes=(\d+)-/.exec(req.headers.range || '') || [])[1] || 0);
        const trozo = CONTENIDO.subarray(desde, desde + porRespuesta);
        const cabeceras = { 'Content-Length': CONTENIDO.length - desde, 'Accept-Ranges': 'bytes' };
        if (desde > 0) {
            res.writeHead(206, { ...cabeceras, 'Content-Range': `bytes ${desde}-${CONTENIDO.length - 1}/${CONTENIDO.length}` });
        } else {
            res.writeHead(200, cabeceras);
        }
        res.write(trozo, () => { if (desde + trozo.length < CONTENIDO.length) res.socket.destroy(); else res.end(); });
    });
    return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, peticiones, url: `http://127.0.0.1:${s.address().port}/paquete.zip` })));
}

const descargar = (url, salida, esperado, entorno = {}) => new Promise((resolve) => {
    execFile('bash', ['-c', `source "${INFRA}/descarga.sh"; descargar_reanudable "$1" "$2" echo "$3"`, '_', salida, String(esperado), url],
        { env: { ...process.env, DESCARGA_TIEMPO: '5', ...entorno } }, (err, stdout, stderr) => resolve({ codigo: err ? err.code : 0, stderr }));
});

test('se corta cada 100 KB y la descarga se completa retomando, idéntica al original', async () => {
    const { s, peticiones, url } = await servidor();
    const salida = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'descarga-')), 'p.zip');
    try {
        const r = await descargar(url, salida, CONTENIDO.length);
        assert.equal(r.codigo, 0, r.stderr);
        assert.ok(fs.readFileSync(salida).equals(CONTENIDO));
        assert.ok(peticiones.length >= 3, 'hicieron falta varios intentos');
        assert.equal(peticiones[0], null, 'el primero, desde el comienzo');
        assert.match(peticiones[1], /^bytes=102400-/, 'el segundo, desde donde quedó');
    } finally {
        s.close();
    }
});

test('si nunca se completa, falla con un mensaje y sin quedarse colgada', async () => {
    const { s, url } = await servidor({ falla: true });
    const salida = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'descarga-')), 'p.zip');
    try {
        const r = await descargar(url, salida, CONTENIDO.length, { DESCARGA_INTENTOS: '3' });
        assert.notEqual(r.codigo, 0);
        assert.match(r.stderr, /no se completó en 3 intentos/);
    } finally {
        s.close();
    }
});

test('un archivo más grande de lo esperado se descarta y se baja de nuevo', async () => {
    const { s, url } = await servidor({ porRespuesta: CONTENIDO.length });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'descarga-'));
    const salida = path.join(dir, 'p.zip');
    fs.writeFileSync(salida, Buffer.alloc(CONTENIDO.length + 10));
    try {
        const r = await descargar(url, salida, CONTENIDO.length);
        assert.equal(r.codigo, 0, r.stderr);
        assert.ok(fs.readFileSync(salida).equals(CONTENIDO));
    } finally {
        s.close();
    }
});

test('los dos scripts verifican con la descarga reanudable', () => {
    const b = fs.readFileSync(path.join(INFRA, 'desplegar-backend.sh'), 'utf8');
    const f = fs.readFileSync(path.join(INFRA, 'desplegar-frontend.sh'), 'utf8');
    for (const s of [b, f]) assert.ok(s.includes('source "$(dirname "$0")/descarga.sh"'));
    // Backend: URL nueva en cada intento (la prefirmada vence) y la huella de la función.
    assert.match(b, /descargar_reanudable "\$TMP\/paquete\.zip" "\$TAMANO" url_paquete \|\| exit 1/);
    assert.match(b, /openssl dgst -sha256 -binary "\$TMP\/paquete\.zip" \| base64\)" = "\$HUELLA"/);
    assert.ok(!/curl -fsS -o "\$TMP\/paquete\.zip"/.test(b), 'sin la descarga de un solo intento');
    // Frontend: cada archivo, con su tamaño y la comparación con el build.
    assert.ok(f.includes('descargar_reanudable "$TMP/publicado/archivo" "$(stat -c %s "dist/$f")" echo "https://$DOMINIO/$f"'));
    assert.ok(f.includes('! cmp -s "$TMP/publicado/archivo" "dist/$f"'));
    assert.ok(!/curl -fsS "https:\/\/\$DOMINIO\/\$f" \| cmp/.test(f), 'sin la descarga de un solo intento');
});
