/**
 * Tenant Model
 * 
 * Representa una empresa cliente del SaaS.
 * Contiene configuración, reglas de negocio y preferencias.
 */

const { DEFAULT_ROLE_PRESETS } = require('../permissions');

const PLANES = {
    starter: { nombre: 'Starter', limiteObras: 1, limiteTrabajadores: 25 },
    professional: { nombre: 'Professional', limiteObras: 5, limiteTrabajadores: 100 },
    enterprise: { nombre: 'Enterprise', limiteObras: -1, limiteTrabajadores: -1 }
};

const TAMANOS = {
    micro: { min: 1, max: 9 },
    pequena: { min: 10, max: 49 },
    mediana: { min: 50, max: 199 },
    grande: { min: 200, max: Infinity }
};

class Tenant {
    constructor(data) {
        this.tenantId = data.tenantId;
        this.slug = data.slug || '';
        this.nombre = data.nombre;
        this.rutEmpresa = data.rutEmpresa || '';

        this.tamano = data.tamano || Tenant.calcularTamano(data.cantidadTrabajadores || 0);
        this.cantidadTrabajadores = data.cantidadTrabajadores || 0;
        this.estado = data.estado || 'setup';
        this.adminPersonaId = data.adminPersonaId || null;

        this.settings = {
            maxWorkers: data.settings?.maxWorkers || PLANES.starter.limiteTrabajadores,
            dataRetentionDays: data.settings?.dataRetentionDays || 365,
            twoFactorEnabled: data.settings?.twoFactorEnabled || false,
            modulosActivos: data.settings?.modulosActivos || [
                'documentos', 'actividades', 'encuestas', 'incidentes', 'firmas', 'inbox'
            ],
            ...(data.settings || {})
        };

        this.reglas = {
            fasesObligatorias: data.reglas?.fasesObligatorias || [
                'excavacion', 'obra_gruesa', 'terminaciones', 'entrega'
            ],
            limiteObras: data.reglas?.limiteObras || PLANES.starter.limiteObras,
            requiereFirmaPin: data.reglas?.requiereFirmaPin !== false,
            // Representante legal de la empresa (DS 44 Art. 8 inc. 1): es quien
            // aprueba el Programa de Trabajo Preventivo y firma la Política SST.
            // Vive a nivel empresa, no de obra: la representación es una sola.
            // { personaId, nombre, rut } o null mientras no se designe.
            representanteLegal: data.reglas?.representanteLegal || null,
            ...(data.reglas || {})
        };

        this.preferencias = {
            timezone: data.preferencias?.timezone || 'America/Santiago',
            idioma: data.preferencias?.idioma || 'es',
            formatoFecha: data.preferencias?.formatoFecha || 'DD/MM/YYYY',
            colorPrimario: data.preferencias?.colorPrimario || '#2563eb',
            colorSecundario: data.preferencias?.colorSecundario || '#7c3aed',
            logoUrl: data.preferencias?.logoUrl || null,
            ...(data.preferencias || {})
        };

        // Roles definidos por la empresa. Los protegidos (mínimos) se garantizan
        // siempre, aunque el payload los omita o sea un tenant antiguo.
        this.roles = Tenant.conRolesProtegidos(
            (Array.isArray(data.roles) && data.roles.length > 0)
                ? data.roles.map(Tenant.normalizarRol)
                : Tenant.rolesPorDefecto().map(Tenant.normalizarRol)
        );

        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();
    }

    /**
     * Calcula el tamaño de empresa según cantidad de trabajadores
     */
    static calcularTamano(cantidad) {
        if (cantidad >= TAMANOS.grande.min) return 'grande';
        if (cantidad >= TAMANOS.mediana.min) return 'mediana';
        if (cantidad >= TAMANOS.pequena.min) return 'pequena';
        return 'micro';
    }

    /**
     * Roles "esenciales" de una empresa. El `tipo` es la identidad estable del
     * rol: aunque la empresa lo renombre, en esencia sigue siendo el mismo (un
     * supervisor siempre lidera una cuadrilla, etc.). Estos roles NO se pueden
     * eliminar ni cambiarles la descripción; solo el `nombre` es editable (y los
     * permisos, salvo admin que siempre tiene acceso total). Ver `esRolProtegido`.
     */
    static get TIPOS_PROTEGIDOS() {
        return ['admin', 'jefe_obra', 'prevencionista', 'supervisor', 'trabajador'];
    }

    static esRolProtegido(tipo) {
        return Tenant.TIPOS_PROTEGIDOS.includes(tipo);
    }

