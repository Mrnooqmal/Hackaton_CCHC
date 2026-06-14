/**
 * Persona Model (Refactored)
 * 
 * Identidad unificada. Reemplaza las entidades separadas User y Worker.
 * Un solo ID (personaId), un solo pinHash, sin sincronización dual.
 */

const ROLES = {
    admin: {
        nombre: 'Administrador Empresa',
        permisos: ['crear_usuarios', 'editar_usuarios', 'ver_usuarios', 'reset_pin',
                   'ver_reportes', 'gestionar_empresa', 'resolver_disputas',
                   'gestionar_obras', 'crear_obras', 'editar_obras', 'eliminar_obras',
                   'firmar_asistido']
    },
    jefe_obra: {
        nombre: 'Jefe de Obra',
        permisos: ['ver_trabajadores', 'crear_usuarios', 'editar_usuarios',
                   'gestionar_obras', 'editar_obras',
                   'crear_actividades', 'asignar_documentos',
                   'ver_reportes', 'firmar_relator', 'crear_capacitaciones',
                   'firmar_asistido']
    },
    supervisor: {
        nombre: 'Supervisor',
        permisos: ['firmar_relator', 'ver_trabajadores',
                   'registrar_asistencia', 'ver_reportes',
                   'gestionar_incidentes', 'firmar_asistido']
    },
    prevencionista: {
        nombre: 'Prevencionista',
        permisos: ['crear_actividades', 'asignar_documentos', 'ver_trabajadores',
                   'ver_reportes', 'crear_capacitaciones', 'firmar_asistido']
    },
    trabajador: {
        nombre: 'Trabajador',
        permisos: ['ver_documentos_asignados', 'firmar_documentos',
                   'registrar_asistencia', 'ver_perfil']
    }
};

class Persona {
    constructor(data) {
        // Identificador unico (reemplaza userId y workerId)
        this.personaId = data.personaId;
        this.tenantId = data.tenantId;

        // Datos personales
        this.rut = data.rut;
        this.nombre = data.nombre;
        this.apellidoPaterno = data.apellidoPaterno || '';
        this.apellidoMaterno = data.apellidoMaterno || '';
        this.apellido = data.apellido || [this.apellidoPaterno, this.apellidoMaterno].filter(Boolean).join(' ');
        this.fechaNacimiento = data.fechaNacimiento || null;
        this.email = data.email || '';
        this.telefono = data.telefono || '';
        this.fotoPerfil = data.fotoPerfil || null;
        this.notificacionesSms = data.notificacionesSms || false;

        // Rol y contexto laboral
        this.rol = data.rol || 'trabajador';
        this.permisos = data.permisos || (ROLES[this.rol]?.permisos || []);
        this.cargo = data.cargo || '';
        this.obraIds = data.obraIds || [];

        // Ficha del colaborador (datos relevantes para SSO/DS44)
        this.contactoEmergencia = data.contactoEmergencia || { nombre: '', telefono: '', relacion: '' };
        this.nivelEscolar = data.nivelEscolar || '';
        // Cursos/certificaciones del colaborador (ej. manejo de extintores, altura fisica)
        // [{ nombre, institucion?, fecha?, vencimiento? }]
        this.cursos = data.cursos || [];

        // Acceso y autenticacion
        this.tieneAccesoWeb = data.tieneAccesoWeb || false;
        this._passwordHash = data.passwordHash || null;
        this._pinHash = data.pinHash || null;
        this.pinCreatedAt = data.pinCreatedAt || null;
        this.passwordTemporal = data.passwordTemporal || false;

        // Enrolamiento
        this.habilitado = data.habilitado || false;
        this.firmaEnrolamiento = data.firmaEnrolamiento || null;

        // Overrides de onboarding DS44 por obra (marcas manuales)
        this.onboardingDS44 = data.onboardingDS44 || {};

        // Estado
        this.estado = data.estado || 'pendiente';

        // Vigilancia de salud ocupacional (DS44)
        this.vigilanciaSalud = data.vigilanciaSalud || {
            enVigilancia: false,
            protocolos: [],
            fechaUltimoExamen: null,
            aptitudLaboral: null,
            restricciones: []
        };

        // Restriccion o traslado por EP (DS44)
        this.restriccionLaboral = data.restriccionLaboral || null;

        // Preferencias
        this.preferencias = data.preferencias || {
            tema: 'dark',
            notificaciones: true,
            idioma: 'es'
        };

        // Metadata
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();
        this.ultimoAcceso = data.ultimoAcceso || null;
    }

