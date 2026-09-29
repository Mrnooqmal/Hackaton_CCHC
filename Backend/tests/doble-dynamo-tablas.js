// Doble de DynamoDB en memoria, con los esquemas REALES de `serverless.yml`.
//
// Lee de ahí la clave primaria y las claves de cada índice de cada tabla, y
// rechaza lo mismo que rechaza DynamoDB al escribir: una clave de índice
// presente que no sea texto no vacío. Existe porque `crear` escribía
// `email: ''`, `email` es la clave de `email-index`, y ninguna prueba lo vio:
// los dobles aceptaban cualquier ítem. Resultado: no se podía crear a nadie sin
// correo, que es media obra en terreno.
//
// Condiciones y actualizaciones se evalúan con `expresiones-dynamo.js`. Las
// consultas soportan `a = :v` y `begins_with(a, :v)` unidos por AND, sobre la
// tabla o sobre un índice (que es disperso: el ítem sin la clave no aparece).
//
// Proyecciones: solo con `{ proyecciones: true }`. Sin la opción, consultar un
// índice devuelve el ítem completo, y así pasó inadvertido que el listado de
// encuestas leía `recipients` y `preguntas` de `tenantId-index`, que no los
// proyecta. Es opcional para no cambiar lo que ven las pruebas que ya lo usan.

const fs = require('fs');
const path = require('path');
const { cumple, aplicar } = require('./expresiones-dynamo');

