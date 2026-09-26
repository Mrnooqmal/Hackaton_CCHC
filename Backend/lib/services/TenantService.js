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
const cifradoCampo = require('../cifradoCampo');

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
        const validation = validateRequired(data, ['nombre', 'rutEmpresa']);
        if (!validation.valid) {
            throw new Error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        // La empresa parte con tamaño 1: solo se cuenta al administrador. Cada
        // trabajador que se registre (manual o carga masiva) incrementa el conteo
        // de forma automática. No se solicita un número manual al crear la empresa.
        const cantidadTrabajadores = 1;

        // Verificar unicidad del nombre (via slug)
        const slug = this._generarSlug(data.nombre);
        const existenteSlug = await this.getBySlug(slug);
        if (existenteSlug) {
            throw new Error(`Ya existe una empresa con el nombre "${data.nombre}"`);
        }

        // Verificar unicidad del RUT
        const existenteRut = await this.getByRutEmpresa(data.rutEmpresa);
        if (existenteRut) {
            throw new Error(`Ya existe una empresa registrada con el RUT ${data.rutEmpresa}`);
        }

        const tenantId = uuidv4();

        // Cifrado de sobre por-registro (D-10): a diferencia del RUT de
        // personas, no hay un "listar todas las empresas" en un camino
        // caliente que justifique una llave compartida — `listAll()` la usa
        // un job programado, no una pantalla.
        const [rutEmpresaHmac, rutEmpresaCifrado] = await Promise.all([
            cifradoCampo.hmacRut(data.rutEmpresa),
            cifradoCampo.cifrarSobre(data.rutEmpresa),
        ]);

        const tenant = new Tenant({
            tenantId,
            slug,
            nombre: data.nombre,
            rutEmpresa: data.rutEmpresa,
            rutEmpresaHmac,
            rutEmpresaCifrado,
            cantidadTrabajadores,
            settings: data.settings,
            reglas: data.reglas,
            preferencias: data.preferencias,
            roles: data.roles
        });

        await this.dynamo.send(new PutCommand({
            TableName: this.table,
            Item: tenant.toDynamoItem()
        }));

        return tenant;
    }

    /**
     * Descifra el RUT de empresa de un `Tenant` ya construido, o lo deja tal
     * cual si es una ficha vieja sin migrar (todavía en claro).
     */
    async _hidratar(tenant) {
        if (!tenant || !tenant._rutEmpresaCifrado || tenant.rutEmpresa) return tenant;
        tenant.rutEmpresa = await cifradoCampo.descifrarSobre(tenant._rutEmpresaCifrado);
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
        return this._hidratar(Tenant.fromDynamoItem(result.Item));
    }

    /**
     * Obtener tenant por slug (via GSI)
     */
    async getBySlug(slug) {
        // El índice proyecta solo sus claves: devuelve dónde está la empresa, no
        // la empresa. Sus tres usos son comprobaciones de unicidad al dar de alta
        // —"¿ya existe una empresa con este nombre?"—, así que la lectura de la
        // ficha ocurre pocas veces al año.
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'slug-index',
            KeyConditionExpression: 'slug = :slug',
            ExpressionAttributeValues: { ':slug': slug },
            Limit: 1
        }));
        const clave = (result.Items || [])[0];
        if (!clave?.PK || !clave?.SK) return null;

        const { GetCommand } = require('@aws-sdk/lib-dynamodb');
        const res = await this.dynamo.send(new GetCommand({
            TableName: this.table,
            Key: { PK: clave.PK, SK: clave.SK }
        }));
        return this._hidratar(res.Item ? Tenant.fromDynamoItem(res.Item) : null);
    }

    /**
     * Actualizar configuración del tenant
     */
    async updateConfig(tenantId, updates) {
        const allowedFields = ['nombre', 'cantidadTrabajadores', 'settings',
            'reglas', 'preferencias', 'roles', 'estado', 'adminPersonaId'];

        // Normalizar roles a { id, nombre, descripcion } antes de persistir
        if (Array.isArray(updates.roles)) {
            updates = { ...updates, roles: updates.roles.map(Tenant.normalizarRol) };
        }

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

        return this._hidratar(Tenant.fromDynamoItem(result.Attributes));
    }

    /**
     * Enciende o apaga la Ficha Básica de Salud, y deja constancia.
     *
     * Recolectar datos de salud de todo el plantel es una decisión que la
     * empresa tiene que poder demostrar que tomó: quién, cuándo, y en qué
     * sentido. Por eso esto no pasa por `updateConfig`:
     *
     *   - quién y cuándo vienen de quien llama (el handler los saca de la
     *     sesión), nunca del cuerpo de la petición;
     *   - el evento se AGREGA al historial con `list_append` en la misma
     *     escritura que cambia el estado, así que no hay una ventana en que
     *     cambie el estado sin quedar registrado, ni una carrera que pise un
     *     evento ajeno;
     *   - pedir el estado que ya tiene no escribe nada: el historial registra
     *     decisiones, no clics repetidos. Apagar una ficha que nunca se
     *     encendió tampoco (el estado inicial ya es "apagada").
     *
     * Apagarla no borra la encuesta ni sus respuestas: solo deja de crearse y
     * de sincronizar el plantel. Borrar datos de salud es una decisión de
     * retención aparte.
     *
     * @returns {Promise<{ tenant: Tenant|null, cambio: boolean }>}
     */
    async cambiarFichaSalud(tenantId, habilitada, { personaId, nombre }) {
        if (typeof habilitada !== 'boolean') throw new Error('habilitada debe ser true o false');
        if (!personaId) throw new Error('Se requiere la persona que toma la decisión');

        const now = new Date().toISOString();
        const key = { PK: `TENANT#${tenantId}`, SK: `METADATA#${tenantId}` };
        const evento = { habilitada, personaId, nombre: nombre || null, en: now };

        try {
            const result = await this.dynamo.send(new UpdateCommand({
                TableName: this.table,
                Key: key,
                UpdateExpression: 'SET fichaSaludHabilitada = :h, updatedAt = :u, '
                    + 'fichaSaludHistorial = list_append(if_not_exists(fichaSaludHistorial, :vacio), :evento)',
                ConditionExpression: habilitada
                    ? 'attribute_exists(PK) AND (attribute_not_exists(fichaSaludHabilitada) OR fichaSaludHabilitada = :no)'
                    : 'attribute_exists(PK) AND fichaSaludHabilitada = :si',
                ExpressionAttributeValues: {
                    ':h': habilitada,
                    ':u': now,
                    ':vacio': [],
                    ':evento': [evento],
                    ...(habilitada ? { ':no': false } : { ':si': true }),
                },
                ReturnValues: 'ALL_NEW',
            }));
            return { tenant: await this._hidratar(Tenant.fromDynamoItem(result.Attributes)), cambio: true };
        } catch (err) {
            if (err.name !== 'ConditionalCheckFailedException') throw err;
            // O ya estaba en ese estado, o la empresa no existe: se distingue.
            return { tenant: await this.getById(tenantId), cambio: false };
        }
    }

    /**
     * ¿La empresa encendió la Ficha Básica de Salud?
     *
     * Lectura de un solo atributo, a propósito: `getById` descifra el RUT de la
     * empresa (una llamada a KMS), y esto se consulta cada vez que alguien abre
     * Encuestas.
     */
    async fichaSaludHabilitada(tenantId) {
        const result = await this.dynamo.send(new GetCommand({
            TableName: this.table,
            Key: { PK: `TENANT#${tenantId}`, SK: `METADATA#${tenantId}` },
            ProjectionExpression: 'fichaSaludHabilitada',
        }));
        return result.Item?.fichaSaludHabilitada === true;
    }

    /**
     * Activar tenant (cambiar estado de setup a activo)
     */
    async activar(tenantId) {
        return this.updateConfig(tenantId, { estado: 'activo' });
    }

    /**
     * Ajusta de forma atómica la cantidad de trabajadores del tenant (delta puede
     * ser positivo al registrar personas o negativo al desvincularlas) y recalcula
     * el tamaño de la empresa. Se usa ADD para evitar condiciones de carrera en la
     * carga masiva. El conteo nunca baja de 1 (el administrador siempre cuenta).
     */
    async ajustarCantidadTrabajadores(tenantId, delta) {
        if (!delta) return null;

        const now = new Date().toISOString();
        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `METADATA#${tenantId}`
            },
            UpdateExpression: 'ADD cantidadTrabajadores :delta SET updatedAt = :updatedAt',
            ExpressionAttributeValues: { ':delta': delta, ':updatedAt': now },
            ReturnValues: 'ALL_NEW'
        }));

        let cantidad = result.Attributes?.cantidadTrabajadores ?? 0;

        // Piso de seguridad: nunca menos de 1 (el administrador siempre cuenta).
        if (cantidad < 1) {
            cantidad = 1;
            await this.dynamo.send(new UpdateCommand({
                TableName: this.table,
                Key: { PK: `TENANT#${tenantId}`, SK: `METADATA#${tenantId}` },
                UpdateExpression: 'SET cantidadTrabajadores = :c',
                ExpressionAttributeValues: { ':c': cantidad }
            }));
        }

        // Recalcular el tamaño si cambió de tramo (micro/pequeña/mediana/grande).
        const tamano = Tenant.calcularTamano(cantidad);
        if (tamano !== result.Attributes?.tamano) {
            await this.dynamo.send(new UpdateCommand({
                TableName: this.table,
                Key: { PK: `TENANT#${tenantId}`, SK: `METADATA#${tenantId}` },
                UpdateExpression: 'SET #tamano = :tamano',
                ExpressionAttributeNames: { '#tamano': 'tamano' },
                ExpressionAttributeValues: { ':tamano': tamano }
            }));
        }

        return cantidad;
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
        return Promise.all((result.Items || []).map(item => this._hidratar(Tenant.fromDynamoItem(item))));
    }

    /**
     * `listByEstado` se eliminó el 19 de septiembre de 2026, junto con el índice
     * `status-index` en que se apoyaba.
     *
     * No tenía un solo llamador. Era el resto de cuando `GET /tenants` listaba la
     * plataforma entera, que ya se cerró: mantener el índice era conservar una
     * copia completa de todas las empresas —con sus roles, su configuración y su
     * identificación tributaria— para una consulta que nadie hace.
     */

    /**
     * Buscar tenant por RUT de empresa.
     *
     * Antes era un `Scan` de la tabla entera comparando en memoria — cada alta
     * de empresa recorría TODAS las empresas del sistema para comprobar que el
     * RUT no estuviera repetido. Con D-10 el RUT queda buscable por HMAC
     * (`rutEmpresaHmac-index`), así que esto pasa a ser una consulta indexada:
     * más barato, y de paso dejó de haber una razón para leer cada empresa
     * completa —roles, configuración, RUT de las demás— solo para dar de alta
     * una nueva.
     */
    async getByRutEmpresa(rutEmpresa) {
        const rutHmac = await cifradoCampo.hmacRut(rutEmpresa);
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'rutEmpresaHmac-index',
            KeyConditionExpression: 'rutEmpresaHmac = :h',
            ExpressionAttributeValues: { ':h': rutHmac },
            Limit: 1
        }));
        const clave = (result.Items || [])[0];
        if (!clave?.PK || !clave?.SK) return null;

        const res = await this.dynamo.send(new GetCommand({
            TableName: this.table,
            Key: { PK: clave.PK, SK: clave.SK }
        }));
        return this._hidratar(res.Item ? Tenant.fromDynamoItem(res.Item) : null);
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
