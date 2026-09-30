// Evalúa condiciones y aplica actualizaciones de DynamoDB sobre un ítem en memoria.
//
// Existe porque un doble que compara la condición como texto y la resuelve con
// `!item.pinHash` dejó pasar un bug real: DynamoDB distingue un atributo AUSENTE
// de uno presente con valor NULL, y `crear` guarda `pinHash: null`. Para
// `attribute_not_exists(pinHash)` esa persona SÍ tiene el atributo, así que la
// condición falla — y el doble decía que se cumplía. Toda persona nueva quedó
// sin poder configurar su primer PIN, con las pruebas en verde.
//
// Acá "ausente" es `!(clave in objeto)` y `null` es un valor como cualquier otro,
// igual que en DynamoDB. Cubre el subconjunto de la gramática que usa el código:
// AND, OR, NOT, paréntesis, `attribute_exists`, `attribute_not_exists`,
// `begins_with`, `contains`, `=`, `<>`, rutas con punto y `#nombres`; y en actualizaciones SET (con
// `list_append` e `if_not_exists`), REMOVE y ADD. Lo que no reconoce lo rechaza
// con un error, en vez de adivinar.

const ausente = Symbol('ausente');

const trocear = (texto) => {
    const tokens = [];
    const re = /\s*(\(|\)|,|<>|<=|>=|<|>|=|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_#][A-Za-z0-9_]*)*|#[A-Za-z0-9_]+(?:\.[A-Za-z_#][A-Za-z0-9_]*)*|:[A-Za-z0-9_]+)/y;
    let m;
    let pos = 0;
    while (pos < texto.length) {
        re.lastIndex = pos;
        m = re.exec(texto);
        if (!m) {
            if (/^\s*$/.test(texto.slice(pos))) break;
            throw new Error(`expresiones-dynamo: no entiendo "${texto.slice(pos)}"`);
        }
        tokens.push(m[1]);
        pos = re.lastIndex;
    }
    return tokens;
};

const resolverRuta = (item, ruta, nombres = {}) => {
    let actual = item;
    for (const seg of ruta.split('.')) {
        const clave = seg.startsWith('#') ? nombres[seg] : seg;
        if (clave === undefined) throw new Error(`expresiones-dynamo: falta el nombre ${seg}`);
        if (actual === null || typeof actual !== 'object' || !(clave in actual)) return ausente;
        actual = actual[clave];
    }
    return actual;
};

const iguales = (a, b) => a !== ausente && b !== ausente && JSON.stringify(a) === JSON.stringify(b);

/** ¿Se cumple `condicion` sobre `item`? `item` null = el ítem no existe. */
function cumple(item, condicion, valores = {}, nombres = {}) {
    if (!condicion) return true;
    const base = item || {};
    const t = trocear(condicion);
    let i = 0;
    const ver = () => t[i];
    const tomar = (esperado) => {
        const tok = t[i++];
        if (esperado !== undefined && tok !== esperado) throw new Error(`expresiones-dynamo: esperaba ${esperado}, vino ${tok}`);
        return tok;
    };
    const operando = () => {
        const tok = tomar();
        if (tok.startsWith(':')) {
            if (!(tok in valores)) throw new Error(`expresiones-dynamo: falta el valor ${tok}`);
            return valores[tok];
        }
        return resolverRuta(base, tok, nombres);
    };
    const factor = () => {
        if (ver() === '(') { tomar('('); const v = expr(); tomar(')'); return v; }
        if (ver() === 'NOT') { tomar(); return !factor(); }
        if (ver() === 'attribute_exists' || ver() === 'attribute_not_exists') {
            const f = tomar(); tomar('(');
            const existe = resolverRuta(base, tomar(), nombres) !== ausente;
            tomar(')');
            return f === 'attribute_exists' ? existe : !existe;
        }
        if (ver() === 'begins_with' || ver() === 'contains') {
            const f = tomar(); tomar('(');
            const a = operando(); tomar(','); const b = operando(); tomar(')');
            if (a === ausente || b === ausente) return false;
            if (f === 'begins_with') return typeof a === 'string' && typeof b === 'string' && a.startsWith(b);
            // Como DynamoDB: en listas y en conjuntos (SS, NS) busca el elemento.
            if (a instanceof Set) return a.has(b);
            return Array.isArray(a) ? a.some((x) => iguales(x, b)) : (typeof a === 'string' && a.includes(b));
        }
        const izq = operando();
        const op = tomar();
        const der = operando();
        if (op === '=') return iguales(izq, der);
        if (op === '<>') return izq !== ausente && der !== ausente && !iguales(izq, der);
        if (['<', '<=', '>', '>='].includes(op)) {
            // DynamoDB compara solo valores del mismo tipo (cadenas o números).
            if (izq === ausente || der === ausente || typeof izq !== typeof der || !['string', 'number'].includes(typeof izq)) return false;
            return op === '<' ? izq < der : op === '<=' ? izq <= der : op === '>' ? izq > der : izq >= der;
        }
        throw new Error(`expresiones-dynamo: operador ${op} no soportado`);
    };
    const termino = () => { let v = factor(); while (ver() === 'AND') { tomar(); const d = factor(); v = v && d; } return v; };
    const expr = () => { let v = termino(); while (ver() === 'OR') { tomar(); const d = termino(); v = v || d; } return v; };
    const r = expr();
    if (i !== t.length) throw new Error(`expresiones-dynamo: sobra "${t.slice(i).join(' ')}"`);
    return r;
}

const partirNivelCero = (texto) => {
    const partes = [];
    let nivel = 0;
    let desde = 0;
    for (let k = 0; k < texto.length; k++) {
        if (texto[k] === '(') nivel++;
        else if (texto[k] === ')') nivel--;
        else if (texto[k] === ',' && nivel === 0) { partes.push(texto.slice(desde, k).trim()); desde = k + 1; }
    }
    partes.push(texto.slice(desde).trim());
    return partes.filter(Boolean);
};

const fijarRuta = (item, ruta, valor, nombres) => {
    const segs = ruta.split('.').map((s) => (s.startsWith('#') ? nombres[s] : s));
    let obj = item;
    for (const s of segs.slice(0, -1)) obj = obj[s];
    obj[segs[segs.length - 1]] = valor;
};
const quitarRuta = (item, ruta, nombres) => {
    const segs = ruta.split('.').map((s) => (s.startsWith('#') ? nombres[s] : s));
    let obj = item;
    for (const s of segs.slice(0, -1)) { if (!obj || typeof obj !== 'object') return; obj = obj[s]; }
    if (obj && typeof obj === 'object') delete obj[segs[segs.length - 1]];
};

/** Aplica `expresion` a una COPIA de `item` y la devuelve. */
function aplicar(item, expresion, valores = {}, nombres = {}) {
    const nuevo = structuredClone(item || {});
    const valorDe = (texto) => {
        texto = texto.trim();
        let m;
        if (texto.startsWith(':')) return structuredClone(valores[texto]);
        if ((m = /^list_append\((.*)\)$/.exec(texto))) {
            const [a, b] = partirNivelCero(m[1]).map(valorDe);
            return [...a, ...b];
        }
        if ((m = /^if_not_exists\((.*)\)$/.exec(texto))) {
            const [ruta, def] = partirNivelCero(m[1]);
            const v = resolverRuta(item || {}, ruta, nombres);
            return v === ausente ? valorDe(def) : structuredClone(v);
        }
        const v = resolverRuta(item || {}, texto, nombres);
        if (v === ausente) throw new Error(`expresiones-dynamo: ${texto} no existe`);
        return structuredClone(v);
    };
    const secciones = expresion.split(/\b(SET|REMOVE|ADD|DELETE)\b/).map((s) => s.trim()).filter(Boolean);
    for (let k = 0; k < secciones.length; k += 2) {
        const accion = secciones[k];
        const cuerpo = secciones[k + 1] || '';
        for (const parte of partirNivelCero(cuerpo)) {
            if (accion === 'SET') {
                const igual = parte.indexOf('=');
                fijarRuta(nuevo, parte.slice(0, igual).trim(), valorDe(parte.slice(igual + 1)), nombres);
            } else if (accion === 'REMOVE') {
                quitarRuta(nuevo, parte, nombres);
            } else if (accion === 'ADD') {
                const [ruta, val] = parte.split(/\s+/);
                const previo = resolverRuta(nuevo, ruta, nombres);
                if (valores[val] instanceof Set) {
                    // Conjunto: unión.
                    fijarRuta(nuevo, ruta, new Set([...(previo === ausente ? [] : previo), ...valores[val]]), nombres);
                } else {
                    fijarRuta(nuevo, ruta, (previo === ausente ? 0 : previo) + valores[val], nombres);
                }
            } else if (accion === 'DELETE') {
                // Conjunto: diferencia. DynamoDB no guarda conjuntos vacíos: si
                // queda vacío, el atributo desaparece.
                const [ruta, val] = parte.split(/\s+/);
                const previo = resolverRuta(nuevo, ruta, nombres);
                if (previo !== ausente) {
                    const resto = new Set([...previo].filter((x) => !valores[val].has(x)));
                    if (resto.size) fijarRuta(nuevo, ruta, resto, nombres); else quitarRuta(nuevo, ruta, nombres);
                }
            } else {
                throw new Error(`expresiones-dynamo: acción ${accion} no soportada`);
            }
        }
    }
    return nuevo;
}

module.exports = { cumple, aplicar };
