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
    const parametros = [...plantilla().split('\nConditions:')[0].matchAll(/\n {2}([A-Za-z]+):\n {4}Type:/g)].map((m) => m[1]);
    const previos = (/\$\(previo ([A-Za-z ]+)\)/.exec(script) || [])[1].trim().split(/\s+/);
    const fijados = [...script.matchAll(/"ParameterKey=([A-Za-z]+),ParameterValue=/g)].map((m) => m[1]);
    assert.deepEqual([...previos, ...fijados].sort(), [...parametros].sort());
    assert.deepEqual(fijados.sort(), ['CertificadoDev', 'CspDev', 'ReportingEndpointsDev']);
    assert.match(script, /create-change-set/);
    assert.doesNotMatch(script.slice(script.indexOf('if [ -n "$SOLO_DEV" ]'), script.indexOf('CSP="$(csp_para "$API_PROD"')), /^\s*aws cloudformation (execute-change-set|deploy)\b/m);
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
