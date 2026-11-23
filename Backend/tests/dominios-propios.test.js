const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const plantilla = () => leer('infra', 'frontend.yml');

const bloque = (texto, nombre) => {
    const inicio = texto.indexOf(`\n  ${nombre}:\n`);
    assert.ok(inicio >= 0, `no está ${nombre}`);
    const resto = texto.slice(inicio + 1);
    const fin = resto.slice(1).search(/\n {2}[A-Za-z]+:\n/);
    return fin < 0 ? resto : resto.slice(0, fin + 1);
};

function redireccionDev() {
    const codigo = /FunctionCode: \|\n((?: {8}.*\n|\n)+)/.exec(bloque(plantilla(), 'RedireccionDev'));
    assert.ok(codigo, 'no se encontró el código de RedireccionDev');
    const fuente = codigo[1].split('\n').map((l) => l.slice(8)).join('\n');
    // eslint-disable-next-line no-new-func
    return new Function(`${fuente}\nreturn handler;`)();
}

const evento = (host, uri = '/', querystring = {}) => ({
    request: { method: 'GET', uri, querystring, headers: host ? { host: { value: host } } : {} },
});

test('la URL de CloudFront de dev redirige con 301 a dev.buildandserve.cl, con la ruta y la consulta', () => {
    const handler = redireccionDev();
    const r = handler(evento('d3pve67iu4s0dd.cloudfront.net', '/restablecer-clave', {
        pid: { value: 'p-1' }, token: { value: 'a b' }, activar: { value: '1' },
    }));
    assert.equal(r.statusCode, 301);
    assert.equal(r.headers.location.value, 'https://dev.buildandserve.cl/restablecer-clave?pid=p-1&token=a%20b&activar=1');
});

test('en dev.buildandserve.cl la petición sigue sin redirigir', () => {
    const handler = redireccionDev();
    const req = evento('dev.buildandserve.cl', '/personas').request;
    assert.equal(handler({ request: req }), req);
});