/** Esquemas por nombre de variable de entorno: { PERSONAS_TABLE: { clave: [...], indices: { 'email-index': [...] } } } */
function leerEsquemas() {
    const yml = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');
    const esquemas = {};
    const recursos = yml.split(/\n    \w+:\n      Type: /).slice(1);
    for (const r of recursos) {
        if (!r.startsWith('AWS::DynamoDB::Table')) continue;
        const env = /TableName: \$\{self:provider\.environment\.(\w+)\}/.exec(r)?.[1];
        if (!env) continue;
        const [principal, resto = ''] = r.split(/GlobalSecondaryIndexes:/);
        const claves = (txt) => [...txt.matchAll(/AttributeName: (\w+)\s+KeyType: (HASH|RANGE)/g)].map((m) => m[1]);
        const indices = {};
        const proyecciones = {};
        for (const m of resto.matchAll(/IndexName: ([\w-]+)\s+KeySchema:((?:\s+- AttributeName: \w+\s+KeyType: \w+)+)/g)) {
            indices[m[1]] = claves(m[2]);
            // El bloque del índice llega hasta el siguiente `- IndexName` o hasta
            // la siguiente propiedad de la tabla (sangría de 8).
            const bloque = resto.slice(m.index).split(/\n\s+- IndexName: |\n        \w+:/)[0];
            const tipo = /ProjectionType: (\w+)/.exec(bloque)?.[1] || 'ALL';
            const incluidos = tipo === 'INCLUDE'
                ? [...(/NonKeyAttributes:((?:\s+(?:#[^\n]*|- \w+))+)/.exec(bloque)?.[1] || '').matchAll(/- (\w+)/g)].map((x) => x[1])
                : [];
            proyecciones[m[1]] = { tipo, incluidos };
        }
        esquemas[env] = {
            clave: claves(principal.split(/\n        \w+:/).find((b) => b.includes('KeyType')) || principal),
            indices,
            proyecciones,
        };
    }
    return esquemas;
}

const errorValidacion = (msg) => Object.assign(new Error(`One or more parameter values were invalid: ${msg}`), { name: 'ValidationException' });
const condicionFallida = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });

/**
 * Instala el doble sobre `docClient.send`. Fija `process.env.X_TABLE = 'X_TABLE'`
 * para cada tabla conocida (llámese ANTES de cargar los servicios, que leen el
 * nombre de la tabla al importarse).
 */
function prepararEntorno() {
    const esquemas = leerEsquemas();
    for (const env of Object.keys(esquemas)) process.env[env] = env;
    return esquemas;
}

function crearDobleTablas(docClient, esquemas, { proyecciones = false } = {}) {
    const tablas = Object.fromEntries(Object.keys(esquemas).map((t) => [t, new Map()]));
    const escrituras = [];
    const original = docClient.send;

    const esquemaDe = (tabla) => {
        const e = esquemas[tabla];
        if (!e) throw new Error(`doble-dynamo-tablas: tabla desconocida ${tabla}`);
        return e;
    };
    const idDe = (tabla, item) => JSON.stringify(esquemaDe(tabla).clave.map((k) => item[k]));

    /** Lo que DynamoDB valida de un ítem que se va a guardar. */
    const validarItem = (tabla, item) => {
        const { clave, indices } = esquemaDe(tabla);
        for (const k of clave) {
            if (typeof item[k] !== 'string' || item[k] === '') throw errorValidacion(`clave primaria ${k} vacía o de otro tipo`);
        }
        for (const [nombre, ks] of Object.entries(indices)) {
            for (const k of ks) {
                if (!(k in item)) continue;   // índice disperso: sin la clave, fuera del índice
                if (item[k] === '') throw errorValidacion(`The AttributeValue for a key attribute cannot contain an empty string value. IndexName: ${nombre}, IndexKey: ${k}`);
                if (typeof item[k] !== 'string') throw errorValidacion(`Type mismatch for Index Key ${k} Expected: S Actual: ${item[k] === null ? 'NULL' : typeof item[k]} IndexName: ${nombre}`);
            }
        }
    };
    // El cliente real omite `undefined` (removeUndefinedValues).
    const sinIndefinidos = (item) => JSON.parse(JSON.stringify(item));

    const consultar = (tabla, input) => {
        const { indices, clave } = esquemaDe(tabla);
        const ks = input.IndexName ? indices[input.IndexName] : clave;
        if (!ks) throw errorValidacion(`índice ${input.IndexName} no existe en ${tabla}`);
        const nombres = input.ExpressionAttributeNames || {};
        const valores = input.ExpressionAttributeValues || {};
        const partes = input.KeyConditionExpression.split(/\s+AND\s+/i).map((p) => {
            let m = /^\s*([#\w]+)\s*=\s*(:\w+)\s*$/.exec(p);
            if (m) return (it) => it[nombres[m[1]] || m[1]] === valores[m[2]];
            m = /^\s*begins_with\(\s*([#\w]+)\s*,\s*(:\w+)\s*\)\s*$/.exec(p);
            if (m) return (it) => typeof it[nombres[m[1]] || m[1]] === 'string' && it[nombres[m[1]] || m[1]].startsWith(valores[m[2]]);
            throw new Error(`doble-dynamo-tablas: condición de clave no soportada: ${p}`);
        });
        return [...tablas[tabla].values()]
            .filter((it) => ks.every((k) => typeof it[k] === 'string'))
            .filter((it) => partes.every((f) => f(it)))
            .filter((it) => !input.FilterExpression || cumple(it, input.FilterExpression, valores, nombres))
            .map((it) => proyectar(tabla, input.IndexName, structuredClone(it)));
    };

    /** Lo que DynamoDB devuelve de un índice: sus claves, las de la tabla y lo incluido. */
    const proyectar = (tabla, indice, item) => {
        if (!proyecciones || !indice) return item;
        const { clave, indices, proyecciones: p } = esquemaDe(tabla);
        const { tipo, incluidos } = p[indice] || { tipo: 'ALL', incluidos: [] };
        if (tipo === 'ALL') return item;
        const permitidos = new Set([...clave, ...indices[indice], ...(tipo === 'INCLUDE' ? incluidos : [])]);
        return Object.fromEntries(Object.entries(item).filter(([k]) => permitidos.has(k)));
    };

    docClient.send = async function simulado(cmd) {
        const nombre = cmd.constructor.name;
        const i = cmd.input || {};
        const t = i.TableName;
        switch (nombre) {
            case 'PutCommand': {
                const item = sinIndefinidos(i.Item);
                validarItem(t, item);
                const previo = tablas[t].get(idDe(t, item)) || null;
                if (!cumple(previo, i.ConditionExpression, i.ExpressionAttributeValues, i.ExpressionAttributeNames)) throw condicionFallida();
                tablas[t].set(idDe(t, item), item);
                escrituras.push({ nombre, tabla: t, item });
                return {};
            }
            case 'GetCommand': {
                const it = tablas[t].get(idDe(t, i.Key));
                return { Item: it ? structuredClone(it) : undefined };
            }
            case 'UpdateCommand': {
                const previo = tablas[t].get(idDe(t, i.Key)) || null;
                if (!cumple(previo, i.ConditionExpression, i.ExpressionAttributeValues, i.ExpressionAttributeNames)) throw condicionFallida();
                const nuevo = sinIndefinidos(aplicar(previo || { ...i.Key }, i.UpdateExpression, i.ExpressionAttributeValues, i.ExpressionAttributeNames));
                validarItem(t, nuevo);
                tablas[t].set(idDe(t, nuevo), nuevo);
                escrituras.push({ nombre, tabla: t, item: nuevo, expresion: i.UpdateExpression });
                return { Attributes: structuredClone(nuevo) };
            }
            case 'DeleteCommand':
                tablas[t].delete(idDe(t, i.Key));
                return {};
            case 'QueryCommand':
                return { Items: consultar(t, i) };
            case 'ScanCommand': {
                const v = i.ExpressionAttributeValues || {};
                const items = [...tablas[t].values()].filter((it) => !i.FilterExpression || cumple(it, i.FilterExpression, v, i.ExpressionAttributeNames));
                return { Items: items.map((it) => structuredClone(it)) };
            }
            case 'BatchGetCommand': {
                const Responses = {};
                for (const [tabla, { Keys }] of Object.entries(i.RequestItems)) {
                    Responses[tabla] = Keys.map((k) => tablas[tabla].get(idDe(tabla, k))).filter(Boolean).map((x) => structuredClone(x));
                }
                return { Responses };
            }
            default:
                // Lo que no se simula sigue al cliente real, que `sin-aws.js` detiene.
                return original.call(docClient, cmd);
        }
    };

    return {
        tablas,
        escrituras,
        items: (env) => [...tablas[env].values()],
        restaurar: () => { docClient.send = original; },
    };
}

module.exports = { prepararEntorno, crearDobleTablas, leerEsquemas };
