/**
 * PersonaAdapter
 * 
 * Adaptador para traducir entre formato interno (Persona) 
 * y formatos legacy (User, Worker).
 */

const { Persona } = require('../models/Persona');

class PersonaAdapter {
    /**
     * Convierte una Persona al formato de respuesta de GET /users/{id}
     * Coincide exactamente con la respuesta actual de users.js líneas 290-291
     */
    static toUserResponse(persona) {
        return {
            userId: persona.userId,
            rut: persona.rut,
            nombre: persona.nombre,
            apellido: persona.apellido,
            email: persona.email,
            telefono: persona.telefono,
            rol: persona.rol,
            permisos: persona.permisos || [],
            cargo: persona.cargo,
            empresaId: persona.empresaId,
            habilitado: persona.habilitado,
            estado: persona.estado,
            preferencias: persona.preferencias || { tema: 'dark', notificaciones: true, idioma: 'es' },
            avatar: persona.avatar || null,
            workerId: persona.workerId,
            createdAt: persona.createdAt,
            updatedAt: persona.updatedAt,
            ultimoAcceso: persona.ultimoAcceso || null
            // NOTA: No incluye passwordHash ni pinHash (seguridad)
        };
    }

    /**
     * Convierte una Persona al formato de respuesta de GET /workers/{id}
     * Coincide exactamente con la respuesta actual de workers.js
     */
    static toWorkerResponse(persona) {
        return {
            workerId: persona.workerId,
            rut: persona.rut,
            nombre: persona.nombre,
            apellido: persona.apellido,
            email: persona.email,
            telefono: persona.telefono,
            cargo: persona.cargo,
            empresaId: persona.empresaId,
            fechaEnrolamiento: persona.createdAt,
            signatureToken: persona.signatureToken || null,
            estado: 'activo',
            habilitado: persona.habilitado,
            pinCreatedAt: persona.pinCreatedAt,
            firmaEnrolamiento: persona.firmaEnrolamiento,
            createdAt: persona.createdAt,
            updatedAt: persona.updatedAt
            // NOTA: No incluye pinHash (seguridad)
        };
    }

    /**
     * Convierte una Persona al formato de lista de GET /workers
     * Incluye campos adicionales para compatibilidad con UI
     */
    static toWorkerListItem(persona) {
        const base = this.toWorkerResponse(persona);

        // Si viene de tabla Users, agregar marcador
        if (persona._sourceTable === 'users' || !persona.workerId) {
            return {
                ...base,
                workerId: persona.userId, // userId como workerId temporal
                _sourceTable: 'users',
                userId: persona.userId,
                rol: persona.rol
            };
        }

        return base;
    }

    /**
     * Convierte una lista de Personas al formato de respuesta de GET /workers
     */
    static toWorkerListResponse(personas) {
        return personas.map(p => this.toWorkerListItem(p));
    }

    /**
     * Convierte una lista de Personas al formato de respuesta de GET /users
     */
    static toUserListResponse(personas) {
        return {
            total: personas.length,
            users: personas.map(p => this.toUserResponse(p)),
            roles: {
                admin: { nombre: 'Administrador' },
                prevencionista: { nombre: 'Prevencionista' },
                trabajador: { nombre: 'Trabajador' }
            }
        };
    }

    /**
     * Convierte respuesta de setPin para mantener compatibilidad
     */
    static toSetPinResponse(resultado) {
        return {
            message: resultado.message,
            pinCreatedAt: resultado.pinCreatedAt
        };
    }

    /**
     * Convierte respuesta de completeEnrollment para tabla Users
     */
    static toUserEnrollmentResponse(resultado) {
        return {
            message: 'Enrolamiento completado exitosamente. El usuario está ahora habilitado.',
            userId: resultado.userId,
            workerId: resultado.workerId,
            habilitado: true,
            firma: resultado.firma
        };
    }

    /**
     * Convierte respuesta de completeEnrollment para tabla Workers
     */
    static toWorkerEnrollmentResponse(resultado) {
        return {
            message: 'Enrolamiento completado exitosamente. El trabajador está ahora habilitado.',
            workerId: resultado.workerId,
            habilitado: true,
            firma: resultado.firma
        };
    }
}

module.exports = { PersonaAdapter };
