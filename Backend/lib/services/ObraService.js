/**
 * ObraService
 * 
 * Gestión de obras/proyectos de construcción dentro de un tenant.
 * Incluye control de fases y documentos obligatorios por DS 44.
 */

const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../dynamodb');
const { Obra } = require('../models/Obra');
const { validateRequired } = require('../validation');

const OBRAS_TABLE = process.env.OBRAS_TABLE || 'Obras';

class ObraService {
    constructor() {
        this.dynamo = docClient;
        this.table = OBRAS_TABLE;
    }

    /**
     * Crear una nueva obra para un tenant
     */
    async crear(tenantId, data) {
        const validation = validateRequired(data, ['nombre']);
        if (!validation.valid) {
            throw new Error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const obraId = uuidv4();
        const obra = new Obra({
            obraId,
            tenantId,
            nombre: data.nombre,
            codigo: data.codigo,
            direccion: data.direccion,
            comuna: data.comuna,
            region: data.region,
            mandante: data.mandante,
            fasesObligatorias: data.fasesObligatorias
        });

        await this.dynamo.send(new PutCommand({
            TableName: this.table,
            Item: obra.toDynamoItem()
        }));

        return obra;
    }

    /**
     * Obtener obra por ID (via GSI directo)
     */
    async getById(obraId) {
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'obraId-index',
            KeyConditionExpression: 'obraId = :obraId',
            ExpressionAttributeValues: { ':obraId': obraId }
        }));
        if (!result.Items || result.Items.length === 0) return null;
        return Obra.fromDynamoItem(result.Items[0]);
    }

    /**
     * Listar obras de un tenant (via PK)
     */
    async listByTenant(tenantId) {
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: {
                ':pk': `TENANT#${tenantId}`,
                ':prefix': 'OBRA#'
            }
        }));
        return (result.Items || []).map(item => Obra.fromDynamoItem(item));
    }

    /**
     * Actualizar obra
     */
    async actualizar(tenantId, obraId, updates) {
        const allowedFields = ['nombre', 'codigo', 'direccion', 'comuna',
            'region', 'mandante', 'estado', 'etapaActual', 'fasesConfig'];

        const updateExpressions = [];
        const expressionNames = {};
        const expressionValues = {};

        allowedFields.forEach(field => {
            if (updates[field] !== undefined) {
                updateExpressions.push(`#${field} = :${field}`);
                expressionNames[`#${field}`] = field;
                expressionValues[`:${field}`] = updates[field];
            }
        });

        if (updateExpressions.length === 0) {
            throw new Error('No hay campos para actualizar');
        }

        updateExpressions.push('#updatedAt = :updatedAt');
        expressionNames['#updatedAt'] = 'updatedAt';
        expressionValues[':updatedAt'] = new Date().toISOString();

        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `OBRA#${obraId}`
            },
            UpdateExpression: `SET ${updateExpressions.join(', ')}`,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues,
            ReturnValues: 'ALL_NEW'
        }));

        return Obra.fromDynamoItem(result.Attributes);
    }

    /**
     * Avanzar a la siguiente fase de la obra
     */
    async avanzarFase(tenantId, obraId) {
        const obra = await this.getById(obraId);
        if (!obra) throw new Error('Obra no encontrada');

        const faseSiguiente = obra.getFaseSiguiente();
        if (!faseSiguiente) throw new Error('La obra ya está en la última fase');

        // Marcar fase actual como completada
        const fasesConfig = { ...obra.fasesConfig };
        fasesConfig[obra.etapaActual].completada = true;

        return this.actualizar(tenantId, obraId, {
            etapaActual: faseSiguiente,
            fasesConfig
        });
    }
}

module.exports = { ObraService };
