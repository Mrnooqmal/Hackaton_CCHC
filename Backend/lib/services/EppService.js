/**
 * EppService
 *
 * Entrega de EPP (Art. 13 DS44) con validacion por instancia superior e
 * historial dinamico por trabajador (insumo de investigaciones de accidentes).
 *
 * Decision reunion 2026-06-10: el registro de entrega NO puede ser
 * autodeclarado por el trabajador. Flujo:
 *   1. Validador (bodega/supervisor/prevencionista) crea la entrega.
 *   2. Validador confirma la capacitacion de uso (Art. 13, min 1 hora).
 *   3. Validador valida la entrega (validacion.estado = 'validado').
 *   4. Trabajador firma la recepcion con PIN (bloqueada hasta el paso 3,
 *      guard en documents sign / sign-assisted).
 *
 * El inventario de bodega queda fuera de alcance.
 */

const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, UpdateCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { eventBus } = require('../events/EventBus');
const { PERMISSIONS, personaPuede } = require('../permissions');

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'Documents';

const MOTIVOS_REPOSICION = ['desgaste', 'perdida', 'accidente', 'cambio_talla', 'otro'];

class EppService {
    /**
     * Crea una entrega (o reposicion) de EPP como documento ENTREGA_EPP
     * asignado al trabajador, pendiente de validacion y de firma.
     */
    async crearEntrega({ tenantId, obraId, persona, creador, itemsEntregados, esReposicion, motivoReposicion, capacitacion }) {
        if (!tenantId) throw new Error('tenantId es requerido');
        if (!persona) throw new Error('Trabajador no encontrado');
        if (!Array.isArray(itemsEntregados) || itemsEntregados.length === 0) {
            throw new Error('Debe indicar al menos un item entregado');
        }
        if (esReposicion && motivoReposicion && !MOTIVOS_REPOSICION.includes(motivoReposicion)) {
            throw new Error(`Motivo de reposicion invalido. Validos: ${MOTIVOS_REPOSICION.join(', ')}`);
        }

        const now = new Date().toISOString();
        const documentId = uuidv4();

        const document = {
            documentId,
            tenantId,
            obraId: obraId || null,
            clasificacion: 'diario',
            fase: 'hacer',
            tipo: 'ENTREGA_EPP',
            tipoDescripcion: 'Entrega y capacitacion de EPP (Art. 13)',
            obligatorio: true,
            titulo: esReposicion ? 'Reposicion de EPP' : 'Entrega de EPP',
            contenido: '',
            descripcion: 'Art. 13 - Entrega, registro y firma de recepcion. Requiere validacion de instancia superior.',
            relatorId: null,
            s3Key: null,
            archivoUrl: null,
            archivoNombre: null,
            fechaCaducidad: null,
            createdBy: creador?.personaId || 'system',
            creatorName: creador ? `${creador.nombre} ${creador.apellido || ''}`.trim() : 'Sistema DS44',
            firmas: [],
            asignaciones: [{
                personaId: persona.personaId,
                nombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
                rut: persona.rut,
                fechaAsignacion: now,
                fechaLimite: null,
                estado: 'pendiente',
                notificado: true
            }],
            estado: 'activo',
            version: 1,

            // Validacion obligatoria por instancia superior
            validacion: {
                requerida: true,
                validadoPor: {
                    personaId: null,
                    nombre: null,
                    cargo: null,
                    rol: null,
                    timestamp: null
                },
                estado: 'pendiente'
            },
            // [{ descripcion, cantidad, talla, fechaVencimiento }]
            itemsEntregados: itemsEntregados.map((item) => ({
                descripcion: String(item.descripcion || '').trim(),
                cantidad: Number(item.cantidad) || 1,
                talla: item.talla || null,
                fechaVencimiento: item.fechaVencimiento || null
            })),
            esReposicion: Boolean(esReposicion),
            motivoReposicion: esReposicion ? (motivoReposicion || 'otro') : null,
            // Capacitacion de uso (Art. 13, min 1 hora)
            capacitacionUso: {
                requerida: true,
                completada: Boolean(capacitacion?.completada),
                duracionRealMinutos: capacitacion?.duracionRealMinutos || null,
                timestamp: capacitacion?.completada ? now : null,
                firmaRelator: capacitacion?.relatorId || null
            },

            createdAt: now,
            updatedAt: now
        };

        await docClient.send(new PutCommand({ TableName: DOCUMENTS_TABLE, Item: document }));

        try {
            await eventBus.emit('document.assigned', {
                documentId,
                userIds: [persona.personaId],
                assignedBy: creador?.personaId || 'system',
                creatorName: document.creatorName,
                documentName: document.titulo,
                dueDate: null
            });
        } catch (eventErr) {
            console.error('Error emitting document.assigned (EPP):', eventErr);
        }

        return document;
    }

