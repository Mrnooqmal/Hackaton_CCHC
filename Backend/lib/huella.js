/**
 * Huella de integridad de un contenido firmado.
 *
 * ── Por qué este archivo existe ──────────────────────────────────────────────
 *
 * La huella anterior (`RegistroService.hashSnapshot`) hacía
 *
 *     JSON.stringify(snapshot, Object.keys(snapshot).sort())
 *
 * con la intención de ordenar las claves. Un ARREGLO como segundo argumento de
 * `JSON.stringify` no ordena nada: es una lista de propiedades PERMITIDAS, y se
 * aplica en todos los niveles. Toda propiedad anidada cuyo nombre no coincidía
 * con una clave de primer nivel se descartaba sin aviso. Lo que se firmaba del
 * informe del Art. 71 era literalmente `"afectado":{}`, `"accidente":{}`,
 * `"causasRaiz":[{}]`: se podía cambiar al trabajador accidentado, la gravedad,
 * marcarlo como fatal o reescribir la causa raíz, y la huella no cambiaba. No
 * llegó a firmarse ningún informe con ella (0 en dev y en prod al corregirla).
 *
 * ── Las tres reglas ──────────────────────────────────────────────────────────
 *
 * 1. **Se calcula sobre el contenido en claro, nunca sobre el cifrado.** Si se
 *    calculara sobre el cifrado, rotar la llave —que vuelve a cifrar con otro
 *    sobre— invalidaría la huella de todo documento ya firmado, y la evidencia
 *    dejaría de poder probarse. Orden: armar el contenido → huella → recién
 *    después cifrar para guardar. Verificar: descifrar → huella → comparar.
 *
 * 2. **Forma canónica de verdad.** Claves ordenadas en TODOS los niveles, sin
 *    listas de permitidos. Así, descifrar, parsear y volver a serializar da los
 *    mismos bytes aunque el orden de las claves cambie en el camino.
 *
 * 3. **Versionada.** La huella guarda con qué algoritmo y con qué forma
 *    canónica se calculó. Si la forma canónica cambia algún día, la evidencia
 *    ya firmada se sigue verificando con la regla con que se firmó.
 *
 * ── La forma canónica `json-canonico-v1` ─────────────────────────────────────
 *
 * JSON sin espacios, con las claves de cada objeto ordenadas por unidades de
 * código UTF-16 (el orden de `Array.prototype.sort` sin comparador). Las
 * propiedades `undefined` se omiten y un `undefined` dentro de un arreglo es
 * `null` — exactamente lo que hace `JSON.stringify`, para que el contenido que
 * vuelve de un cifrado (que pasa por JSON) dé la misma huella que el original.
 * Lo que JSON no representa sin perder información (`NaN`, `Infinity`,
 * funciones, `BigInt`, instancias que no son objetos planos) se rechaza en vez
 * de convertirse en silencio: una huella que ignora una parte del contenido es
 * justamente el error que motivó este archivo.
 */

const crypto = require('crypto');

const ALGORITMO = 'sha256';
const CANON_ACTUAL = 'json-canonico-v1';

const esObjetoPlano = (v) => {
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
};

/** Serialización canónica `json-canonico-v1`. */
const formaCanonica = (valor) => {
    if (valor === null) return 'null';

    switch (typeof valor) {
        case 'string':
        case 'boolean':
            return JSON.stringify(valor);
        case 'number':
            if (!Number.isFinite(valor)) {
                throw new Error(`La huella no admite el número ${valor}: JSON lo convertiría en null sin aviso`);
            }
            return JSON.stringify(valor);
        case 'object':
            if (Array.isArray(valor)) {
                return `[${valor.map((v) => (v === undefined ? 'null' : formaCanonica(v))).join(',')}]`;
            }
            // Una fecha viaja por JSON como su texto ISO: se representa igual.
            if (valor instanceof Date) return JSON.stringify(valor);
            if (!esObjetoPlano(valor)) {
                throw new Error(`La huella no admite instancias de ${valor.constructor?.name || 'objeto no plano'}`);
            }
            return `{${Object.keys(valor)
                .filter((k) => valor[k] !== undefined)
                .sort()
                .map((k) => `${JSON.stringify(k)}:${formaCanonica(valor[k])}`)
                .join(',')}}`;
        default:
            throw new Error(`La huella no admite valores de tipo ${typeof valor}`);
    }
};

const CANONES = {
    'json-canonico-v1': formaCanonica,
};

const digerir = (texto, alg) => crypto.createHash(alg).update(texto, 'utf8').digest('hex');

/**
 * Huella del contenido EN CLARO, con la regla vigente.
 *
 * @returns {{ alg: string, canon: string, valor: string }}
 */
const calcularHuella = (contenido) => ({
    alg: ALGORITMO,
    canon: CANON_ACTUAL,
    valor: digerir(formaCanonica(contenido), ALGORITMO),
});

/**
 * ¿El contenido en claro corresponde a la huella guardada?
 *
 * Usa la forma canónica y el algoritmo CON QUE SE FIRMÓ, no los vigentes. Una
 * huella con una regla desconocida lanza en vez de devolver `false`: "no sé
 * verificar esto" y "esto fue alterado" son afirmaciones distintas, y
 * confundirlas es presentar como adulterado un documento íntegro.
 */
const verificarHuella = (contenido, huella) => {
    if (!huella || typeof huella !== 'object') throw new Error('No hay huella que verificar');
    const canonizar = CANONES[huella.canon];
    if (!canonizar) throw new Error(`Forma canónica desconocida: ${huella.canon}`);
    if (!crypto.getHashes().includes(huella.alg)) throw new Error(`Algoritmo desconocido: ${huella.alg}`);
    return digerir(canonizar(contenido), huella.alg) === huella.valor;
};

module.exports = { calcularHuella, verificarHuella, formaCanonica, CANON_ACTUAL };
