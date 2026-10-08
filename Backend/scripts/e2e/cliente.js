/**
 * Cliente de la API para las pruebas de punta a punta.
 *
 * Manda el `Origin` del frontend del ambiente, como el navegador: así la prueba
 * pasa por la misma configuración de CORS que un usuario real. La URL de la API
 * y el origen salen de las salidas de los stacks, no de constantes: un stack
 * redesplegado con otra API no deja la prueba apuntando a la anterior.
 */

const { execFileSync } = require('child_process');

// Con la CLI, como `scripts/entorno.js`: el SDK de CloudFormation no es una
// dependencia del backend y no vale la pena sumarla para esto.
function salidasDe(stack) {
    const salida = execFileSync('aws', [
        'cloudformation', 'describe-stacks', '--stack-name', stack,
        '--query', 'Stacks[0].Outputs', '--output', 'json',
    ], { encoding: 'utf8' });
    return Object.fromEntries((JSON.parse(salida) || []).map((o) => [o.OutputKey, o.OutputValue]));
}

/** API y origen del frontend de un ambiente. */
function ambiente(stage) {
    const backend = salidasDe(`BuildAndServe-${stage}`);
    const frontend = salidasDe('BuildAndServe-frontend');
    return {
        api: backend.HttpApiUrl,
        // Prod se sirve en el dominio propio (D-21); dev, en su distribución (D-20).
        origen: stage === 'prod' ? 'https://buildandserve.cl' : `https://${frontend.DominioDistribucionDev}`,
    };
}

function crearCliente({ api, origen }) {
    /**
     * @returns {{ status, cuerpo, cabeceras }} nunca lanza por un estado HTTP:
     *   quien llama decide qué esperaba.
     */
    async function pedir(metodo, ruta, { token, cuerpo, origin = origen } = {}) {
        const cabeceras = { 'Content-Type': 'application/json' };
        if (origin) cabeceras.Origin = origin;
        if (token) cabeceras.Authorization = `Bearer ${token}`;
        const r = await fetch(`${api}${ruta}`, {
            method: metodo,
            headers: cabeceras,
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        });
        const texto = await r.text();
        let json = null;
        try { json = texto ? JSON.parse(texto) : null; } catch { json = { crudo: texto.slice(0, 200) }; }
        return { status: r.status, cuerpo: json, cabeceras: r.headers };
    }
    return { pedir, api, origen };
}

module.exports = { ambiente, crearCliente };
