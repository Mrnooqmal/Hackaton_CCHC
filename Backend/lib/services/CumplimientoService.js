/**
 * CumplimientoService
 * 
 * Servicio central para gestión de eventos de cumplimiento normativo.
 * Unifica la lógica de Activity, Document y SignatureRequest.
 */

const { v4: uuidv4 } = require('uuid');
const { Cumplimiento, TIPOS_CUMPLIMIENTO } = require('../models/Cumplimiento');
const { FirmaService } = require('./FirmaService');
const { PersonaService } = require('./PersonaService');

class CumplimientoService {
    /**
     * Crea un nuevo evento de cumplimiento
     * 
     * @param {Object} params
     * @param {string} params.tipo - Tipo de cumplimiento (de TIPOS_CUMPLIMIENTO)
     * @param {string} params.titulo - Título descriptivo
     * @param {string} params.descripcion - Descripción del cumplimiento
     * @param {string} params.contenido - Contenido (HTML, texto, ref S3)
     * @param {string} params.empresaId - ID de la empresa
     * @param {string} params.ubicacion - Ubicación física
     * @param {string} params.relatorId - ID del relator/responsable
     * @param {string[]} params.trabajadoresIds - IDs de trabajadores asignados
     * @param {string} params.fechaLimite - Fecha límite opcional
     * @param {string} params.fechaProgramada - Fecha programada
     */
    static async crear(params) {
        const cumplimientoId = uuidv4();
        const now = new Date().toISOString();

        const cumplimiento = new Cumplimiento({
            cumplimientoId,
            tipo: params.tipo,
            titulo: params.titulo,
            descripcion: params.descripcion || '',
            contenido: params.contenido || null,
            empresaId: params.empresaId || 'default',
            ubicacion: params.ubicacion || '',
            relatorId: params.relatorId || null,
            trabajadoresIds: params.trabajadoresIds || [],
            fechaLimite: params.fechaLimite || null,
            fechaProgramada: params.fechaProgramada || now.split('T')[0],
            estadoTarea: 'pendiente',
            estado: 'activo',
            createdAt: now,
            updatedAt: now
        });

        return cumplimiento;
    }

    /**
     * Registra firma(s) en un cumplimiento
     * 
     * @param {Cumplimiento} cumplimiento - Instancia de Cumplimiento
     * @param {string[]} workerIds - IDs de trabajadores que firman
     * @param {string} pin - PIN para validación
     * @param {Object} contexto - Contexto de la request
     * @param {boolean} incluirFirmaRelator - Si incluir firma del relator
     */
    static async registrarFirmas(cumplimiento, workerIds, pin, contexto, incluirFirmaRelator = false, metodo = 'PIN') {
        const nuevasFirmas = [];
        const errores = [];

        for (const workerId of workerIds) {
            // Verificar si ya firmó
            const yaFirmo = cumplimiento.firmas.some(f => f.workerId === workerId);
            if (yaFirmo) {
                continue;
            }

            try {
                const firma = await FirmaService.crear({
                    workerId,
                    metodo: metodo,
                    credencial: pin,
                    tipoFirma: cumplimiento.tipoInfo.categoria,
                    referenciaId: cumplimiento.cumplimientoId,
                    referenciaTipo: 'cumplimiento',
                    contexto,
                    metadata: {
                        tipo: cumplimiento.tipo,
                        titulo: cumplimiento.titulo
                    }
                });

                cumplimiento.agregarFirma(firma);
                nuevasFirmas.push(firma);
            } catch (err) {
                errores.push({ workerId, error: err.message });
            }
        }

        // Firma del relator si se solicita
        if (incluirFirmaRelator && cumplimiento.relatorId && !cumplimiento.firmaRelator) {
            try {
                const firmaRelator = await FirmaService.crear({
                    workerId: cumplimiento.relatorId,
                    metodo: metodo,
                    credencial: pin,
                    tipoFirma: 'relator',
                    referenciaId: cumplimiento.cumplimientoId,
                    referenciaTipo: 'cumplimiento',
                    contexto,
                    metadata: {
                        tipo: cumplimiento.tipo,
                        titulo: cumplimiento.titulo,
                        esRelator: true
                    }
                });

                cumplimiento.firmaRelator = firmaRelator;
            } catch (err) {
                errores.push({ workerId: cumplimiento.relatorId, error: err.message, esRelator: true });
            }
        }

        // Actualizar estado de la tarea
        if (cumplimiento.estaCompleto()) {
            cumplimiento.tarea.estado = 'completada';
        } else if (cumplimiento.firmas.length > 0) {
            cumplimiento.tarea.estado = 'en_curso';
        }

        cumplimiento.updatedAt = new Date().toISOString();

        return {
            nuevasFirmas,
            errores,
            totalFirmados: cumplimiento.firmas.length,
            totalPendientes: cumplimiento.tarea.trabajadoresIds.length - cumplimiento.firmas.length,
            completo: cumplimiento.estaCompleto()
        };
    }

    /**
     * Obtiene estadísticas de cumplimiento
     */
    static calcularEstadisticas(cumplimientos) {
        const stats = {
            total: cumplimientos.length,
            completadas: 0,
            pendientes: 0,
            enCurso: 0,
            canceladas: 0,
            porTipo: {},
            totalFirmas: 0,
            promedioFirmasPorCumplimiento: 0,
            porcentajeCumplimiento: 0
        };

        cumplimientos.forEach(c => {
            // Por estado
            switch (c.tarea.estado) {
                case 'completada': stats.completadas++; break;
                case 'pendiente': stats.pendientes++; break;
                case 'en_curso': stats.enCurso++; break;
                case 'cancelada': stats.canceladas++; break;
            }

            // Por tipo
            if (!stats.porTipo[c.tipo]) {
                stats.porTipo[c.tipo] = {
                    nombre: c.tipoInfo.nombre,
                    total: 0,
                    completadas: 0
                };
            }
            stats.porTipo[c.tipo].total++;
            if (c.tarea.estado === 'completada') {
                stats.porTipo[c.tipo].completadas++;
            }

            // Firmas
            stats.totalFirmas += c.firmas.length;
        });

        // Promedios
        if (stats.completadas > 0) {
            stats.promedioFirmasPorCumplimiento =
                Math.round((stats.totalFirmas / stats.completadas) * 10) / 10;
        }

        stats.porcentajeCumplimiento = stats.total > 0
            ? Math.round((stats.completadas / stats.total) * 100)
            : 0;

        return stats;
    }

    /**
     * Obtiene los tipos de cumplimiento disponibles
     */
    static getTipos() {
        return TIPOS_CUMPLIMIENTO;
    }

    /**
     * Obtiene tipos por categoría
     */
    static getTiposPorCategoria(categoria) {
        const tipos = {};
        Object.entries(TIPOS_CUMPLIMIENTO).forEach(([key, value]) => {
            if (value.categoria === categoria) {
                tipos[key] = value.nombre;
            }
        });
        return tipos;
    }
}

module.exports = { CumplimientoService };