    tienePinConfigurado() {
        return !!this._pinHash;
    }

    estaEnrolado() {
        return this.habilitado && this.tienePinConfigurado() && !!this.firmaEnrolamiento;
    }

    tienePermiso(permiso) {
        return this.permisos.includes(permiso);
    }

    /**
     * Genera PK y SK para DynamoDB
     */
    toDynamoKeys() {
        return {
            PK: `TENANT#${this.tenantId}`,
            SK: `PERSONA#${this.personaId}`
        };
    }

    /**
     * Convierte a item de DynamoDB
     */
    toDynamoItem() {
        return {
            ...this.toDynamoKeys(),
            personaId: this.personaId,
            tenantId: this.tenantId,
            rut: this.rut,
            nombre: this.nombre,
            apellidoPaterno: this.apellidoPaterno,
            apellidoMaterno: this.apellidoMaterno,
            apellido: this.apellido,
            fechaNacimiento: this.fechaNacimiento,
            email: this.email,
            telefono: this.telefono,
            fotoPerfil: this.fotoPerfil,
            notificacionesSms: this.notificacionesSms,
            rol: this.rol,
            permisos: this.permisos,
            cargo: this.cargo,
            obraIds: this.obraIds,
            contactoEmergencia: this.contactoEmergencia,
            nivelEscolar: this.nivelEscolar,
            cursos: this.cursos,
            tieneAccesoWeb: this.tieneAccesoWeb,
            passwordHash: this._passwordHash,
            pinHash: this._pinHash,
            pinCreatedAt: this.pinCreatedAt,
            passwordTemporal: this.passwordTemporal,
            habilitado: this.habilitado,
            firmaEnrolamiento: this.firmaEnrolamiento,
            onboardingDS44: this.onboardingDS44,
            estado: this.estado,
            vigilanciaSalud: this.vigilanciaSalud,
            restriccionLaboral: this.restriccionLaboral,
            preferencias: this.preferencias,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            ultimoAcceso: this.ultimoAcceso
        };
    }

    /**
     * Crea instancia desde item de DynamoDB
     */
    static fromDynamoItem(item) {
        if (!item) return null;
        return new Persona(item);
    }

    /**
     * Formato seguro para API (sin hashes)
     */
    toSafeFormat() {
        return {
            personaId: this.personaId,
            tenantId: this.tenantId,
            rut: this.rut,
            nombre: this.nombre,
            apellidoPaterno: this.apellidoPaterno,
            apellidoMaterno: this.apellidoMaterno,
            apellido: this.apellido,
            fechaNacimiento: this.fechaNacimiento,
            email: this.email,
            telefono: this.telefono,
            fotoPerfil: this.fotoPerfil,
            notificacionesSms: this.notificacionesSms,
            rol: this.rol,
            permisos: this.permisos,
            cargo: this.cargo,
            obraIds: this.obraIds,
            contactoEmergencia: this.contactoEmergencia,
            nivelEscolar: this.nivelEscolar,
            cursos: this.cursos,
            tieneAccesoWeb: this.tieneAccesoWeb,
            habilitado: this.habilitado,
            pinConfigurado: this.tienePinConfigurado(),
            enrolado: this.estaEnrolado(),
            estado: this.estado,
            passwordTemporal: this.passwordTemporal,
            onboardingDS44: this.onboardingDS44,
            vigilanciaSalud: this.vigilanciaSalud,
            restriccionLaboral: this.restriccionLaboral,
            preferencias: this.preferencias,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            ultimoAcceso: this.ultimoAcceso
        };
    }
}

module.exports = { Persona, ROLES };
