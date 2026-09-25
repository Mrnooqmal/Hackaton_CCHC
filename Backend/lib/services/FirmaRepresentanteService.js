/**
 * Documentos que firma el representante legal, y quién los tiene asignados.
 *
 * ESPEJO de Frontend/src/utils/firmaRepresentante.ts (la lista de tipos).
 *
 * El DS 44 exige una sola firma del representante legal: la aprobación del
 * Programa de Trabajo Preventivo (Art. 8 inc. 1, ítem 9 del FUF). La Política de
 * SST quedó con firma opcional (decisión D5) y ningún otro documento la declara.
 *
 * El problema que resuelve: el representante se designa en Mi Empresa y el
 * programa se sube en cada obra, en cualquier orden. Si el programa se subía
 * ANTES de designarlo —o se cambiaba de representante después— nadie le pedía la
 * firma: no aparecía en ninguna pantalla y el ítem quedaba "Incompleto" para
 * siempre. Ahora la asignación se sincroniza en los dos momentos:
 *
 *   - al designar o cambiar al representante (todos los documentos del tenant);
 *   - al crear un documento de estos tipos (ese documento).
 *
 * Las asignaciones que pone este servicio llevan `rol: 'representante_legal'`.
 * Así, al cambiar de representante se quita la pendiente del anterior sin tocar
 * otras asignaciones que esa misma persona pueda tener por otro motivo. Lo que ya
 * firmó no se toca nunca: la firma es evidencia.
 */

const { QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { PersonaService } = require('./PersonaService');
const { llaveDe, construirAsignacion } = require('../arregloSensible');

const TIPOS_FIRMA_REPRESENTANTE = new Set(['PROGRAMA_TRABAJO_PREVENTIVO']);
const ROL_REPRESENTANTE = 'representante_legal';

const requiereFirmaRepresentante = (tipo) => TIPOS_FIRMA_REPRESENTANTE.has(tipo);
const firmo = (a) => a?.estado === 'firmado' || Boolean(a?.fechaFirma);
const tieneArchivo = (d) => Boolean(d?.s3Key || d?.archivoUrl);

/**
 * Cómo deben quedar las asignaciones de un documento para `nuevoId`. Puro.
 *
 * Devuelve las asignaciones sin la pendiente de un representante anterior y
 * `falta: true` si hay que agregar la del nuevo. No agrega nada si el nuevo ya
 * firmó o ya la tiene.
 */
function planificar(doc, nuevoId) {
    const asignaciones = Array.isArray(doc.asignaciones) ? doc.asignaciones : [];
    const conservadas = asignaciones.filter(
        (a) => !(a.rol === ROL_REPRESENTANTE && a.personaId !== nuevoId && !firmo(a)));
    const quitadas = asignaciones.length - conservadas.length;
    const yaFirmo = Boolean(nuevoId) && (doc.firmas || []).some((f) => f.personaId === nuevoId);
    const yaAsignado = Boolean(nuevoId) && conservadas.some((a) => a.personaId === nuevoId);
    return { conservadas, quitadas, falta: Boolean(nuevoId) && !yaFirmo && !yaAsignado };
}

class FirmaRepresentanteService {
    constructor({ tabla = process.env.DOCUMENTS_TABLE, cliente = docClient, personas = null, eventos = null, llave = llaveDe } = {}) {
        this.tabla = tabla;
        this.cliente = cliente;
        this.personas = personas || new PersonaService();
        // La llave del RUT se pide a KMS: inyectable para que las pruebas no toquen AWS.
        this.llaveDe = llave;
        // Inyectable para las pruebas; en ejecución es el bus de la app.
        this.eventos = eventos || require('../events/EventBus').eventBus;
    }

    /** El representante como persona del tenant, o null si no existe o es de otro. */
    async personaDelTenant(tenantId, personaId) {
        if (!personaId) return null;
        const p = await this.personas.getById(personaId).catch(() => null);
        return p && p.tenantId === tenantId ? p : null;
    }

    async documentosDelTenant(tenantId) {
        const docs = [];
        let ExclusiveStartKey;
        do {
            const res = await this.cliente.send(new QueryCommand({
                TableName: this.tabla,
                IndexName: 'tenantId-index',
                KeyConditionExpression: 'tenantId = :t',
                ExpressionAttributeValues: { ':t': tenantId },
                ExclusiveStartKey,
            }));
            docs.push(...(res.Items || []));
            ExclusiveStartKey = res.LastEvaluatedKey;
        } while (ExclusiveStartKey);
        return docs.filter((d) => requiereFirmaRepresentante(d.tipo) && tieneArchivo(d) && d.estado !== 'archivado');
    }

    /**
     * Deja un documento con la asignación del representante correcta.
     * Devuelve true si le pidió la firma al representante (asignación nueva).
     */
    async sincronizarDocumento(doc, persona, llave) {
        const { conservadas, quitadas, falta } = planificar(doc, persona?.personaId || null);
        if (!falta && quitadas === 0) return false;

        const asignaciones = falta
            ? [...conservadas, {
                ...construirAsignacion(persona, { notificado: true }, llave),
                rol: ROL_REPRESENTANTE,
            }]
            : conservadas;

        await this.cliente.send(new UpdateCommand({
            TableName: this.tabla,
            Key: { documentId: doc.documentId },
            UpdateExpression: 'SET asignaciones = :a, updatedAt = :u',
            ExpressionAttributeValues: { ':a': asignaciones, ':u': new Date().toISOString() },
        }));

        if (falta) {
            // El aviso llega al inbox del representante; el documento aparece en
            // su "Mis firmas". Un fallo al notificar no deshace la asignación.
            await this.eventos.emit('document.assigned', {
                documentId: doc.documentId,
                userIds: [persona.personaId],
                assignedBy: 'system',
                creatorName: 'Build & Serve',
                documentName: doc.titulo,
                dueDate: null,
            }).catch((err) => console.error('[firma-representante] no se pudo notificar:', err.message));
        }
        return falta;
    }

    /**
     * Al designar o cambiar al representante: todos los documentos del tenant
     * que lo requieren quedan asignados a él, y ninguno al anterior.
     * `personaId` null = se quitó la designación.
     */
    async sincronizarTenant(tenantId, personaId) {
        const persona = await this.personaDelTenant(tenantId, personaId);
        if (personaId && !persona) {
            throw new Error('El representante legal debe ser una persona de la empresa.');
        }
        const docs = await this.documentosDelTenant(tenantId);
        if (docs.length === 0) return { documentos: 0, asignados: 0 };
        const llave = await this.llaveDe(tenantId);
        let asignados = 0;
        for (const doc of docs) {
            if (await this.sincronizarDocumento(doc, persona, llave)) asignados += 1;
        }
        return { documentos: docs.length, asignados };
    }

    /** Al crear un documento: si requiere al representante y hay uno, se le asigna. */
    async alCrearDocumento(doc, representante) {
        if (!requiereFirmaRepresentante(doc?.tipo) || !tieneArchivo(doc) || !representante?.personaId) return false;
        const persona = await this.personaDelTenant(doc.tenantId, representante.personaId);
        if (!persona) return false;
        return this.sincronizarDocumento(doc, persona, await this.llaveDe(doc.tenantId));
    }
}

module.exports = {
    FirmaRepresentanteService,
    TIPOS_FIRMA_REPRESENTANTE,
    ROL_REPRESENTANTE,
    requiereFirmaRepresentante,
    planificar,
};
