/**
 * Cumplimiento Model
 * 
 * Abstracción que unifica Documento + Actividad + Firma.
 * Representa un evento de cumplimiento normativo.
 */

// Tipos de cumplimiento normativo
const TIPOS_CUMPLIMIENTO = {
    // Actividades
    CHARLA_5MIN: { categoria: 'actividad', nombre: 'Charla Diaria de 5 Minutos', requiereFirma: true },
    ART: { categoria: 'actividad', nombre: 'Análisis de Riesgos en Terreno', requiereFirma: true },
    CAPACITACION: { categoria: 'actividad', nombre: 'Capacitación', requiereFirma: true },
    INDUCCION: { categoria: 'actividad', nombre: 'Inducción', requiereFirma: true },
    REUNION_COMITE: { categoria: 'actividad', nombre: 'Reunión Comité Paritario', requiereFirma: true },
    SIMULACRO: { categoria: 'actividad', nombre: 'Simulacro de Emergencia', requiereFirma: true },
    INSPECCION: { categoria: 'actividad', nombre: 'Inspección de Seguridad', requiereFirma: false },

    // Documentos
    IRL: { categoria: 'documento', nombre: 'Informe de Riesgos Laborales', requiereFirma: true },
    POLITICA_SSO: { categoria: 'documento', nombre: 'Política de Seguridad y Salud Ocupacional', requiereFirma: true },
    REGLAMENTO_INTERNO: { categoria: 'documento', nombre: 'Reglamento Interno', requiereFirma: true },
    PROCEDIMIENTO_TRABAJO: { categoria: 'documento', nombre: 'Procedimiento de Trabajo Seguro', requiereFirma: true },
    ENTREGA_EPP: { categoria: 'documento', nombre: 'Entrega de EPP', requiereFirma: true },
    ENCUESTA_SALUD: { categoria: 'documento', nombre: 'Encuesta de Salud Pre-Ocupacional', requiereFirma: false },

    // Procesos especiales
    ENROLAMIENTO: { categoria: 'proceso', nombre: 'Enrolamiento Digital', requiereFirma: true },
};

class Cumplimiento {
    constructor(data) {
        // Identificador único
        this.cumplimientoId = data.cumplimientoId || null;

        // Tipo y clasificación
        this.tipo = data.tipo;
        this.tipoInfo = TIPOS_CUMPLIMIENTO[data.tipo] || {
            categoria: 'otro',
            nombre: data.tipo,
            requiereFirma: true
        };

        // Contenido
        this.titulo = data.titulo || this.tipoInfo.nombre;
        this.descripcion = data.descripcion || '';
        this.contenido = data.contenido || null; // Puede ser HTML, texto, o referencia a S3

        // Contexto
        this.empresaId = data.empresaId || 'default';
        this.ubicacion = data.ubicacion || '';
        this.relatorId = data.relatorId || null;

        // Tarea/Asignación
        this.tarea = {
            trabajadoresIds: data.trabajadoresIds || [],
            fechaLimite: data.fechaLimite || null,
            fechaProgramada: data.fechaProgramada || null,
            estado: data.estadoTarea || 'pendiente' // pendiente, en_curso, completada, cancelada
        };

        // Firmas recolectadas
        this.firmas = data.firmas || [];
        this.firmaRelator = data.firmaRelator || null;

        // Estado general
        this.estado = data.estado || 'activo';

        // Metadata
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();

        // Referencias a entidades legacy
        this._legacyActivityId = data.activityId || null;
        this._legacyDocumentId = data.documentId || null;
        this._legacyRequestId = data.requestId || null;
    }

    /**
     * Verifica si requiere firma según su tipo
     */
    requiereFirma() {
        return this.tipoInfo.requiereFirma;
    }

    /**
     * Calcula el progreso de firmas
     */
    getProgreso() {
        const total = this.tarea.trabajadoresIds.length;
        const firmados = this.firmas.length;
        return {
            total,
            firmados,
            pendientes: total - firmados,
            porcentaje: total > 0 ? Math.round((firmados / total) * 100) : 0
        };
    }

    /**
     * Verifica si está completamente firmado
     */
    estaCompleto() {
        const progreso = this.getProgreso();
        const firmasCompletas = progreso.pendientes === 0;
        const relatorFirmado = !this.relatorId || !!this.firmaRelator;
        return firmasCompletas && relatorFirmado;
    }

    /**
     * Agrega una firma al cumplimiento
     */
    agregarFirma(firma) {
        // Evitar duplicados
        const yaFirmado = this.firmas.some(f => f.workerId === firma.workerId);
        if (!yaFirmado) {
            this.firmas.push(firma);
            this.updatedAt = new Date().toISOString();

            // Actualizar estado de tarea si está completo
            if (this.estaCompleto()) {
                this.tarea.estado = 'completada';
            }
        }
        return !yaFirmado;
    }

