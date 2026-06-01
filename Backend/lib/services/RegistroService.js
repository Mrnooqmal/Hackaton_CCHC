/**
 * RegistroService
 *
 * Servicio de consolidacion (read-model) para los registros normativos del
 * DS44 que se generan bajo demanda a partir de datos ya firmados:
 *   - Registro AT/EP e Incidentes Peligrosos (Arts. 71-72).
 *
 * Principio de diseño (ver Plan DS44 Fase C1): el registro NO es un documento
 * suelto con firma decorativa. Es un snapshot inmutable consolidado desde
 * incidentes + actividades firmadas + indicadores de siniestralidad, firmado
 * via FirmaService (firma real, verificable) y con hash reproducible.
 *
 * Consistencia > disponibilidad: la firma se persiste en SignaturesTable
 * (registro inmutable) y el documento referencia el mismo token + hash.
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { PutCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { docClient } = require('../clients/dynamodb');
const { s3Client } = require('../clients/s3');
const { FirmaService } = require('./FirmaService');
const { PersonaService } = require('./PersonaService');

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'Documents';
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE || 'Incidents';
const ACTIVITIES_TABLE = process.env.ACTIVITIES_TABLE || 'Activities';
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET || 'hackaton-documents';

class RegistroService {
    constructor() {
        this.personaService = new PersonaService();
    }

    /**
     * Hash reproducible de un snapshot. Serializa de forma estable (claves
     * ordenadas) para que el mismo contenido produzca siempre el mismo hash.
     */
    static hashSnapshot(snapshot) {
        const stable = JSON.stringify(snapshot, Object.keys(snapshot).sort());
        return crypto.createHash('sha256').update(stable).digest('hex');
    }

    /**
     * Render HTML del snapshot para persistir en S3 (respaldo fidedigno
     * imprimible). Incluye hash y token de firma para verificacion.
     */
    static renderHtml(snapshot, firma) {
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
        ));
        const ind = snapshot.indicadores || {};
        const filasInc = (snapshot.incidentes || []).map((i) => `
            <tr><td>${esc(i.fecha)}</td><td>${esc(i.tipo)}</td><td>${esc(i.gravedad)}</td>
            <td>${esc(i.descripcion)}</td><td>${esc(i.diasPerdidos)}</td><td>${i.investigacion ? 'Sí' : 'No'}</td></tr>`).join('');
        const filasAct = (snapshot.actividadesPreventivas || []).map((a) => `
            <tr><td>${esc(a.fecha)}</td><td>${esc(a.tipo)}${a.subtipo ? ' / ' + esc(a.subtipo) : ''}</td>
            <td>${esc(a.titulo)}</td><td>${esc(a.totalAsistentes)}</td></tr>`).join('');
        const filasVig = (snapshot.vigilanciaSalud?.personas || []).map((p) => `
            <tr><td>${esc(p.nombre)}</td><td>${esc((p.protocolos || []).join(', '))}</td><td>${esc(p.aptitudLaboral)}</td></tr>`).join('');

        return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Registro de Actividad Preventiva (Art. 72)</title>
