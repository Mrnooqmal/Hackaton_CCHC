/**
 * Lectura de los incidentes de una empresa, sin el repositorio completo.
 *
 * Quien solo necesita LEER los casos (el panel de completitud del FUF, por ejemplo) no
 * debe construir un `IncidentsRepository`: ese crea además los clientes de S3 y SNS y lee
 * el entorno de seis tablas. Esta es la lectura paginada que el repositorio también usa,
 * así que los dos leen los casos de la misma manera.
 */

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { conMedidasNumeradas, conVistoPor } = require('./casos-servidor');

/** Un elemento tal como se lee: medidas antiguas numeradas y `viewedBy` siempre como lista. */
const leido = (item) => conVistoPor(conMedidasNumeradas(item));

/**
 * TODOS los casos de una empresa, por el índice `tenantId-fecha-index`. Pagina: una
 * consulta de DynamoDB devuelve hasta 1 MB y avisa con `LastEvaluatedKey` que hay más.
 * Lanza si la lectura falla: quien llama decide si degrada.
 *
 * @param {{ send: Function }} dynamo cliente de documentos de DynamoDB
 * @param {string} tabla nombre de la tabla de incidentes
 */
async function casosDeLaEmpresa(dynamo, tabla, tenantId) {
    const items = [];
    let desde;
    do {
        const result = await dynamo.send(new QueryCommand({
            TableName: tabla,
            IndexName: 'tenantId-fecha-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            ExpressionAttributeValues: { ':tenantId': tenantId },
            ...(desde ? { ExclusiveStartKey: desde } : {})
        }));
        items.push(...(result.Items || []).map(leido));
        desde = result.LastEvaluatedKey;
    } while (desde);
    return items;
}

module.exports = { leido, casosDeLaEmpresa };