    /**
     * Convierte a formato compatible con Activity (activities.js)
     */
    toActivityFormat() {
        return {
            activityId: this._legacyActivityId || this.cumplimientoId,
            tipo: this.tipo,
            tipoDescripcion: this.tipoInfo.nombre,
            tema: this.titulo,
            descripcion: this.descripcion,
            fecha: this.tarea.fechaProgramada?.split('T')[0] || this.createdAt.split('T')[0],
            horaInicio: this.createdAt.split('T')[1]?.substring(0, 5) || '00:00',
            horaFin: this.estaCompleto() ? this.updatedAt.split('T')[1]?.substring(0, 5) : null,
            relatorId: this.relatorId,
            empresaId: this.empresaId,
            ubicacion: this.ubicacion,
            asistentes: this.firmas.map(f => ({
                workerId: f.workerId,
                nombre: f.workerNombre,
                rut: f.workerRut,
                cargo: f.cargo || '',
                firma: {
                    token: f.token,
                    fecha: f.fecha,
                    horario: f.horario,
                    timestamp: f.timestamp
                }
            })),
            firmaRelator: this.firmaRelator,
            estado: this.tarea.estado,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Convierte a formato compatible con Document (documents.js)
     */
    toDocumentFormat() {
        return {
            documentId: this._legacyDocumentId || this.cumplimientoId,
            tipo: this.tipo,
            tipoDescripcion: this.tipoInfo.nombre,
            titulo: this.titulo,
            contenido: this.contenido,
            descripcion: this.descripcion,
            empresaId: this.empresaId,
            relatorId: this.relatorId,
            firmas: this.firmas.map(f => ({
                token: f.token,
                workerId: f.workerId,
                nombre: f.workerNombre,
                rut: f.workerRut,
                tipoFirma: f.tipoFirma || 'trabajador',
                fecha: f.fecha,
                horario: f.horario,
                timestamp: f.timestamp,
                ip: f.ipAddress
            })),
            asignaciones: this.tarea.trabajadoresIds.map(wId => {
                const firma = this.firmas.find(f => f.workerId === wId);
                return {
                    workerId: wId,
                    fechaAsignacion: this.createdAt,
                    fechaLimite: this.tarea.fechaLimite,
                    estado: firma ? 'firmado' : 'pendiente',
                    fechaFirma: firma?.timestamp || null
                };
            }),
            estado: this.estado,
            version: 1,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Convierte a formato compatible con SignatureRequest
     */
    toSignatureRequestFormat() {
        const progreso = this.getProgreso();
        return {
            requestId: this._legacyRequestId || this.cumplimientoId,
            tipo: this.tipo,
            titulo: this.titulo,
            descripcion: this.descripcion,
            ubicacion: this.ubicacion,
            solicitanteId: this.relatorId,
            empresaId: this.empresaId,
            trabajadores: this.tarea.trabajadoresIds.map(wId => {
                const firma = this.firmas.find(f => f.workerId === wId);
                return {
                    workerId: wId,
                    estado: firma ? 'firmada' : 'pendiente',
                    signatureId: firma?.signatureId || null
                };
            }),
            fechaLimite: this.tarea.fechaLimite,
            estado: progreso.pendientes === 0 ? 'completada' :
                progreso.firmados > 0 ? 'en_progreso' : 'pendiente',
            totalTrabajadores: progreso.total,
            firmasCompletadas: progreso.firmados,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Crea un Cumplimiento desde datos de Activity
     */
    static fromActivity(activityData) {
        return new Cumplimiento({
            cumplimientoId: activityData.activityId,
            tipo: activityData.tipo,
            titulo: activityData.tema,
            descripcion: activityData.descripcion,
            empresaId: activityData.empresaId,
            ubicacion: activityData.ubicacion,
            relatorId: activityData.relatorId,
            trabajadoresIds: (activityData.asistentes || []).map(a => a.workerId),
            fechaProgramada: activityData.fecha,
            estadoTarea: activityData.estado,
            firmas: (activityData.asistentes || []).filter(a => a.firma).map(a => ({
                workerId: a.workerId,
                workerNombre: a.nombre,
                workerRut: a.rut,
                token: a.firma.token,
                fecha: a.firma.fecha,
                horario: a.firma.horario,
                timestamp: a.firma.timestamp
            })),
            firmaRelator: activityData.firmaRelator,
            activityId: activityData.activityId,
            createdAt: activityData.createdAt,
            updatedAt: activityData.updatedAt
        });
    }

    /**
     * Crea un Cumplimiento desde datos de Document
     */
    static fromDocument(documentData) {
        return new Cumplimiento({
            cumplimientoId: documentData.documentId,
            tipo: documentData.tipo,
            titulo: documentData.titulo,
            descripcion: documentData.descripcion,
            contenido: documentData.contenido,
            empresaId: documentData.empresaId,
            relatorId: documentData.relatorId,
            trabajadoresIds: (documentData.asignaciones || []).map(a => a.workerId),
            fechaLimite: documentData.asignaciones?.[0]?.fechaLimite,
            estadoTarea: documentData.estado,
            firmas: (documentData.firmas || []).map(f => ({
                workerId: f.workerId,
                workerNombre: f.nombre,
                workerRut: f.rut,
                token: f.token,
                tipoFirma: f.tipoFirma,
                fecha: f.fecha,
                horario: f.horario,
                timestamp: f.timestamp,
                ipAddress: f.ip
            })),
            documentId: documentData.documentId,
            estado: documentData.estado,
            createdAt: documentData.createdAt,
            updatedAt: documentData.updatedAt
        });
    }
}

module.exports = { Cumplimiento, TIPOS_CUMPLIMIENTO };
