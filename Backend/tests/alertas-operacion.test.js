const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const yml = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');

test('las alarmas van a soporte@buildandserve.cl, sin variable de entorno que lo cambie', () => {
    const linea = yml.split('\n').find((l) => /^\s+destinatarioAlertas:/.test(l));
    assert.ok(linea, 'existe custom.destinatarioAlertas');
    assert.ok(!/\$\{(env|opt|ssm):/.test(linea), 'ninguna variable de entorno ni opción reemplaza la casilla');
    assert.equal(linea.split(':').slice(1).join(':').trim(), 'soporte@buildandserve.cl');
});

test('la suscripción es por correo, al tópico de alertas y con esa casilla', () => {
    const inicio = yml.indexOf('    AlertasOperacionSuscripcion:');
    assert.ok(inicio > 0, 'la suscripción está declarada en CloudFormation');
    const bloque = yml.slice(inicio, yml.indexOf('\n\n', inicio));
    assert.match(bloque, /Type: AWS::SNS::Subscription/);
    assert.match(bloque, /TopicArn: !Ref AlertasOperacionTopic/);
    assert.match(bloque, /Protocol: email\n/);
    assert.match(bloque, /Endpoint: \$\{self:custom\.destinatarioAlertas\}/);
});

test('toda alarma avisa al tópico de alertas', () => {
    const alarmas = yml.split(/\n(?=    [A-Za-z0-9]+:\n)/).filter((b) => /Type: AWS::CloudWatch::Alarm/.test(b));
    assert.ok(alarmas.length >= 6, `se esperaban al menos 6 alarmas, hay ${alarmas.length}`);
    for (const b of alarmas) {
        const nombre = b.trim().split(':')[0];
        assert.match(b, /AlarmActions:\s*\n\s*- !Ref AlertasOperacionTopic/, `${nombre} avisa al tópico de alertas`);
    }
});
