/**
 * Cifra con la clave propia (`ClaveDatos`, D-4) todos los grupos de logs del
 * stack.
 *
 * Serverless crea un grupo de logs por función y no permite ponerle llave. Este
 * plugin, antes de guardar el template, le agrega `KmsKeyId` a cada recurso
 * `AWS::Logs::LogGroup`: los de hoy y los de cualquier función nueva, sin
 * declararlos uno por uno. La política de la llave autoriza a CloudWatch Logs
 * de esta cuenta y región (ver `ClaveDatos` en serverless.yml).
 *
 * Asociar la llave a un grupo existente no lo reemplaza ni borra lo que tiene:
 * lo nuevo se cifra con ella; lo anterior sigue legible hasta que vence por la
 * retención. `Backend/tests/logs-cifrados.test.js`.
 */

const LLAVE = 'ClaveDatos';

function cifrarGruposDeLogs(template) {
    let cifrados = 0;
    for (const recurso of Object.values(template.Resources || {})) {
        if (recurso.Type !== 'AWS::Logs::LogGroup') continue;
        recurso.Properties = { ...(recurso.Properties || {}), KmsKeyId: { 'Fn::GetAtt': [LLAVE, 'Arn'] } };
        cifrados += 1;
    }
    return cifrados;
}

class LogsCifrados {
    constructor(serverless) {
        this.serverless = serverless;
        this.hooks = {
            // Después de unir los recursos propios (resources) al template, antes
            // de guardarlo: así también quedan los grupos declarados a mano. En
            // `before:package:finalize` todavía no están (ni la llave), y el
            // plugin se niega a seguir.
            'after:aws:package:finalize:mergeCustomProviderResources': () => this.aplicar(),
        };
    }

    aplicar() {
        const template = this.serverless.service.provider.compiledCloudFormationTemplate;
        if (!template.Resources?.[LLAVE]) {
            throw new Error(`logs-cifrados: no está el recurso ${LLAVE} en el template; los logs quedarían sin la llave propia.`);
        }
        const n = cifrarGruposDeLogs(template);
        this.serverless.cli?.log?.(`logs-cifrados: ${n} grupos de logs con ${LLAVE}`);
    }
}

module.exports = LogsCifrados;
module.exports.cifrarGruposDeLogs = cifrarGruposDeLogs;