    /**
     * Valida una entrega de EPP. Solo roles de instancia superior.
     */
    async validarEntrega({ entregaDocumentId, validador, observacion, tenant }) {
        if (!entregaDocumentId) throw new Error('entregaDocumentId es requerido');
        if (!validador) throw new Error('Validador no encontrado');
        if (!personaPuede(validador, tenant, PERMISSIONS.PERSONA_EPP)) {
            throw new Error('No tienes permiso para validar entregas de EPP');
        }

        const res = await docClient.send(new GetCommand({
            TableName: DOCUMENTS_TABLE,
            Key: { documentId: entregaDocumentId }
        }));
        if (!res.Item) throw new Error('Entrega de EPP no encontrada');
        if (res.Item.tipo !== 'ENTREGA_EPP') throw new Error('El documento no es una entrega de EPP');

        const now = new Date().toISOString();
        const validacion = {
            ...(res.Item.validacion || { requerida: true }),
            validadoPor: {
                personaId: validador.personaId,
                nombre: `${validador.nombre} ${validador.apellido || ''}`.trim(),
                cargo: validador.cargo || '',
                rol: validador.rol,
                timestamp: now
            },
            estado: 'validado',
            observacion: observacion || null
        };

        const result = await docClient.send(new UpdateCommand({
            TableName: DOCUMENTS_TABLE,
            Key: { documentId: entregaDocumentId },
            UpdateExpression: 'SET validacion = :v, updatedAt = :u',
            ExpressionAttributeValues: { ':v': validacion, ':u': now },
            ReturnValues: 'ALL_NEW'
        }));

        const personaId = (res.Item.asignaciones || [])[0]?.personaId || null;
        try {
            await eventBus.emit('epp.validado', {
                personaId,
                entregaDocumentId,
                validadoPor: validador.personaId
            });
        } catch (eventErr) {
            console.error('Error emitting epp.validado:', eventErr);
        }

        return result.Attributes;
    }

    /**
     * Historial dinamico de entregas/reposiciones de EPP de una persona,
     * ordenado por fecha descendente.
     */
    async getHistorial({ tenantId, personaId }) {
        if (!personaId) throw new Error('personaId es requerido');

        // DocumentsTable no tiene GSI por persona asignada: se filtra por tipo
        // sobre el tenant. Si el volumen lo exige, evaluar GSI dedicado
        // (documentar en ARCHITECTURE.md antes de implementarlo).
        let items = [];
        try {
            const res = await docClient.send(new QueryCommand({
                TableName: DOCUMENTS_TABLE,
                IndexName: 'tenantId-index',
                KeyConditionExpression: 'tenantId = :t',
                FilterExpression: 'tipo = :tipo',
                ExpressionAttributeValues: { ':t': tenantId, ':tipo': 'ENTREGA_EPP' }
            }));
            items = res.Items || [];
        } catch (err) {
            const res = await docClient.send(new ScanCommand({
                TableName: DOCUMENTS_TABLE,
                FilterExpression: 'tenantId = :t AND tipo = :tipo',
                ExpressionAttributeValues: { ':t': tenantId, ':tipo': 'ENTREGA_EPP' }
            }));
            items = res.Items || [];
        }

        const entregas = items
            .filter((doc) => (doc.asignaciones || []).some((a) => a.personaId === personaId))
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
            .map((doc) => ({
                documentId: doc.documentId,
                fecha: doc.createdAt,
                titulo: doc.titulo,
                itemsEntregados: doc.itemsEntregados || [],
                esReposicion: Boolean(doc.esReposicion),
                motivoReposicion: doc.motivoReposicion || null,
                validacion: doc.validacion || null,
                capacitacionUso: doc.capacitacionUso || null,
                firmadoPorTrabajador: (doc.asignaciones || []).some((a) => a.personaId === personaId && (a.estado === 'firmado' || a.fechaFirma))
            }));

        return { entregas, total: entregas.length };
    }
}

module.exports = { EppService, MOTIVOS_REPOSICION };
