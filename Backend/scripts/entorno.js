/**
 * El entorno de un script de operación es el de la Lambda del ambiente: tablas,
 * buckets, parámetros de SSM, remitente y conjunto de configuración de SES.
 *
 * Antes cada script armaba el suyo a mano, y se desfasaba: el día que el correo
 * pasó a `no-responder@buildandserve.cl` con lista de suprimidas (D-21), los
 * scripts de alta seguían con el remitente viejo y sin la tabla, y el correo de
 * bienvenida fallaba siempre. Leerlo de la Lambda hace que un script haga
 * exactamente lo que haría el sistema.
 *
 * No pisa lo que ya esté definido: quien opera puede sobrescribir a mano.
 */

const { execFileSync } = require('child_process');

function cargarEntornoDe(stage, funcion = 'personasModule') {
    const salida = execFileSync('aws', [
        'lambda', 'get-function-configuration',
        '--function-name', `BuildAndServe-${stage}-${funcion}`,
        '--query', 'Environment.Variables', '--output', 'json',
    ], { encoding: 'utf8' });
    const variables = JSON.parse(salida) || {};
    for (const [k, v] of Object.entries(variables)) {
        if (k.startsWith('AWS_')) continue;
        if (process.env[k] === undefined) process.env[k] = v;
    }
    process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
    return variables;
}

module.exports = { cargarEntornoDe };
