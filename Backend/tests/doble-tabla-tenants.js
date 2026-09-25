// Doble de la tabla de empresas, para las pruebas que tocan llaves de datos.
//
// Había cuatro copias casi idénticas de esto repartidas en dos archivos, y las
// cuatro modelaban algo imposible: que se pudiera pedir la llave de una empresa
// que no existe. Cuando el código dejó de permitirlo, las cuatro se rompieron a
// la vez. Una sola copia, fiel a lo que importa de la tabla real:
//
//   - la fila de metadata de una empresa existe solo si se la siembra;
//   - la llave se crea con `attribute_exists(PK)`, así que en una empresa que no
//     existe la escritura falla, igual que en DynamoDB;
//   - y con `attribute_not_exists(<atributo>)`, así que dos altas simultáneas no
//     producen dos llaves.

const esMetadata = (key) =>
    String(key?.PK || '').startsWith('TENANT#') && String(key?.SK || '').startsWith('METADATA#');

const claveDe = (key) => `${key.PK}#${key.SK}`;

const condicionFallida = () =>
    Object.assign(new Error('condición'), { name: 'ConditionalCheckFailedException' });

/**
 * @param {string[]} empresas - tenantIds que ya existen al empezar
 * @returns {{ filas: Map, escrituras: object[], sembrar: Function, responder: Function }}
 *   `responder(cmd)` devuelve la respuesta si el comando es de la tabla de
 *   empresas, o `undefined` para que quien llama siga con su propio doble.
 */
const crearTablaTenants = (empresas = []) => {
    const filas = new Map();
    const escrituras = [];

    const sembrar = (...ids) => {
        for (const id of ids) {
            const key = { PK: `TENANT#${id}`, SK: `METADATA#${id}` };
            if (!filas.has(claveDe(key))) filas.set(claveDe(key), { ...key, tenantId: id });
        }
    };
    sembrar(...empresas);

    const responder = (cmd) => {
        const input = cmd.input || {};
        if (!esMetadata(input.Key)) return undefined;

        const nombre = cmd.constructor.name;
        const actual = filas.get(claveDe(input.Key));

        if (nombre === 'GetCommand') return { Item: actual };

        if (nombre === 'UpdateCommand') {
            escrituras.push(input);
            const atributo = /SET\s+(\w+)\s*=/.exec(input.UpdateExpression || '')?.[1];
            const condicion = input.ConditionExpression || '';
            if (condicion.includes('attribute_exists(PK)') && !actual) throw condicionFallida();
            if (atributo && condicion.includes(`attribute_not_exists(${atributo})`) && actual?.[atributo]) {
                throw condicionFallida();
            }
            const valores = input.ExpressionAttributeValues || {};
            filas.set(claveDe(input.Key), { ...(actual || input.Key), [atributo]: valores[':envuelta'] });
            return {};
        }

        return undefined;
    };

    return { filas, escrituras, sembrar, responder };
};

module.exports = { crearTablaTenants };
