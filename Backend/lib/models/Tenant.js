/**
 * Tenant Model
 * 
 * Representa una empresa cliente del SaaS.
 * Contiene configuración, reglas de negocio y preferencias.
 */

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
        this.email = data.email || '';
        this.telefono = data.telefono || '';

        this.plan = data.plan || 'starter';
        this.tamano = data.tamano || Tenant.calcularTamano(data.cantidadTrabajadores || 0);
        this.cantidadTrabajadores = data.cantidadTrabajadores || 0;
        this.estado = data.estado || 'setup';
        this.adminPersonaId = data.adminPersonaId || null;

        this.settings = {
            maxWorkers: data.settings?.maxWorkers || PLANES[this.plan]?.limiteTrabajadores || 25,
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
            limiteObras: data.reglas?.limiteObras || PLANES[this.plan]?.limiteObras || 1,
            requiereFirmaPin: data.reglas?.requiereFirmaPin !== false,
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
            email: this.email,
            telefono: this.telefono,
            plan: this.plan,
            tamano: this.tamano,
            cantidadTrabajadores: this.cantidadTrabajadores,
            estado: this.estado,
            adminPersonaId: this.adminPersonaId,
            settings: this.settings,
            reglas: this.reglas,
            preferencias: this.preferencias,
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
            email: this.email,
            telefono: this.telefono,
            plan: this.plan,
            tamano: this.tamano,
            cantidadTrabajadores: this.cantidadTrabajadores,
            estado: this.estado,
            adminPersonaId: this.adminPersonaId,
            settings: this.settings,
            reglas: this.reglas,
            preferencias: this.preferencias,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}

module.exports = { Tenant, PLANES, TAMANOS };
