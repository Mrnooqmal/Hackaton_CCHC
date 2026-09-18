/**
 * Fallos de dependencia que no se pueden ver desde afuera.
 *
 * ── El problema ──────────────────────────────────────────────────────────────
 *
 * Varias respuestas del sistema son deliberadamente opacas: la recuperación de
 * contraseña contesta siempre lo mismo para no revelar si un RUT existe, la
 * comprobación de pertenencia contesta 404 para no revelar que un documento vive
 * en otra empresa, y el autorizador niega ante cualquier duda. Todas esas
 * decisiones son correctas y no se tocan.
 *
 * El costo es que un fallo REAL —DynamoDB que no responde, un permiso que
 * falta— se ve exactamente igual que el caso previsto. Ya nos pasó: la
 * recuperación de contraseña estuvo caída respondiendo 200 con su mensaje
 * genérico, y solo se detectó porque alguien insistió.
 *
 * ── Qué hace esto ────────────────────────────────────────────────────────────
 *
 * `conNeutro` ejecuta una lectura accesoria y, si falla, devuelve el valor
 * neutro —lo mismo que hacía el `.catch(() => null)` de antes— pero **dejando
 * constancia medible**. Hacia afuera no cambia nada; hacia adentro deja de ser
 * indistinguible.
 *
 * La constancia se emite en formato de métrica embebida (EMF): CloudWatch la
 * convierte sola en la métrica `FallosDependencia` del espacio `BuildAndServe`,
 * sin necesidad de declarar un filtro por cada uno de los 72 grupos de log. La
 * alarma sobre esa métrica está declarada en `serverless.yml`.
 *
 * ── Cuándo NO usar esto ──────────────────────────────────────────────────────
 *
 * Cuando el valor neutro miente. Si de una lectura depende decir "esta empresa
 * no necesita comité paritario", "este código de obra está libre" o "este RUT no
 * está repetido", degradar convierte un fallo en una afirmación falsa. Ahí el
 * error se propaga y la operación falla: es preferible que no se pueda calcular
 * a que se calcule mal. Esa frontera está marcada caso por caso en el código.
 */

const NOMBRE_METRICA = 'FallosDependencia';
const ESPACIO = 'BuildAndServe';

/**
 * Deja constancia de un fallo de dependencia, en formato de métrica embebida.
 *
 * Nunca lanza: si registrar el problema fallara, no puede tumbar la operación
 * que venía a proteger.
 */
function registrarFallo(operacion, err, contexto = {}) {
    try {
        const linea = {
            _aws: {
                Timestamp: Date.now(),
                CloudWatchMetrics: [{
                    Namespace: ESPACIO,
                    // Por ambiente para la alarma, y por operación para saber
                    // dónde mirar sin abrir los logs.
                    Dimensions: [['stage'], ['stage', 'operacion']],
                    Metrics: [{ Name: NOMBRE_METRICA, Unit: 'Count' }],
                }],
            },
            stage: process.env.STAGE || process.env.AWS_LAMBDA_FUNCTION_NAME?.split('-')[1] || 'desconocido',
            operacion,
            [NOMBRE_METRICA]: 1,
            mensaje: err?.message || String(err),
            tipo: err?.name || 'Error',
            ...contexto,
        };
        console.error('FALLO_DEPENDENCIA', JSON.stringify(linea));
    } catch {
        /* registrar no puede romper nada */
    }
}

/**
 * Ejecuta una lectura accesoria. Si falla, devuelve el valor neutro y deja
 * constancia.
 *
 * @param {string} operacion  Nombre corto y estable (sirve de dimensión de la
 *                            métrica, así que no lleva ids adentro).
 * @param {() => Promise<any>} fn
 * @param {any} neutro        Lo que se devuelve si falla: `null`, `[]`, `{}`…
 * @param {object} [contexto] Datos para el log. NO incluir datos personales.
 */
async function conNeutro(operacion, fn, neutro, contexto = {}) {
    try {
        return await fn();
    } catch (err) {
        registrarFallo(operacion, err, contexto);
        return neutro;
    }
}

module.exports = { conNeutro, registrarFallo, NOMBRE_METRICA, ESPACIO };