test('la distribución, las cabeceras y la redirección de prod no dependen de nada de dev', () => {
    const t = plantilla();
    for (const nombre of ['Distribucion', 'CabecerasSeguridad', 'RedireccionWww', 'BucketFrontend', 'PoliticaBucketFrontend']) {
        const b = bloque(t, nombre);
        assert.doesNotMatch(b, /CertificadoDev|ConDominioDev|RedireccionDev|dev\.buildandserve\.cl|CspDev/, nombre);
    }
    const dev = bloque(t, 'DistribucionDev');
    assert.match(dev, /Aliases: !If \[ConDominioDev, \[dev\.buildandserve\.cl\]/);
    assert.match(dev, /AcmCertificateArn: !Ref CertificadoDev/);
    assert.match(dev, /MinimumProtocolVersion: TLSv1\.2_2021/);
    assert.match(dev, /FunctionARN: !GetAtt RedireccionDev\.FunctionMetadata\.FunctionARN/);
});

test('el change set de solo dev se rechaza si toca cualquier recurso que no sea de dev', () => {
    const { revisar, RECURSOS_DEV } = require(path.join(RAIZ, 'infra', 'cambios-solo-dev.js'));
    const cambio = (recurso) => ({ ResourceChange: { Action: 'Modify', LogicalResourceId: recurso, ResourceType: 'x' } });
    assert.equal(revisar({ Changes: [cambio('DistribucionDev'), cambio('RedireccionDev'), cambio('CabecerasSeguridadDev')] }).ok, true);
    assert.equal(revisar({ Changes: [] }).ok, true);
    for (const prod of ['Distribucion', 'CabecerasSeguridad', 'RedireccionWww', 'BucketFrontend', 'PoliticaBucketFrontend', 'AccesoOrigen', 'RolPublicador']) {
        const r = revisar({ Changes: [cambio('DistribucionDev'), cambio(prod)] });
        assert.equal(r.ok, false, prod);
        assert.deepEqual(r.ajenos.map((c) => c.recurso), [prod]);
    }
    const recursos = plantilla().split('\nResources:')[1].split('\nOutputs:')[0];
    const recursosDev = [...recursos.matchAll(/\n {2}([A-Za-z]+Dev):\n {4}Type:/g)].map((m) => m[1]);
    assert.deepEqual([...RECURSOS_DEV].sort(), recursosDev.sort(), 'la lista blanca son exactamente los recursos de dev de la plantilla');
});

test('el modo --solo-dev conserva cada parámetro de prod y fija solo los de dev', () => {
    const script = leer('infra', 'desplegar-infra-frontend.sh');
    const { parametros } = require(path.join(RAIZ, 'infra', 'parametros-solo-dev.js'));
    const lista = parametros({ cspDev: "default-src 'self'", reporteDev: 'https://api-dev.buildandserve.cl', certificadoDev: '' });
    const nombres = [...plantilla().split('\nConditions:')[0].matchAll(/\n {2}([A-Za-z]+):\n {4}Type:/g)].map((m) => m[1]);
    assert.deepEqual(lista.map((p) => p.ParameterKey).sort(), [...nombres].sort());
    assert.deepEqual(lista.filter((p) => !p.UsePreviousValue).map((p) => p.ParameterKey).sort(), ['CertificadoDev', 'CspDev', 'ReportingEndpointsDev']);
    for (const p of lista) assert.ok(p.UsePreviousValue === true ? !('ParameterValue' in p) : typeof p.ParameterValue === 'string', p.ParameterKey);
    assert.match(script, /node "\$TMP\/wt\/infra\/parametros-solo-dev\.js" > "\$TMP\/parametros\.json"/);
    assert.match(script, /create-change-set[\s\S]*--parameters "file:\/\/\$TMP\/parametros\.json"/);
    assert.doesNotMatch(script, /ParameterKey=[A-Za-z]+,/);
    assert.doesNotMatch(script.slice(script.indexOf('if [ -n "$SOLO_DEV" ]'), script.indexOf('CSP="$(csp_para "$API_PROD"')), /^\s*aws cloudformation (execute-change-set|deploy)\b/m);
});

test('la CLI de AWS acepta los parámetros de --solo-dev con una CSP real y los envía sin alterar', async () => {
    const { spawn, spawnSync } = require('child_process');
    const http = require('http');
    const os = require('os');
    assert.equal(spawnSync('aws', ['--version']).status, 0, 'esta prueba necesita la CLI de AWS instalada');

    const hashes = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=' 'sha256-Ab/c+D=='";
    const S3 = 'https://*.s3.amazonaws.com https://*.s3.us-east-1.amazonaws.com';
    const cspDev = `default-src 'self'; script-src 'self' ${hashes}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: ${S3}; connect-src 'self' https://n2waslgjca.execute-api.us-east-1.amazonaws.com https://api-dev.buildandserve.cl ${S3}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; report-uri https://n2waslgjca.execute-api.us-east-1.amazonaws.com/csp/reporte; report-to csp`;
    const certificadoDev = 'arn:aws:acm:us-east-1:772706200162:certificate/f95061c0-9096-4713-b530-e8ef8381aa4a';
    const r = spawnSync('node', [path.join(RAIZ, 'infra', 'parametros-solo-dev.js')], {
        encoding: 'utf8', env: { ...process.env, CSP_DEV: cspDev, REPORTE_DEV: 'https://api-dev.buildandserve.cl', CERT_DEV: certificadoDev },
    });
    assert.equal(r.status, 0, r.stderr);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parametros-solo-dev-'));
    const archivo = path.join(dir, 'parametros.json');
    fs.writeFileSync(archivo, r.stdout);
    fs.writeFileSync(path.join(dir, 'plantilla.yml'), 'Resources: {}\n');

    let cuerpo = '';
    const servidor = http.createServer((req, res) => {
        req.on('data', (d) => { cuerpo += d; });
        req.on('end', () => { res.writeHead(400, { 'Content-Type': 'text/xml' }); res.end('<ErrorResponse><Error><Code>Prueba</Code><Message>prueba</Message></Error></ErrorResponse>'); });
    });
    await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
    try {
        const salida = await new Promise((ok) => {
            const p = spawn('aws', ['cloudformation', 'create-change-set', '--stack-name', 'BuildAndServe-frontend',
                '--change-set-name', 'solo-dev-prueba', '--template-body', `file://${path.join(dir, 'plantilla.yml')}`,
                '--capabilities', 'CAPABILITY_NAMED_IAM', '--parameters', `file://${archivo}`,
                '--endpoint-url', `http://127.0.0.1:${servidor.address().port}`, '--region', 'us-east-1'], {
                env: { PATH: process.env.PATH, HOME: dir, AWS_ACCESS_KEY_ID: 'PRUEBA', AWS_SECRET_ACCESS_KEY: 'PRUEBA', AWS_MAX_ATTEMPTS: '1', AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null' },
            });
            let err = '';
            p.stderr.on('data', (d) => { err += d; });
            p.on('close', (codigo) => ok({ codigo, err }));
        });
        assert.doesNotMatch(salida.err, /ParamValidation|Error parsing parameter/, salida.err);
        assert.ok(cuerpo.length > 0, `la CLI no llegó a enviar la petición: ${salida.err}`);
        const enviados = {};
        const datos = cuerpo.trim().startsWith('{') ? JSON.parse(cuerpo).Parameters : null;
        if (datos) {
            for (const p of datos) enviados[p.ParameterKey] = p;
        } else {
            const q = new URLSearchParams(cuerpo);
            for (let n = 1; q.has(`Parameters.member.${n}.ParameterKey`); n++) {
                const clave = q.get(`Parameters.member.${n}.ParameterKey`);
                enviados[clave] = { ParameterKey: clave, ParameterValue: q.get(`Parameters.member.${n}.ParameterValue`), UsePreviousValue: q.get(`Parameters.member.${n}.UsePreviousValue`) };
            }
        }
        assert.equal(enviados.CspDev.ParameterValue, cspDev);
        assert.equal(enviados.ReportingEndpointsDev.ParameterValue, 'csp="https://api-dev.buildandserve.cl/csp/reporte"');
        assert.equal(enviados.CertificadoDev.ParameterValue, certificadoDev);
        for (const clave of ['NombreBucket', 'Csp', 'CspModo', 'ReportingEndpoints', 'CertificadoProd', 'Publicadores', 'ExigirRolPublicador', 'NombreBucketDev']) {
            assert.ok([true, 'true'].includes(enviados[clave].UsePreviousValue), clave);
            assert.ok(enviados[clave].ParameterValue == null, clave);
        }
    } finally {
        servidor.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('cada ambiente tiene su dominio de API, condicionado a que exista el certificado', () => {
    const yml = leer('Backend', 'serverless.yml');
    assert.match(yml, /\n {2}dominioApi:\n {4}prod: api\.buildandserve\.cl\n {4}dev: api-dev\.buildandserve\.cl\n/);
    assert.match(yml, /ConDominioApi: !Not \[!Equals \['\$\{self:custom\.certificadoApi\}', ''\]\]/);
    const dominio = bloque(yml.replace(/\n {4}/g, '\n  ').replace(/\n {6}/g, '\n    '), 'DominioApi');
    assert.match(dominio, /Condition: ConDominioApi/);
    assert.match(dominio, /EndpointType: REGIONAL/);
    assert.match(dominio, /SecurityPolicy: TLS_1_2/);
    assert.match(yml, /MapeoDominioApi:\n {6}Type: AWS::ApiGatewayV2::ApiMapping\n {6}Condition: ConDominioApi/);
});

test('dev sirve en dev.buildandserve.cl y prod no cambia de origen', () => {
    const yml = leer('Backend', 'serverless.yml');
    assert.match(yml, /\n {2}frontendUrl:\n {4}prod: https:\/\/buildandserve\.cl\n {4}dev: https:\/\/dev\.buildandserve\.cl\n/);
    const dev = /\n {2}corsOrigins:\n {4}prod:\n(?: {6}- .+\n)+ {4}dev:\n((?: {6}- .+\n)+)/.exec(yml);
    assert.ok(dev && dev[1].includes('https://dev.buildandserve.cl'));
});

test('cada script de despliegue se niega a correr si no es la versión del commit que despliega', () => {
    for (const nombre of ['desplegar-backend.sh', 'desplegar-frontend.sh', 'desplegar-infra-frontend.sh']) {
        const script = leer('infra', nombre);
        const sha = script.indexOf('SHA="$(git -C "$RAIZ" rev-parse --verify "$COMMIT^{commit}")"');
        const chequeo = script.indexOf('\ncmp -s "$0" <(git -C "$RAIZ" show "$SHA:infra/$(basename "$0")"') + 1;
        assert.ok(sha >= 0 && chequeo > sha, nombre);
        assert.doesNotMatch(script.slice(sha, chequeo), /serverless|aws |npm /, nombre);
        const bloqueChequeo = script.slice(chequeo).split('\n').slice(0, 2).join('\n');
        assert.equal(ejecutarChequeo(bloqueChequeo, false), 0, `${nombre}: con la misma versión sigue`);
        assert.equal(ejecutarChequeo(bloqueChequeo, true), 1, `${nombre}: con otra versión se detiene`);
    }
});

function ejecutarChequeo(bloqueChequeo, modificar) {
    const { execFileSync, spawnSync } = require('child_process');
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-script-'));
    try {
        const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
        git('init', '-q');
        fs.mkdirSync(path.join(dir, 'infra'));
        const archivo = path.join(dir, 'infra', 'd.sh');
        fs.writeFileSync(archivo, ['set -euo pipefail', 'RAIZ="$(git rev-parse --show-toplevel)"', 'SHA="$(git -C "$RAIZ" rev-parse HEAD)"', bloqueChequeo, 'echo sigue', ''].join('\n'));
        git('add', '.');
        git('commit', '-qm', 'a');
        if (modificar) fs.appendFileSync(archivo, '#\n');
        const r = spawnSync('bash', ['infra/d.sh'], { cwd: dir, encoding: 'utf8' });
        if (r.status === 0) assert.match(r.stdout, /sigue/);
        return r.status;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('desplegar-infra-frontend.sh rechaza una opción distinta de --solo-dev en vez de desplegar completo', () => {
    const { spawnSync } = require('child_process');
    for (const opcion of ['--solodev', 'solo-dev', '--dev']) {
        const r = spawnSync('bash', [path.join(RAIZ, 'infra', 'desplegar-infra-frontend.sh'), 'HEAD', opcion], {
            encoding: 'utf8', env: { PATH: '/usr/bin:/bin' },
        });
        assert.equal(r.status, 1, opcion);
        assert.match(r.stderr, /Opción desconocida/, opcion);
    }
});
