/**
 * EppCatalogoService
 *
 * Catálogo de EPP por empresa (DS44 Art. 13). Es la fuente de verdad de qué
 * elementos existen: las entregas a trabajadores (EppService) eligen de acá en
 * vez de escribir la descripción a mano, para que un mismo casco no aparezca
 * como "Casco", "casco de seguridad" y "CASCO clase B" en tres registros.
 *
 * Cada elemento exige dos respaldos que el DS44 hace obligatorios:
 *   - certificado: certificado de calidad O registro en el ISP (uno de los dos).
 *   - instructivo: uso, mantenimiento, reposición o recambio del elemento.
 * Un elemento al que le falte alguno se marca incompleto, pero se puede entregar
 * igual: la falta se registra en la entrega en vez de frenar la obra.
 */

const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');

const EPP_TABLE = process.env.EPP_TABLE || 'Epp';

/** Tipos válidos del documento de certificación (el DS44 acepta cualquiera). */
const TIPOS_CERTIFICADO = ['certificado_calidad', 'registro_isp'];

const TIPO_CERTIFICADO_LABEL = {
    certificado_calidad: 'Certificado de calidad',
    registro_isp: 'Registro en el ISP',
};

/** Un adjunto tal como lo devuelve /uploads (fileKey + metadatos). */
const sanitizeAdjunto = (adj) => {
    if (!adj || typeof adj !== 'object') return null;
    const fileKey = String(adj.fileKey || adj.url || '').trim();
    if (!fileKey) return null;
    return {
        fileKey,
        nombre: String(adj.nombre || adj.fileName || 'documento').trim(),
        tipo: adj.tipo || adj.fileType || null,
        subidoEn: adj.subidoEn || new Date().toISOString(),
    };
};

/**
 * Estado de cumplimiento documental del elemento. `faltantes` viaja al frontend
 * para poder decir exactamente qué falta sin recalcularlo en cada pantalla.
 */
const evaluarCumplimiento = (epp) => {
    const faltantes = [];
    if (!epp.certificado) faltantes.push('certificado');
    if (!epp.instructivo) faltantes.push('instructivo');
    return { completo: faltantes.length === 0, faltantes };
};

class EppCatalogoService {
    /** Lista el catálogo del tenant, ordenado por nombre. */
    async list(tenantId) {
        if (!tenantId) throw new Error('tenantId es requerido');
        const res = await docClient.send(new QueryCommand({
            TableName: EPP_TABLE,
            KeyConditionExpression: 'tenantId = :t',
            ExpressionAttributeValues: { ':t': tenantId },
        }));
        return (res.Items || [])
            .map((item) => ({ ...item, ...evaluarCumplimiento(item) }))
            .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
    }

    async getById(tenantId, eppId) {
        if (!tenantId || !eppId) throw new Error('tenantId y eppId son requeridos');
        const res = await docClient.send(new GetCommand({
            TableName: EPP_TABLE,
            Key: { tenantId, eppId },
        }));
        if (!res.Item) return null;
        return { ...res.Item, ...evaluarCumplimiento(res.Item) };
    }

    /** Valida y normaliza los campos editables comunes a crear y actualizar. */
    _sanitizeInput(body) {
        const nombre = String(body.nombre || '').trim();
        if (!nombre) throw new Error('El nombre del elemento es obligatorio');
        if (nombre.length > 120) throw new Error('El nombre no puede superar los 120 caracteres');

        const certificado = sanitizeAdjunto(body.certificado);
        let certificadoTipo = certificado ? String(body.certificadoTipo || '').trim() : null;
        if (certificado) {
            if (!certificadoTipo) certificadoTipo = 'certificado_calidad';
            if (!TIPOS_CERTIFICADO.includes(certificadoTipo)) {
                throw new Error(`Tipo de certificado inválido. Válidos: ${TIPOS_CERTIFICADO.join(', ')}`);
            }
        }

        return {
            nombre,
            descripcion: String(body.descripcion || '').trim() || null,
            certificado,
            certificadoTipo,
            instructivo: sanitizeAdjunto(body.instructivo),
        };
    }

    async create(tenantId, body) {
        if (!tenantId) throw new Error('tenantId es requerido');
        const datos = this._sanitizeInput(body);
        const now = new Date().toISOString();
        const item = {
            tenantId,
            eppId: uuidv4(),
            ...datos,
            activo: true,
            createdAt: now,
            updatedAt: now,
        };
        await docClient.send(new PutCommand({ TableName: EPP_TABLE, Item: item }));
        return { ...item, ...evaluarCumplimiento(item) };
    }

    async update(tenantId, eppId, body) {
        const actual = await this.getById(tenantId, eppId);
        if (!actual) throw new Error('Elemento de EPP no encontrado');
        const datos = this._sanitizeInput(body);
        const item = {
            ...actual,
            ...datos,
            activo: body.activo === undefined ? actual.activo !== false : Boolean(body.activo),
            updatedAt: new Date().toISOString(),
        };
        // `completo`/`faltantes` son derivados: no se persisten.
        delete item.completo;
        delete item.faltantes;
        await docClient.send(new PutCommand({ TableName: EPP_TABLE, Item: item }));
        return { ...item, ...evaluarCumplimiento(item) };
    }

    async remove(tenantId, eppId) {
        const actual = await this.getById(tenantId, eppId);
        if (!actual) throw new Error('Elemento de EPP no encontrado');
        await docClient.send(new DeleteCommand({ TableName: EPP_TABLE, Key: { tenantId, eppId } }));
        return { eliminado: true, eppId };
    }
}

module.exports = {
    EppCatalogoService,
    TIPOS_CERTIFICADO,
    TIPO_CERTIFICADO_LABEL,
    evaluarCumplimiento,
};
