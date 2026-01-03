/**
 * Persona Model
 * 
 * Abstracción que unifica Usuario y Trabajador.
 * Esta es la "single source of truth" lógica para identidad.
 */

class Persona {
    constructor(data) {
        // Identificadores
        this.userId = data.userId || null;
        this.workerId = data.workerId || null;
        this.rut = data.rut;

        // Datos personales
        this.nombre = data.nombre;
        this.apellido = data.apellido || '';
        this.email = data.email || '';
        this.telefono = data.telefono || '';

        // Rol y contexto laboral
        this.rol = data.rol || 'trabajador';
        this.cargo = data.cargo || '';
        this.empresaId = data.empresaId || 'default';

        // Estado de habilitación
        this.habilitado = data.habilitado || false;
        this.estado = data.estado || 'pendiente';

        // Seguridad (no exponer hashes directamente)
        this._pinHash = data.pinHash || null;
        this._passwordHash = data.passwordHash || null;
        this.pinCreatedAt = data.pinCreatedAt || null;
        this.passwordTemporal = data.passwordTemporal || false;

        // Enrolamiento
        this.firmaEnrolamiento = data.firmaEnrolamiento || null;

        // Metadata
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();

        // Fuente de datos original
        this._sourceTable = data._sourceTable || null;
    }

    /**
     * Verifica si la persona tiene PIN configurado
     */
    tienePinConfigurado() {
        return !!this._pinHash;
    }

    /**
     * Verifica si la persona está completamente enrolada
     */
    estaEnrolado() {
        return this.habilitado && this.tienePinConfigurado() && !!this.firmaEnrolamiento;
    }

    /**
     * Obtiene el ID principal (userId si existe, sino workerId)
     */
    getIdPrincipal() {
        return this.userId || this.workerId;
    }

    /**
     * Convierte a formato compatible con tabla Users
     */
    toUserFormat() {
        return {
            userId: this.userId,
            rut: this.rut,
            nombre: this.nombre,
            apellido: this.apellido,
            email: this.email,
            telefono: this.telefono,
            rol: this.rol,
            cargo: this.cargo,
            empresaId: this.empresaId,
            habilitado: this.habilitado,
            estado: this.estado,
            pinHash: this._pinHash,
            passwordHash: this._passwordHash,
            pinCreatedAt: this.pinCreatedAt,
            passwordTemporal: this.passwordTemporal,
            firmaEnrolamiento: this.firmaEnrolamiento,
            workerId: this.workerId,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Convierte a formato compatible con tabla Workers
     */
    toWorkerFormat() {
        return {
            workerId: this.workerId,
            rut: this.rut,
            nombre: this.nombre,
            apellido: this.apellido,
            email: this.email,
            telefono: this.telefono,
            cargo: this.cargo,
            empresaId: this.empresaId,
            habilitado: this.habilitado,
            estado: this.estado === 'activo' ? 'activo' : 'activo',
            pinHash: this._pinHash,
            pinCreatedAt: this.pinCreatedAt,
            firmaEnrolamiento: this.firmaEnrolamiento,
            userId: this.userId,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Convierte a formato seguro para API (sin hashes)
     */
    toSafeFormat() {
        return {
            userId: this.userId,
            workerId: this.workerId,
            rut: this.rut,
            nombre: this.nombre,
            apellido: this.apellido,
            email: this.email,
            telefono: this.telefono,
            rol: this.rol,
            cargo: this.cargo,
            empresaId: this.empresaId,
            habilitado: this.habilitado,
            estado: this.estado,
            pinConfigurado: this.tienePinConfigurado(),
            enrolado: this.estaEnrolado(),
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Crea una Persona desde datos de tabla Users
     */
    static fromUser(userData) {
        return new Persona({
            ...userData,
            _sourceTable: 'users'
        });
    }

    /**
     * Crea una Persona desde datos de tabla Workers
     */
    static fromWorker(workerData) {
        return new Persona({
            ...workerData,
            rol: workerData.rol || 'trabajador',
            _sourceTable: 'workers'
        });
    }

    /**
     * Fusiona datos de User y Worker en una sola Persona
     * Prioriza User para datos de autenticación, Worker para datos laborales
     */
    static mergeUserAndWorker(userData, workerData) {
        return new Persona({
            // IDs de ambas fuentes
            userId: userData?.userId || workerData?.userId,
            workerId: workerData?.workerId || userData?.workerId,

            // Datos personales (priorizar User si existe)
            rut: userData?.rut || workerData?.rut,
            nombre: userData?.nombre || workerData?.nombre,
            apellido: userData?.apellido || workerData?.apellido,
            email: userData?.email || workerData?.email,
            telefono: userData?.telefono || workerData?.telefono,

            // Rol (solo en Users)
            rol: userData?.rol || 'trabajador',
            cargo: workerData?.cargo || userData?.cargo,
            empresaId: userData?.empresaId || workerData?.empresaId || 'default',

            // Estado (cualquiera de los dos debe estar habilitado)
            habilitado: userData?.habilitado || workerData?.habilitado || false,
            estado: userData?.estado || (workerData?.estado === 'activo' ? 'activo' : 'pendiente'),

            // Seguridad (User tiene prioridad para login, pero ambos deben tener PIN sincronizado)
            pinHash: userData?.pinHash || workerData?.pinHash,
            passwordHash: userData?.passwordHash,
            pinCreatedAt: userData?.pinCreatedAt || workerData?.pinCreatedAt,
            passwordTemporal: userData?.passwordTemporal || false,

            // Enrolamiento (cualquier fuente)
            firmaEnrolamiento: userData?.firmaEnrolamiento || workerData?.firmaEnrolamiento,

            // Metadata
            createdAt: userData?.createdAt || workerData?.createdAt,
            updatedAt: Math.max(
                new Date(userData?.updatedAt || 0).getTime(),
                new Date(workerData?.updatedAt || 0).getTime()
            ) > 0 ? new Date(Math.max(
                new Date(userData?.updatedAt || 0).getTime(),
                new Date(workerData?.updatedAt || 0).getTime()
            )).toISOString() : new Date().toISOString(),

            _sourceTable: 'merged'
        });
    }
}

module.exports = { Persona };
