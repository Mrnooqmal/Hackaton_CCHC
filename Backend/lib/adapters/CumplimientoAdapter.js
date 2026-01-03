/**
 * CumplimientoAdapter
 * 
 * Adaptador para traducir entre formato interno (Cumplimiento) 
 * y formatos legacy (Activity, Document, SignatureRequest).
 */

const { Cumplimiento, TIPOS_CUMPLIMIENTO } = require('../models/Cumplimiento');

class CumplimientoAdapter {
    /**
     * Convierte un Cumplimiento al formato de Activity para la respuesta de API
     * Coincide exactamente con la respuesta actual de activities.js
     */
    static toActivityResponse(cumplimiento) {
        return cumplimiento.toActivityFormat();
    }

    /**
     * Convierte un Cumplimiento al formato de Document para la respuesta de API
     */
    static toDocumentResponse(cumplimiento) {
        return cumplimiento.toDocumentFormat();
    }

    /**
     * Convierte un Cumplimiento al formato de SignatureRequest
     */
    static toSignatureRequestResponse(cumplimiento) {
        return cumplimiento.toSignatureRequestFormat();
    }

    /**
     * Convierte datos de creación de Activity a parámetros de Cumplimiento
     * Uso: cuando POST /activities recibe body, lo traduce para CumplimientoService
     */
    static fromActivityCreateRequest(body) {
        return {
            tipo: body.tipo,
            titulo: body.tema,
            descripcion: body.descripcion || '',
            empresaId: body.empresaId || 'default',
            ubicacion: body.ubicacion || '',
            relatorId: body.relatorId,
            trabajadoresIds: body.trabajadoresIds || [],
            fechaProgramada: body.fecha || new Date().toISOString().split('T')[0]
        };
    }

    /**
     * Convierte datos de creación de Document a parámetros de Cumplimiento
     */
    static fromDocumentCreateRequest(body) {
        return {
            tipo: body.tipo,
            titulo: body.titulo,
            descripcion: body.descripcion || '',
            contenido: body.contenido || '',
            empresaId: body.empresaId || 'default',
            relatorId: body.relatorId || null,
            trabajadoresIds: body.workerIds || []
        };
    }

    /**
     * Convierte datos de creación de SignatureRequest a parámetros de Cumplimiento
     */
    static fromSignatureRequestCreateRequest(body) {
        return {
            tipo: body.tipo,
            titulo: body.titulo,
            descripcion: body.descripcion || '',
            empresaId: body.empresaId || 'default',
            ubicacion: body.ubicacion || '',
            relatorId: body.solicitanteId,
            trabajadoresIds: body.trabajadoresIds || [],
            fechaLimite: body.fechaLimite || null,
            contenido: body.documentos || null
        };
    }

    /**
     * Convierte respuesta de registro de asistencia al formato legacy
     */
    static toAttendanceResponse(cumplimiento, nuevosAsistentes) {
        return {
            message: `${nuevosAsistentes.length} asistente(s) registrado(s)`,
            totalAsistentes: cumplimiento.firmas.length,
            nuevosAsistentes: nuevosAsistentes.map(a => ({
                workerId: a.workerId,
                nombre: a.workerNombre,
                rut: a.workerRut,
                cargo: a.workerCargo || '',
                firma: {
                    token: a.token,
                    fecha: a.fecha,
                    horario: a.horario,
                    timestamp: a.timestamp
                }
            })),
            firmaRelator: cumplimiento.firmaRelator
        };
    }

    /**
     * Convierte respuesta de firma de documento al formato legacy
     */
    static toDocumentSignResponse(firma) {
        return {
            message: 'Documento firmado exitosamente',
            firma: {
                token: firma.token,
                workerId: firma.workerId,
                nombre: firma.workerNombre,
                rut: firma.workerRut,
                tipoFirma: firma.tipoFirma,
                fecha: firma.fecha,
                horario: firma.horario,
                timestamp: firma.timestamp
            }
        };
    }

    /**
     * Obtiene los tipos de actividad para respuesta de lista
     */
    static getActivityTypes() {
        const types = {};
        Object.entries(TIPOS_CUMPLIMIENTO).forEach(([key, value]) => {
            if (value.categoria === 'actividad') {
                types[key] = value.nombre;
            }
        });
        return types;
    }

    /**
     * Obtiene los tipos de documento para respuesta de lista
     */
    static getDocumentTypes() {
        const types = {};
        Object.entries(TIPOS_CUMPLIMIENTO).forEach(([key, value]) => {
            if (value.categoria === 'documento') {
                types[key] = value.nombre;
            }
        });
        return types;
    }
}

module.exports = { CumplimientoAdapter };
