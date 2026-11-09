// Grupos de logs cifrados con la clave propia (D-4, D-14).
//
// Serverless crea un grupo de logs por función y no deja ponerle llave. El
// plugin `plugins/logs-cifrados.js` se la pone a todos al armar el template, y
// la política de `ClaveDatos` autoriza a CloudWatch Logs de esta cuenta y región.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Plugin = require('../plugins/logs-cifrados');
const yml = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');

const template = () => ({
    Resources: {
        ClaveDatos: { Type: 'AWS::KMS::Key', Properties: {} },
        ALogGroup: { Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: '/aws/lambda/a', RetentionInDays: 14 } },
        BLogGroup: { Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: '/aws/lambda/b' } },
        Tabla: { Type: 'AWS::DynamoDB::Table', Properties: {} },
    },
});

test('todo grupo de logs queda con la llave propia, sin perder lo demás', () => {
    const t = template();
    assert.equal(Plugin.cifrarGruposDeLogs(t), 2);
    for (const id of ['ALogGroup', 'BLogGroup']) {
        assert.deepEqual(t.Resources[id].Properties.KmsKeyId, { 'Fn::GetAtt': ['ClaveDatos', 'Arn'] });
    }
    assert.equal(t.Resources.ALogGroup.Properties.RetentionInDays, 14);
    assert.equal(t.Resources.Tabla.Properties.KmsKeyId, undefined, 'solo los grupos de logs');
});

test('sin la llave en el template, el plugin no deja seguir', () => {
    const t = template();
    delete t.Resources.ClaveDatos;
    const p = new Plugin({ service: { provider: { compiledCloudFormationTemplate: t } } });
    assert.throws(() => p.aplicar(), /ClaveDatos/);
});

test('corre después de unir los recursos propios (antes no está la llave)', () => {
    const p = new Plugin({ service: { provider: { compiledCloudFormationTemplate: template() } } });
    assert.deepEqual(Object.keys(p.hooks), ['after:aws:package:finalize:mergeCustomProviderResources']);
});

test('el plugin está declarado, y la llave autoriza a CloudWatch Logs solo de esta cuenta y región', () => {
    assert.match(yml, /\nplugins:\n(?:  (?:- |# ).+\n)*  - \.\/plugins\/logs-cifrados\.js\n/);
    const inicio = yml.indexOf('- Sid: Uso desde CloudWatch Logs');
    const politica = yml.slice(inicio, yml.indexOf('# Sobres de firma sin conexión', inicio));
    assert.match(politica, /Service: !Sub 'logs\.\$\{AWS::Region\}\.amazonaws\.com'/);
    assert.match(politica, /'kms:EncryptionContext:aws:logs:arn': !Sub 'arn:aws:logs:\$\{AWS::Region\}:\$\{AWS::AccountId\}:log-group:\*'/);
    assert.ok(!/kms:\*/.test(politica), 'no todas las acciones');
});
