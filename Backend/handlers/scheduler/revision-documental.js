/**
 * Recordatorio de revisión anual de documentos (DS44 Art. 57 inc. 5 — FUF).
 *
 * El Reglamento Interno (y la Política SST) deben revisarse al menos una vez al
 * año. Este job avisa por el inbox a la línea de mando cuando el documento se
 * acerca (o supera) los 12 meses desde su última publicación, para que publiquen
 * una nueva versión revisada (con participantes, ver el versionado del RI).
 *
 * Sigue la misma convención que estructura-alertas: el aviso va SOLO al inbox
 * (senderRol 'system', sin SMS) y es idempotente para no repetirse a diario.
 */
const { ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { InboxRepository } = require('../inbox-module/inbox.repository');
const { PersonaService } = require('../../lib/services/PersonaService');
const { TenantService } = require('../../lib/services/TenantService');
const { PERMISSIONS, personaPuede } = require('../../lib/permissions');

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'Documents';
const inboxRepo = new InboxRepository();
const personaService = new PersonaService();
const tenantService = new TenantService();

// Documentos con obligación legal de revisión al menos anual (Art. 57 inc. 5).
const TIPOS_REVISION_ANUAL = new Set(['REGLAMENTO_INTERNO', 'POLITICA_SSO']);
const LABEL_TIPO = {
    REGLAMENTO_INTERNO: 'Reglamento Interno (RIHS/RIOHS)',
    POLITICA_SSO: 'Política de Seguridad y Salud en el Trabajo',
};

const DIAS_AVISO = 330;    // ~11 meses: avisa antes de cumplir el año.
const REALERTA_DIAS = 30;  // mientras siga vencido, re-avisa cada ~mes (no a diario).

const diasDesde = (fecha, ahora) => {
    const t = fecha ? new Date(fecha).getTime() : NaN;
    if (!t || Number.isNaN(t)) return null;
    return Math.floor((ahora.getTime() - t) / 86400000);
};

/** Administradores del tenant (misma regla que estructura-alertas). */
const administradoresDe = async (tenantId, cache) => {
    if (cache.has(tenantId)) return cache.get(tenantId);
    let ids = [];
    try {
        const [personas, tenant] = await Promise.all([
            personaService.listByTenant(tenantId).catch(() => []),
            tenantService.getById(tenantId).catch(() => null),
        ]);
        const safe = tenant ? tenant.toSafeFormat() : null;
        ids = (personas || [])
            .filter((p) => p.estado !== 'inactivo'
                && (personaPuede(p, safe, PERMISSIONS.OBRAS_CREAR) || personaPuede(p, safe, PERMISSIONS.EMPRESA_VER)))
            .map((p) => p.personaId);
    } catch (err) {
        console.error('[revision-documental] no se pudo resolver destinatarios:', err.message);
    }
    cache.set(tenantId, ids);
    return ids;
};

const avisar = async ({ destinatarios, subject, content, documentId }) => {
    if (!destinatarios || destinatarios.length === 0) return false;
    try {
        await inboxRepo.sendMessage({
            senderId: 'system', senderName: 'Build & Serve', senderRol: 'system',
            recipientIds: destinatarios,
            type: 'alert', priority: 'normal',
            subject, content,
            linkedEntity: { type: 'document', id: documentId },
        });
        return true;
    } catch (err) {
        console.error('[revision-documental] no se pudo enviar el aviso:', err.message);
        return false;
    }
};

/**
 * Recorre los documentos de revisión anual y emite recordatorios.
 *
 * Los corporativos (RI/Política) se reparten en N copias por persona, así que se
 * agrupan por (tenant, tipo) para avisar UNA sola vez. La antigüedad se mide con
 * la copia más recientemente actualizada (la última revisión) y la marca de
 * idempotencia se guarda en una copia de referencia estable (menor documentId).
 */
async function revisarRevisionDocumental(ahora = new Date()) {
    const resumen = { grupos: 0, avisos: 0 };
    const cacheAdmins = new Map();

    const res = await docClient.send(new ScanCommand({ TableName: DOCUMENTS_TABLE }));
    const docs = (res.Items || []).filter(d =>
        TIPOS_REVISION_ANUAL.has(d.tipo) && d.estado !== 'anulado');

    // Agrupar por (tenant, tipo).
    const grupos = new Map();
    for (const d of docs) {
        const key = `${d.tenantId}::${d.tipo}`;
        if (!grupos.has(key)) grupos.set(key, []);
        grupos.get(key).push(d);
    }

    for (const [, copias] of grupos) {
        resumen.grupos += 1;
        const tenantId = copias[0].tenantId;
        const tipo = copias[0].tipo;

        // Última revisión = fecha más reciente entre las copias.
        const fechaRef = (d) => d.ultimaPublicacionEn || d.updatedAt || d.createdAt || null;
        const ultimaRevision = copias
            .map(fechaRef)
            .filter(Boolean)
            .sort((a, b) => new Date(b) - new Date(a))[0] || null;
        const antiguedad = diasDesde(ultimaRevision, ahora);
        if (antiguedad === null || antiguedad < DIAS_AVISO) continue;

        // Copia de referencia estable para la marca de idempotencia.
        const referencia = [...copias].sort((a, b) =>
            String(a.documentId).localeCompare(String(b.documentId)))[0];
        const ultimaAlerta = referencia.ultimaAlertaRevision || null;
        const desdeUltimaAlerta = diasDesde(ultimaAlerta, ahora);
        if (ultimaAlerta && desdeUltimaAlerta !== null && desdeUltimaAlerta < REALERTA_DIAS) continue;

        const destinatarios = await administradoresDe(tenantId, cacheAdmins);
        const label = LABEL_TIPO[tipo] || tipo;
        const meses = Math.floor(antiguedad / 30);
        const vencido = antiguedad >= 365;
        const subject = vencido
            ? `Revisión anual vencida: ${label}`
            : `Revisión anual próxima: ${label}`;
        const content = vencido
            ? `El ${label} no se revisa hace ${meses} meses (última publicación: ${String(ultimaRevision).slice(0, 10)}). `
              + `El Art. 57 inc. 5 obliga a revisarlo al menos una vez al año con participación del Comité Paritario o Delegado. `
              + `Publica una nueva versión revisada desde la ficha de la obra para dejar el registro de control de cambios.`
            : `El ${label} se acerca a los 12 meses desde su última revisión (${String(ultimaRevision).slice(0, 10)}). `
              + `Programa la revisión anual (Art. 57 inc. 5) con el Comité Paritario o Delegado y publica la nueva versión.`;

        const ok = await avisar({ destinatarios, subject, content, documentId: referencia.documentId });
        if (!ok) continue;

        try {
            await docClient.send(new UpdateCommand({
                TableName: DOCUMENTS_TABLE,
                Key: { documentId: referencia.documentId },
                UpdateExpression: 'SET ultimaAlertaRevision = :now',
                ExpressionAttributeValues: { ':now': ahora.toISOString() },
            }));
        } catch (err) {
            console.error('[revision-documental] no se pudo marcar la alerta:', err.message);
        }
        resumen.avisos += 1;
    }

    return resumen;
}

module.exports = { revisarRevisionDocumental };
