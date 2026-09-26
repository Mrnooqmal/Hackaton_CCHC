// Las pruebas unitarias no tocan AWS. Este archivo lo garantiza para TODAS.
//
// Se carga antes de cada archivo de pruebas (`--require` en `npm test`). Hasta
// ahora dependía de que cada prueba se acordara de simular cada cliente, y una
// se olvidó: la de recuperación de contraseña llamaba a SES de verdad, con las
// credenciales de quien corría las pruebas, para mandar un correo a
// `persona@ejemplo.cl`. No llegó porque la cuenta de SES está en sandbox — el
// día que salga del sandbox, correr las pruebas habría mandado correos reales.
//
// Dos capas:
//
//   1. Credenciales falsas en el entorno, para que ningún cliente del SDK
//      encuentre las reales (ni el perfil de ~/.aws, ni SSO, ni la metadata de
//      una instancia) aunque la segunda capa fallara.
//   2. El manejador HTTP del SDK (`@smithy/node-http-handler`, una sola copia
//      que usan DynamoDB, S3, SES, KMS y SSM) queda interceptado: toda salida a
//      la red lanza un error que nombra el servicio y la ruta.
//
// Y como hay código que se traga errores a propósito —el envío de correo, las
// lecturas accesorias con `conNeutro`—, lanzar no alcanza: el intento queda
// registrado y, si hubo alguno, el archivo de pruebas termina con código de
// error aunque todas sus pruebas hayan "pasado".

process.env.AWS_ACCESS_KEY_ID = 'PRUEBA_SIN_AWS';
process.env.AWS_SECRET_ACCESS_KEY = 'PRUEBA_SIN_AWS';
process.env.AWS_SESSION_TOKEN = 'PRUEBA_SIN_AWS';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
delete process.env.AWS_PROFILE;

const { NodeHttpHandler } = require('@smithy/node-http-handler');

const intentos = [];

NodeHttpHandler.prototype.handle = async function bloquearRed(request) {
    const destino = `${request.method} ${request.hostname}${request.path || ''}`;
    intentos.push(destino);
    throw new Error(`Una prueba intentó llamar a AWS de verdad: ${destino}. Simula el cliente.`);
};

process.on('exit', () => {
    if (intentos.length === 0) return;
    const archivo = process.argv[1] || 'este archivo de pruebas';
    process.stderr.write(`\nLLAMADAS REALES A AWS en ${archivo} (${intentos.length}):\n`
        + [...new Set(intentos)].map((d) => `  - ${d}`).join('\n') + '\n');
    process.exitCode = 1;
});