<style>
 body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:13px}
 h1{font-size:18px;margin-bottom:4px} h2{font-size:14px;margin-top:24px;border-bottom:1px solid #ccc;padding-bottom:4px}
 table{border-collapse:collapse;width:100%;margin-top:8px} th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:12px}
 .muted{color:#666;font-size:12px} .firma{margin-top:24px;padding:12px;border:1px solid #999;border-radius:6px;background:#f7f7f7}
 .hash{font-family:monospace;font-size:11px;word-break:break-all}
</style></head><body>
<h1>Registro de Actividad Preventiva</h1>
<div class="muted">Arts. 71-72 DS44 · Documento formal del DO · Generado ${esc(snapshot.generadoEn)}</div>
<div class="muted">Periodo: ${esc(snapshot.periodo?.desde || '—')} a ${esc(snapshot.periodo?.hasta || '—')}</div>

<h2>Indicadores de siniestralidad (Arts. 73-75)</h2>
<table><tr><th>Masa laboral</th><th>Accidentes</th><th>Días perdidos</th><th>T. frecuencia</th><th>T. accidentabilidad</th><th>Siniestralidad</th></tr>
<tr><td>${esc(ind.masaLaboral)}</td><td>${esc(ind.numeroAccidentes)}</td><td>${esc(ind.diasPerdidos)}</td>
<td>${esc(ind.tasaFrecuencia)}</td><td>${esc(ind.tasaAccidentabilidad)}</td><td>${esc(ind.siniestralidad)}</td></tr></table>

<h2>Actividades preventivas (${(snapshot.actividadesPreventivas || []).length})</h2>
<table><tr><th>Fecha</th><th>Tipo</th><th>Título</th><th>Asistentes</th></tr>${filasAct || '<tr><td colspan="4" class="muted">Sin actividades en el periodo.</td></tr>'}</table>

<h2>Vigilancia de la salud (${snapshot.vigilanciaSalud?.enVigilancia || 0} de ${snapshot.vigilanciaSalud?.totalActivos || 0})</h2>
<table><tr><th>Persona</th><th>Protocolos</th><th>Aptitud</th></tr>${filasVig || '<tr><td colspan="3" class="muted">Sin personas en vigilancia.</td></tr>'}</table>

<h2>Incidentes / AT / EP (${(snapshot.incidentes || []).length})</h2>
<table><tr><th>Fecha</th><th>Tipo</th><th>Gravedad</th><th>Descripción</th><th>Días perdidos</th><th>Investigación</th></tr>${filasInc || '<tr><td colspan="6" class="muted">Sin incidentes en el periodo.</td></tr>'}</table>

<div class="firma">
 <strong>Firma electrónica</strong><br>
 Firmante: ${esc(firma?.personaNombre)} (${esc(firma?.personaRut)})<br>
 Método: ${esc(firma?.metodoValidacion)} · Fecha: ${esc(firma?.fecha)} ${esc(firma?.horario)}<br>
 Token: <span class="hash">${esc(firma?.token)}</span><br>
 Hash del contenido (SHA-256): <span class="hash">${esc(snapshot.hash || '')}</span>
</div>
</body></html>`;
    }

    /**
     * Filtra por periodo {desde, hasta} (YYYY-MM-DD inclusive) sobre el campo fecha.
     */
    static enPeriodo(fecha, periodo) {
        if (!fecha) return false;
        const f = String(fecha).slice(0, 10);
        if (periodo?.desde && f < periodo.desde) return false;
        if (periodo?.hasta && f > periodo.hasta) return false;
        return true;
    }

    async consolidarIncidentes({ tenantId, obraId, periodo }) {
        let items = [];
        try {
            const res = await docClient.send(new QueryCommand({
                TableName: INCIDENTS_TABLE,
                IndexName: 'tenantId-fecha-index',
                KeyConditionExpression: 'tenantId = :t',
                ExpressionAttributeValues: { ':t': tenantId }
            }));
            items = res.Items || [];
        } catch (err) {
            // Fallback a Scan si el GSI no existe en el entorno
            const res = await docClient.send(new ScanCommand({ TableName: INCIDENTS_TABLE }));
            items = (res.Items || []).filter(i => i.tenantId === tenantId);
        }
        return items.filter(i =>
            (!obraId || i.obraId === obraId) &&
            RegistroService.enPeriodo(i.fecha, periodo)
        );
    }

    async consolidarActividades({ tenantId, obraId, periodo }) {
        let items = [];
        try {
            const res = await docClient.send(new QueryCommand({
                TableName: ACTIVITIES_TABLE,
                IndexName: 'tenantId-index',
                KeyConditionExpression: 'tenantId = :t',
                ExpressionAttributeValues: { ':t': tenantId }
            }));
            items = res.Items || [];
        } catch (err) {
            const res = await docClient.send(new ScanCommand({ TableName: ACTIVITIES_TABLE }));
            items = (res.Items || []).filter(a => a.tenantId === tenantId);
        }
        return items.filter(a =>
            (!obraId || a.obraId === obraId) &&
            RegistroService.enPeriodo(a.fecha || a.createdAt, periodo)
        );
    }

    /**
     * Indicadores de siniestralidad (Arts. 73-75).
     *
     * NOTA (duda experto #5): las formulas exactas y periodicidad que exige la
     * fiscalizacion deben confirmarse. Se usan formulas estandar:
     *   - tasa de frecuencia  = (n accidentes / horas trabajadas) * 1.000.000
     *   - tasa de accidentabilidad = (n accidentes / masa laboral) * 100
     *   - siniestralidad (dias) = (dias perdidos / masa laboral) * 100
     * Horas trabajadas estimadas = masaLaboral * 8 h * 22 dias.
     */
    calcularIndicadores(incidentes, masaLaboral) {
        const masa = parseInt(masaLaboral) || 0;
        const accidentes = incidentes.filter(i => i.tipo === 'accidente');
        const numAccidentes = accidentes.length;
        const diasPerdidos = accidentes.reduce((s, a) => s + (a.diasPerdidos || 0), 0);
        const horasTrabajadas = masa * 8 * 22;

        return {
            masaLaboral: masa,
            numeroAccidentes: numAccidentes,
            diasPerdidos,
            tasaFrecuencia: horasTrabajadas > 0
                ? parseFloat(((numAccidentes / horasTrabajadas) * 1_000_000).toFixed(2)) : 0,
            tasaAccidentabilidad: masa > 0
                ? parseFloat(((numAccidentes / masa) * 100).toFixed(2)) : 0,
            siniestralidad: masa > 0
                ? parseFloat(((diasPerdidos / masa) * 100).toFixed(2)) : 0,
            porTipo: {
                accidentes: incidentes.filter(i => i.tipo === 'accidente').length,
                incidentes: incidentes.filter(i => i.tipo === 'incidente').length,
                condicionesSubestandar: incidentes.filter(i => i.tipo === 'condicion_subestandar').length
            },
            porGravedad: {
                leve: accidentes.filter(a => a.gravedad === 'leve').length,
                grave: accidentes.filter(a => a.gravedad === 'grave').length,
                fatal: accidentes.filter(a => a.gravedad === 'fatal').length
            }
        };
    }

    /**
     * Genera y firma el Registro AT/EP (Arts. 71-72) para un periodo.
     *
     * @param {Object} p
     * @param {string} p.tenantId
     * @param {string} p.obraId
     * @param {{desde?:string, hasta?:string}} p.periodo
     * @param {{personaId:string, pin?:any}} p.firmante  persona que firma el registro
     * @param {'PIN'|'PRESENCIAL'} p.metodo
     * @param {string} [p.firmaManuscrita] dataURL si metodo === 'PRESENCIAL'
     * @param {number} [p.masaLaboral] override; por defecto = personas activas de la obra
     * @param {Object} [p.contexto] { ipAddress, userAgent }
     * @returns {Promise<{documentId, token, hash, snapshot}>}
     */
    async generarRegistroATEP(p) {
        const { tenantId, obraId, periodo = {}, firmante, metodo = 'PIN', firmaManuscrita, contexto = {} } = p;

        if (!tenantId) throw new Error('tenantId es requerido');
        if (!obraId) throw new Error('obraId es requerido');
        if (!firmante?.personaId) throw new Error('firmante.personaId es requerido');

        const persona = await this.personaService.getById(firmante.personaId);
        if (!persona) throw new Error('Firmante no encontrado');
        if (persona.tenantId !== tenantId) throw new Error('El firmante no pertenece al tenant');

        // Masa laboral: override o personas activas asignadas a la obra
        // Personas de la obra (para masa laboral y vigilancia de salud).
        const personasObra = await this.personaService.listByTenant(tenantId, { obraId }) || [];
        const personasActivas = personasObra.filter(per => per.estado === 'activo');
        let masaLaboral = p.masaLaboral;
        if (masaLaboral === undefined || masaLaboral === null) {
            masaLaboral = personasActivas.length;
        }

        const incidentes = await this.consolidarIncidentes({ tenantId, obraId, periodo });
        const actividades = await this.consolidarActividades({ tenantId, obraId, periodo });
        const indicadores = this.calcularIndicadores(incidentes, masaLaboral);

        // El Registro de Actividad Preventiva (Art. 72) consolida TODA la actividad
        // preventiva del periodo, NO solo incidentes: capacitaciones, EPP,
        // inducciones, simulacros y la vigilancia de la salud.
        const personasEnVigilancia = personasActivas.filter(per => per.vigilanciaSalud?.enVigilancia);
        const actividadesPorTipo = actividades.reduce((acc, a) => {
            const key = a.subtipo ? `${a.tipo}:${a.subtipo}` : a.tipo;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});

        const generadoEn = new Date().toISOString();
        const documentId = uuidv4();

        // Snapshot inmutable (read-model). Solo datos consolidados, sin PII extra.
        const snapshot = {
            tipoRegistro: 'REGISTRO_AT_EP',
            articulos: 'Arts. 71-72',
            tenantId,
            obraId,
            periodo,
            generadoEn,
            indicadores,
            incidentes: incidentes.map(i => ({
                incidentId: i.incidentId || i.id,
                tipo: i.tipo,
                gravedad: i.gravedad || null,
                fecha: i.fecha || null,
                descripcion: i.descripcion || i.titulo || '',
                diasPerdidos: i.diasPerdidos || 0,
                investigacion: i.investigacion ? true : false
            })),
            actividadesPreventivas: actividades.map(a => ({
                activityId: a.activityId || a.id,
                tipo: a.tipo,
                subtipo: a.subtipo || null,
                titulo: a.titulo || '',
                fecha: a.fecha || a.createdAt || null,
                totalAsistentes: (a.asistentes || []).length
            })),
            actividadesPorTipo,
            vigilanciaSalud: {
                enVigilancia: personasEnVigilancia.length,
                totalActivos: personasActivas.length,
                personas: personasEnVigilancia.map(per => ({
                    personaId: per.personaId,
                    nombre: `${per.nombre} ${per.apellido || ''}`.trim(),
                    protocolos: per.vigilanciaSalud?.protocolos || [],
                    aptitudLaboral: per.vigilanciaSalud?.aptitudLaboral || null
                }))
            },
            totales: {
                incidentes: incidentes.length,
                actividades: actividades.length,
                enVigilancia: personasEnVigilancia.length
            }
        };

        const hash = RegistroService.hashSnapshot(snapshot);

        // Firma real via FirmaService (PIN valida el PIN del firmante; PRESENCIAL
        // registra firma de tercero). NUNCA firma decorativa.
        const credencial = metodo === 'PIN'
            ? (firmante.pin || {})
            : { firmaManuscrita: firmaManuscrita || null };

        const firma = await FirmaService.crear({
            personaId: persona.personaId,
            tenantId,
            metodo,
            credencial,
            tipoFirma: 'documento',
            referenciaId: documentId,
            referenciaTipo: 'document',
            contexto,
            metadata: { tipoRegistro: 'REGISTRO_AT_EP', obraId, periodo, hash },
            persona
        });

        // Render HTML del snapshot (con hash incluido) y persistir en S3 como
        // respaldo fidedigno imprimible. No es fatal: si S3 falla, el documento
        // firmado + hash siguen en DocumentsTable/SignaturesTable.
        const s3Key = `tenants/${tenantId}/obras/${obraId}/registros/${documentId}.html`;
        let s3Persistido = false;
        try {
            const html = RegistroService.renderHtml({ ...snapshot, hash }, firma);
            await s3Client.send(new PutObjectCommand({
                Bucket: DOCUMENTS_BUCKET,
                Key: s3Key,
                Body: html,
                ContentType: 'text/html; charset=utf-8'
            }));
            s3Persistido = true;
        } catch (s3Err) {
            console.error('No se pudo persistir el registro en S3:', s3Err.message);
        }

        // Persistir el documento REGISTRO_AT_EP con firma embebida + hash.
        const document = {
            documentId,
            tenantId,
            obraId,
            clasificacion: 'obra',
            fase: 'hacer',
            tipo: 'REGISTRO_AT_EP',
            tipoDescripcion: 'Registro AT, EP e Incidentes Peligrosos (Arts. 71-72)',
            obligatorio: true,
            titulo: `Registro AT/EP ${periodo?.desde || ''} a ${periodo?.hasta || ''}`.trim(),
            contenido: JSON.stringify(snapshot),
            snapshot,
            hash,
            s3Key: s3Persistido ? s3Key : null,
            firmas: [FirmaService.toDocumentFirmaFormat(firma)],
            asignaciones: [],
            estado: 'activo',
            version: 1,
            createdBy: persona.personaId,
            creatorName: `${persona.nombre} ${persona.apellido || ''}`.trim(),
            createdAt: generadoEn,
            updatedAt: generadoEn
        };

        await docClient.send(new PutCommand({ TableName: DOCUMENTS_TABLE, Item: document }));

        return { documentId, token: firma.token, hash, snapshot, s3Key: document.s3Key };
    }

    /**
     * CHECK (Fase VERIFICAR): read-model consolidado del periodo.
     *
     * Consolida la evidencia del DO (Arts. 14 y 22.4): indicadores de
     * siniestralidad (Arts. 73-75), investigaciones AT/EP (Art. 71), vigilancia
     * (Art. 67) y un conteo de actividades preventivas. NO firma nada: es solo
     * lectura para que el evaluador registre desviaciones y genere el informe.
     *
     * NOTA (duda experto #7): el calculo del "% medidas ejecutadas" del PTP
     * requiere una fuente de medidas planificadas vs. ejecutadas que aun no se
     * modela explicitamente; se deja como null hasta confirmar el origen.
     */
    async consolidarCheck({ tenantId, obraId, periodo = {} }) {
        if (!tenantId) throw new Error('tenantId es requerido');
        if (!obraId) throw new Error('obraId es requerido');

        const personasObra = await this.personaService.listByTenant(tenantId, { obraId });
        const activos = (personasObra || []).filter(p => p.estado === 'activo');
        const masaLaboral = activos.length;

        const incidentes = await this.consolidarIncidentes({ tenantId, obraId, periodo });
        const actividades = await this.consolidarActividades({ tenantId, obraId, periodo });
        const indicadores = this.calcularIndicadores(incidentes, masaLaboral);

        const investigaciones = incidentes.filter(i => i.investigacion || i.tipo === 'accidente');
        const enVigilancia = activos.filter(p => p.vigilanciaSalud?.enVigilancia).length;

        return {
            tenantId,
            obraId,
            periodo,
            generadoEn: new Date().toISOString(),
            masaLaboral,
            indicadores,
            investigacionesATEP: {
                total: investigaciones.length,
                conInvestigacion: incidentes.filter(i => i.investigacion).length
            },
            vigilancia: {
                enVigilancia,
                totalActivos: masaLaboral
            },
            actividadesPreventivas: {
                total: actividades.length
            },
            cumplimientoPTP: null, // duda experto #7: definir origen de medidas planificadas
            // El umbral de Informe Anual (Art. 52.15) se evalua en el frontend con
            // el tamaño de la entidad (>100 trabajadores con Depto. Prevencion).
            requiereInformeAnual: masaLaboral > 100
        };
    }
}

module.exports = { RegistroService };
