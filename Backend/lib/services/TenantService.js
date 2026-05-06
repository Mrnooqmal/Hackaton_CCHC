/**
 * TenantService
 * 
 * Gestión de empresas/tenants del SaaS.
 * Setup, configuración, y operaciones administrativas.
 */

const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { Tenant } = require('../models/Tenant');
const { validateRequired } = require('../utils/validation');

const TENANTS_TABLE = process.env.TENANTS_TABLE || 'Tenants';

class TenantService {
    constructor() {
        this.dynamo = docClient;
        this.table = TENANTS_TABLE;
    }

    /**
     * Setup inicial de un nuevo tenant
     */
    async setup(data) {
        const validation = validateRequired(data, ['nombre', 'rutEmpresa', 'cantidadTrabajadores']);
        if (!validation.valid) {
            throw new Error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        // Verificar unicidad del slug
        const slug = this._generarSlug(data.nombre);
        const existente = await this.getBySlug(slug);
        if (existente) {
            throw new Error(`Ya existe un tenant con el slug: ${slug}`);
        }

        const tenantId = uuidv4();
        const tenant = new Tenant({
            tenantId,
            slug,
            nombre: data.nombre,
            rutEmpresa: data.rutEmpresa,
            email: data.email || '',
            telefono: data.telefono || '',
            plan: data.plan || 'starter',
            cantidadTrabajadores: data.cantidadTrabajadores,
            settings: data.settings,
            reglas: data.reglas,
            preferencias: data.preferencias
        });

        await this.dynamo.send(new PutCommand({
            TableName: this.table,
            Item: tenant.toDynamoItem()
        }));

        return tenant;
    }

    /**
     * Obtener tenant por ID
     */
    async getById(tenantId) {
        const result = await this.dynamo.send(new GetCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `METADATA#${tenantId}`
            }
        }));
        return Tenant.fromDynamoItem(result.Item);
    }

    /**
     * Obtener tenant por slug (via GSI)
     */
    async getBySlug(slug) {
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'slug-index',
            KeyConditionExpression: 'slug = :slug',
            ExpressionAttributeValues: { ':slug': slug }
        }));
        if (!result.Items || result.Items.length === 0) return null;
        return Tenant.fromDynamoItem(result.Items[0]);
    }

    /**
     * Actualizar configuración del tenant
     */
    async updateConfig(tenantId, updates) {
        const allowedFields = ['nombre', 'email', 'telefono', 'plan',
            'cantidadTrabajadores', 'settings', 'reglas', 'preferencias',
            'estado', 'adminPersonaId'];

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

        // Recalcular tamaño si cambió cantidadTrabajadores
        if (updates.cantidadTrabajadores !== undefined) {
            updateExpressions.push('#tamano = :tamano');
            expressionNames['#tamano'] = 'tamano';
            expressionValues[':tamano'] = Tenant.calcularTamano(updates.cantidadTrabajadores);
        }

        updateExpressions.push('#updatedAt = :updatedAt');
        expressionNames['#updatedAt'] = 'updatedAt';
        expressionValues[':updatedAt'] = new Date().toISOString();

        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `METADATA#${tenantId}`
            },
            UpdateExpression: `SET ${updateExpressions.join(', ')}`,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues,
            ReturnValues: 'ALL_NEW'
        }));

        return Tenant.fromDynamoItem(result.Attributes);
    }

    /**
     * Activar tenant (cambiar estado de setup a activo)
     */
    async activar(tenantId) {
        return this.updateConfig(tenantId, { estado: 'activo' });
    }

    /**
     * Listar absolutamente todos los tenants
     */
    async listAll() {
        const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
        const result = await this.dynamo.send(new ScanCommand({
            TableName: this.table,
            FilterExpression: 'begins_with(PK, :pk) AND begins_with(SK, :sk)',
            ExpressionAttributeValues: {
                ':pk': 'TENANT#',
                ':sk': 'METADATA#'
            }
        }));
        return (result.Items || []).map(item => Tenant.fromDynamoItem(item));
    }

    /**
     * Listar todos los tenants activos (solo superadmin)
     */
    async listByEstado(estado) {
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'status-index',
            KeyConditionExpression: 'estado = :estado',
            ExpressionAttributeValues: { ':estado': estado }
        }));
        return (result.Items || []).map(item => Tenant.fromDynamoItem(item));
    }

    /**
     * Genera slug URL-friendly a partir del nombre
     */
    _generarSlug(nombre) {
        return nombre
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    }
}

module.exports = { TenantService };
