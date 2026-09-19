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

        // Código único por tenant. Es opcional (fallback: obra sin código); pero si
        // viene, no puede repetirse dentro de la empresa (comparación case-insensitive).
        if (data.codigo && String(data.codigo).trim()) {
            const codigoNorm = String(data.codigo).trim().toLowerCase();
            // Sin degradar: una lista vacía por un fallo de lectura significaría
            // "el código está libre" y crearía el duplicado que esto viene a evitar.
            const existentes = await this.listByTenant(tenantId);
            const dup = (existentes || []).find(o => String(o.codigo || '').trim().toLowerCase() === codigoNorm);
            if (dup) {
                throw new Error(`Ya existe una obra con el código "${String(data.codigo).trim()}" en esta empresa.`);
            }
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
            // Flags que definen que elementos del DO aplican (DS44 Excel).
            faenaCompartida: data.faenaCompartida,
            tieneMaquinaria: data.tieneMaquinaria,
            dotacionDeclarada: data.dotacionDeclarada,
            dotacionObservacion: data.dotacionObservacion,
            agentesFQB: data.agentesFQB,
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
        // Dos pasos, y el índice solo aporta la clave.
        //
        // `obraId-index` proyecta únicamente sus claves: no hay una segunda copia
        // de cada obra viviendo en el índice. Lo que se paga es una lectura extra;
        // lo que se evita es que cada atributo nuevo de una obra aparezca
        // duplicado sin que nadie lo decida. Mismo patrón que en personas, y por
        // la misma razón: **cada índice proyecta sus propias claves, no las de
        // los demás**, así que de acá sale `PK`/`SK` y la ficha se lee de la tabla.
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'obraId-index',
            KeyConditionExpression: 'obraId = :obraId',
            ExpressionAttributeValues: { ':obraId': obraId },
            Limit: 1
        }));
        const clave = (result.Items || [])[0];
        if (!clave) return null;

        const item = await this.itemDesdeClave(clave);
        return item ? Obra.fromDynamoItem(item) : null;
    }

    /**
     * Resuelve el elemento completo de la tabla a partir de lo que devuelve un
     * índice. Público porque hay llamadores que necesitan el elemento crudo y no
     * el modelo.
     */
    async itemDesdeClave(clave) {
        if (!clave?.PK || !clave?.SK) return null;
        const { GetCommand } = require('@aws-sdk/lib-dynamodb');
        const res = await this.dynamo.send(new GetCommand({
            TableName: this.table,
            Key: { PK: clave.PK, SK: clave.SK }
        }));
        return res.Item || null;
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
        // Código único por tenant al editar (excluyendo la propia obra). Opcional.
        if (updates.codigo !== undefined && String(updates.codigo).trim()) {
            const codigoNorm = String(updates.codigo).trim().toLowerCase();
            // Misma razón que al crear: acá el valor neutro afirma algo falso.
            const existentes = await this.listByTenant(tenantId);
            const dup = (existentes || []).find(o => o.obraId !== obraId && String(o.codigo || '').trim().toLowerCase() === codigoNorm);
            if (dup) {
                throw new Error(`Ya existe una obra con el código "${String(updates.codigo).trim()}" en esta empresa.`);
            }
        }

        const allowedFields = ['nombre', 'codigo', 'direccion', 'comuna',
            'region', 'mandante', 'estado', 'etapaConstructivaActual', 'etapaActual',
            'faenaCompartida', 'tieneMaquinaria', 'agentesFQB', 'dotacionDeclarada', 'dotacionObservacion',
            'fasesConfig', 'faseDeming', 'cumplimientoDS44', 'imagenKey',
            'plantillasOnboarding', 'aplicabilidadKit'];

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

        // Marcar etapa constructiva actual como completada (informativo, no DS44)
        const fasesConfig = { ...obra.fasesConfig };
        if (fasesConfig[obra.etapaConstructivaActual]) {
            fasesConfig[obra.etapaConstructivaActual].completada = true;
        }

        return this.actualizar(tenantId, obraId, {
            etapaConstructivaActual: faseSiguiente,
            fasesConfig
        });
    }
}

module.exports = { ObraService };
