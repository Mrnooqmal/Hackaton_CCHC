/**
 * Obra Model
 * 
 * Representa un proyecto de construcción gestionado por un tenant.
 * Contiene las fases y documentos obligatorios por fase (DS 44).
 */

// Documentos obligatorios por fase según DS 44

// Documentos obligatorios DS44 - Fase PLAN
const DOCS_OBLIGATORIOS_PLAN = [
    'POLITICA_SSO',
    'DIAGNOSTICO_LEGAL',
    'MIPER',
    'MAPA_RIESGOS',
    'REGLAMENTO_INTERNO'
];
const DOCS_OBLIGATORIOS_POR_FASE = {
    excavacion: ['IRL', 'POLITICA_SSO', 'REGLAMENTO_INTERNO', 'MAPA_RIESGOS'],
    obra_gruesa: ['PROCEDIMIENTO_TRABAJO', 'ENTREGA_EPP', 'CAPACITACION'],
    terminaciones: ['PROCEDIMIENTO_TRABAJO', 'ENTREGA_EPP'],
    entrega: ['IRL', 'CAPACITACION']
};

const FASES_ORDEN = ['excavacion', 'obra_gruesa', 'terminaciones', 'entrega'];

class Obra {
    constructor(data) {
        this.obraId = data.obraId;
        this.tenantId = data.tenantId;
        this.nombre = data.nombre;
        this.codigo = data.codigo || '';
        this.direccion = data.direccion || '';
        this.comuna = data.comuna || '';
        this.region = data.region || '';
        this.etapaActual = data.etapaActual || 'excavacion';
        this.mandante = data.mandante || '';
        this.estado = data.estado || 'activa';
        this.imagenKey = data.imagenKey || '';

        // Tracking cumplimiento DS44 (PLAN/DO/CHECK)
        this.cumplimientoDS44 = data.cumplimientoDS44 || {
            plan: {
                documentosRequeridos: DOCS_OBLIGATORIOS_PLAN,
                documentosSubidos: [],
                completado: false
            },
            do: {
                activo: true,
                registrosMaestros: []
            },
            check: {
                ultimaEvaluacion: null,
                resultados: null
            }
        };

        // Configuración de fases con documentos obligatorios
        this.fasesConfig = data.fasesConfig || Obra.generarFasesConfig(
            data.fasesObligatorias || FASES_ORDEN
        );

        // Fase del ciclo Deming para el SGSST (DS44)
        this.faseDeming = data.faseDeming || 'plan'; // 'plan' | 'hacer' | 'verificar' | 'actuar'

        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();
    }

    /**
     * Genera configuración de fases con documentos obligatorios
     */
    static generarFasesConfig(fases) {
        const config = {};
        fases.forEach(fase => {
            config[fase] = {
                documentosObligatorios: DOCS_OBLIGATORIOS_POR_FASE[fase] || [],
                completada: false
            };
        });
        return config;
    }

    /**
     * Obtiene documentos obligatorios de una fase
     */
    getDocumentosObligatorios(fase) {
        return this.fasesConfig[fase]?.documentosObligatorios || [];
    }

    /**
     * Obtiene la fase siguiente a la actual
     */
    getFaseSiguiente() {
        const idx = FASES_ORDEN.indexOf(this.etapaActual);
        if (idx === -1 || idx >= FASES_ORDEN.length - 1) return null;
        return FASES_ORDEN[idx + 1];
    }

    /**
     * Genera PK y SK para DynamoDB
     */
    toDynamoKeys() {
        return {
            PK: `TENANT#${this.tenantId}`,
            SK: `OBRA#${this.obraId}`
        };
    }

    /**
     * Convierte a item de DynamoDB
     */
    toDynamoItem() {
        return {
            ...this.toDynamoKeys(),
            obraId: this.obraId,
            tenantId: this.tenantId,
            nombre: this.nombre,
            codigo: this.codigo,
            direccion: this.direccion,
            comuna: this.comuna,
            region: this.region,
            etapaActual: this.etapaActual,
            mandante: this.mandante,
            estado: this.estado,
            imagenKey: this.imagenKey,
            fasesConfig: this.fasesConfig,
            faseDeming: this.faseDeming,
            cumplimientoDS44: this.cumplimientoDS44,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Crea instancia desde item de DynamoDB
     */
    static fromDynamoItem(item) {
        if (!item) return null;
        return new Obra(item);
    }

    toSafeFormat() {
        return {
            obraId: this.obraId,
            tenantId: this.tenantId,
            nombre: this.nombre,
            codigo: this.codigo,
            direccion: this.direccion,
            comuna: this.comuna,
            region: this.region,
            mandante: this.mandante,
            estado: this.estado,
            imagenKey: this.imagenKey,
            fasesConfig: this.fasesConfig,
            faseDeming: this.faseDeming,
            cumplimientoDS44: this.cumplimientoDS44,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}

module.exports = { Obra, DOCS_OBLIGATORIOS_POR_FASE, DOCS_OBLIGATORIOS_PLAN, FASES_ORDEN };
