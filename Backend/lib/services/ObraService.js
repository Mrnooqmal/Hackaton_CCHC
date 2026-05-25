/**
 * ObraService
 * 
 * Gestión de obras/proyectos de construcción dentro de un tenant.
 * Incluye control de fases y documentos obligatorios por DS 44.
 */

const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { Obra } = require('../models/Obra');
const { PersonaService } = require('./PersonaService');
const { validateRequired } = require('../utils/validation');

const OBRAS_TABLE = process.env.OBRAS_TABLE || 'Obras';

class ObraService {
    constructor() {
        this.dynamo = docClient;
        this.table = OBRAS_TABLE;
        this.personaService = new PersonaService();
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
            imagenKey: data.imagenKey,
            fasesObligatorias: data.fasesObligatorias
        });

        await this.dynamo.send(new PutCommand({
            TableName: this.table,
            Item: obra.toDynamoItem()
        }));

        // Asignar obra a personas seleccionadas (si corresponde)
        if (Array.isArray(data.trabajadoresAprobados) && data.trabajadoresAprobados.length > 0) {
            for (const personaId of data.trabajadoresAprobados) {
                try {
                    const persona = await this.personaService.getById(personaId);
                    if (!persona) continue;
                    const obraIds = Array.isArray(persona.obraIds) ? persona.obraIds : [];
                    if (!obraIds.includes(obraId)) {
                        await this.personaService.actualizar(tenantId, personaId, {
                            obraIds: [...obraIds, obraId]
                        });
                    }
                } catch (assignErr) {
                    console.error('Error asignando obra a persona:', personaId, assignErr);
                }
            }
        }

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
            'region', 'mandante', 'estado', 'etapaActual', 'fasesConfig', 'faseDeming', 'cumplimientoDS44', 'imagenKey'];

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
     * Avanzar a la fase HACER del ciclo Deming (DS44)
     * Se activa cuando la Fase PLAN está completa.
     * Persiste cumplimientoDS44.plan.completado = true con timestamp.
     */
    async avanzarFaseDeming(tenantId, obraId) {
        const obra = await this.getById(obraId);
        if (!obra) throw new Error('Obra no encontrada');

        const ORDEN_DEMING = ['plan', 'hacer', 'verificar', 'actuar'];
        const idxActual = ORDEN_DEMING.indexOf(obra.faseDeming || 'plan');
        if (idxActual === -1 || idxActual >= ORDEN_DEMING.length - 1) {
            throw new Error('La obra ya está en la última fase Deming');
        }

        const faseSiguiente = ORDEN_DEMING[idxActual + 1];
        const now = new Date().toISOString();

        // Si estamos avanzando de PLAN → HACER, marcar plan como completado con timestamp
        const updates = { faseDeming: faseSiguiente };
        if (obra.faseDeming === 'plan') {
            const cumplimiento = obra.cumplimientoDS44 || {};
            updates.cumplimientoDS44 = {
                ...cumplimiento,
                plan: {
                    ...(cumplimiento.plan || {}),
                    completado: true,
                    fechaCompletado: now
                }
            };
        }

        return this.actualizar(tenantId, obraId, updates);
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