    /**
     * Garantiza que la lista de roles contenga los protegidos (mínimos). Conserva
     * la personalización del tenant (nombre/permisos) para los que ya existen y
     * agrega los faltantes desde los valores por defecto. Mantiene los protegidos
     * al inicio y respeta el orden de TIPOS_PROTEGIDOS.
     */
    static conRolesProtegidos(roles) {
        const lista = Array.isArray(roles) ? roles.map(Tenant.normalizarRol) : [];
        const porTipo = new Map(lista.filter(r => r.tipo).map(r => [r.tipo, r]));
        const defaults = new Map(Tenant.rolesPorDefecto().map(r => [r.tipo, Tenant.normalizarRol(r)]));

        const protegidos = Tenant.TIPOS_PROTEGIDOS.map(tipo => porTipo.get(tipo) || defaults.get(tipo));
        const personalizados = lista.filter(r => !r.tipo);
        return [...protegidos, ...personalizados];
    }

    /**
     * Roles que se crean por defecto para una empresa nueva. Los protegidos
     * (con `tipo`) son los mínimos de toda empresa; el resto se puede añadir.
     */
    static rolesPorDefecto() {
        return [
            { id: 'admin', tipo: 'admin', nombre: 'Administrador', descripcion: 'Acceso completo a la gestión de la empresa.', permisos: DEFAULT_ROLE_PRESETS.admin },
            { id: 'jefe_obra', tipo: 'jefe_obra', nombre: 'Jefe de Obra', descripcion: 'Responsable de la dirección y supervisión de la obra.', permisos: DEFAULT_ROLE_PRESETS.jefe_obra },
            { id: 'prevencionista', tipo: 'prevencionista', nombre: 'Prevencionista', descripcion: 'Encargado de la prevención de riesgos y la seguridad en obra.', permisos: DEFAULT_ROLE_PRESETS.prevencionista },
            { id: 'supervisor', tipo: 'supervisor', nombre: 'Supervisor', descripcion: 'Lidera una cuadrilla de personas trabajadoras y coordina el equipo en terreno.', permisos: DEFAULT_ROLE_PRESETS.supervisor },
            { id: 'trabajador', tipo: 'trabajador', nombre: 'Persona trabajadora', descripcion: 'Ejecuta las actividades diarias en obra dentro de la cuadrilla de un supervisor.', permisos: DEFAULT_ROLE_PRESETS.trabajador }
        ];
    }

    /**
     * Genera un id URL-friendly a partir del nombre del rol.
     */
    static slugRol(nombre) {
        return String(nombre || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9\s-]/g, '')
            .trim()
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_');
    }

    /**
     * Normaliza un rol recibido (string o objeto) a
     * { id, tipo, nombre, descripcion, permisos }.
     *
     * El `tipo` es la esencia estable del rol y, cuando es uno de los protegidos,
     * fija el `id` para que las referencias (`persona.rol`) sobrevivan a un
     * renombre. Un `id`/tipo legacy 'colaborador' se migra a 'trabajador'.
     */
    static normalizarRol(rol) {
        const base = typeof rol === 'string'
            ? { nombre: rol, descripcion: '', permisos: [], tipo: null, id: undefined }
            : (rol || {});

        const nombre = (base.nombre || '').trim();
        let tipo = base.tipo || null;
        // Migración: el antiguo "colaborador" es la persona trabajadora.
        if (tipo === 'colaborador' || base.id === 'colaborador') tipo = 'trabajador';

        // Para roles protegidos el id es el propio tipo (estable ante renombres).
        const id = Tenant.esRolProtegido(tipo)
            ? tipo
            : (base.id || Tenant.slugRol(nombre));

        return {
            id,
            tipo: Tenant.esRolProtegido(tipo) ? tipo : null,
            nombre,
            descripcion: (base.descripcion || '').trim(),
            permisos: Array.isArray(base.permisos) ? base.permisos : []
        };
    }

    /**
     * Genera PK y SK para DynamoDB
     */
    toDynamoKeys() {
        return {
            PK: `TENANT#${this.tenantId}`,
            SK: `METADATA#${this.tenantId}`
        };
    }

    /**
     * Convierte a item de DynamoDB
     */
    toDynamoItem() {
        return {
            ...this.toDynamoKeys(),
            tenantId: this.tenantId,
            slug: this.slug,
            nombre: this.nombre,
            rutEmpresa: this.rutEmpresa,
            tamano: this.tamano,
            cantidadTrabajadores: this.cantidadTrabajadores,
            estado: this.estado,
            adminPersonaId: this.adminPersonaId,
            settings: this.settings,
            reglas: this.reglas,
            preferencias: this.preferencias,
            roles: this.roles,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Crea instancia desde item de DynamoDB
     */
    static fromDynamoItem(item) {
        if (!item) return null;
        return new Tenant(item);
    }

    /**
     * Formato seguro para API (sin datos internos)
     */
    toSafeFormat() {
        return {
            tenantId: this.tenantId,
            slug: this.slug,
            nombre: this.nombre,
            rutEmpresa: this.rutEmpresa,
            tamano: this.tamano,
            cantidadTrabajadores: this.cantidadTrabajadores,
            estado: this.estado,
            adminPersonaId: this.adminPersonaId,
            settings: this.settings,
            reglas: this.reglas,
            preferencias: this.preferencias,
            roles: this.roles,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}

module.exports = { Tenant, PLANES, TAMANOS };
