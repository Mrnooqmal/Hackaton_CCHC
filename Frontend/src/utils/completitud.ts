/**
 * Presentación de la completitud del FUF.
 *
 * A diferencia de `estructuraPreventiva.ts`, esto NO es un espejo del motor: la
 * evaluación corre en el servidor porque necesita los documentos del repositorio,
 * y duplicarla en el cliente daría dos verdades sobre el mismo requisito. Acá solo
 * viven los estados y cómo se pintan.
 *
 * El cálculo que sí debe funcionar sin conexión es el de OBLIGACIONES (qué órgano
 * corresponde según la dotación), y ése ya está en `estructuraPreventiva.ts`.
 */

export const ESTADO_REQUISITO = {
    CUMPLIDO: 'Cumplido',
    PARCIAL: 'Parcial',
    PENDIENTE: 'Pendiente',
    VENCIDO: 'Vencido',
    NO_APLICA: 'NoAplica',
    FUERA_DE_ALCANCE: 'FueraDeAlcance',
} as const;
export type EstadoRequisito = typeof ESTADO_REQUISITO[keyof typeof ESTADO_REQUISITO];

/** Los dos que no penalizan: salen del denominador del porcentaje. */
export const ESTADOS_NO_PENALIZAN: EstadoRequisito[] = [
    ESTADO_REQUISITO.NO_APLICA, ESTADO_REQUISITO.FUERA_DE_ALCANCE,
];

export const ESTADO_LABEL: Record<EstadoRequisito, string> = {
    Cumplido: 'Cumplido',
    Parcial: 'Parcial',
    Pendiente: 'Pendiente',
    Vencido: 'Vencido',
    NoAplica: 'No aplica',
    FueraDeAlcance: 'Fuera de alcance',
};

/** Variante de Badge por estado. `NoAplica` va en neutro a propósito: no es una
 *  falta, y pintarlo de rojo empujaría a "arreglar" algo que no corresponde. */
export const ESTADO_VARIANTE: Record<EstadoRequisito, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'secondary'> = {
    Cumplido: 'success',
    Parcial: 'warning',
    Pendiente: 'info',
    Vencido: 'danger',
    NoAplica: 'neutral',
    FueraDeAlcance: 'secondary',
};

export interface RequisitoFuf {
    id: string;
    item: number | null;
    bloque: string | null;
    titulo: string;
    ambito: string;
    estado: EstadoRequisito;
    detalle: string | null;
    /** Solo en `NoAplica`: por qué no es exigible. El índice del expediente la pide. */
    justificacion: string | null;
    /** Tipos de documento que sostienen el requisito. Los declara su definición,
     *  que es la que los mira para evaluar: el repositorio no adivina. */
    tipos?: string[];
    /** Módulo que resuelve el requisito cuando no se acredita con documentos. */
    modulo?: string | null;
    /** Presente solo en los requisitos que se acreditan informando a alguien. */
    distribucion?: DistribucionRequisito | null;
}

/** Estado de UN destinatario frente a un documento. Lo calcula el servidor. */
export interface EstadoDestinatario {
    tipo: string;
    estado: 'Enviado' | 'FueraDePlazo' | 'Pendiente' | 'NoAplica';
    envio: { fecha: string; medio?: string; observacion?: string | null } | null;
    dias: number | null;
    detalle: string;
}

/**
 * Desglose de a quién hay que informar un documento y cómo va cada destinatario.
 *
 * Viene calculado del motor: la interfaz lo pinta y registra envíos contra él,
 * pero NO recalcula el plazo ni decide quién es exigible. Es genérico a
 * propósito — los ítems 4, 11, 25, 37 y 51 exigen el mismo hecho con otros
 * destinatarios, y se enganchan devolviendo este mismo bloque.
 */
export interface DistribucionRequisito {
    documentoId: string;
    tipoDocumento: string;
    titulo: string | null;
    fechaVigencia: string | null;
    /** Si el requisito necesita una fecha de vigencia declarada para medir el plazo. */
    exigeVigencia: boolean;
    diasExigidos: number;
    articulo: string;
    resultado: {
        detalle: EstadoDestinatario[];
        exigibles: number;
        excluidos: number;
        enviados: number;
        fueraDePlazo: number;
        completa: boolean;
        parcial: boolean;
    };
}

export interface ResumenCompletitud {
    total: number;
    exigibles: number;
    excluidos: number;
    cumplidos: number;
    porEstado: Record<EstadoRequisito, number>;
    progreso: number;
}

export interface BloqueCompletitud {
    bloque: string;
    requisitos: RequisitoFuf[];
    resumen: ResumenCompletitud;
}

/**
 * Un componente del Art. 22 dentro del SGSST (ítem 1).
 *
 * `propio` distingue los que se acreditan con un documento propio de los que
 * se acreditan en otro módulo: los segundos no se suben acá, se enlazan. Guardar
 * una copia de la MIPER dentro del SGSST sería tener dos verdades sobre el mismo
 * documento.
 */
export interface ComponenteSgsst {
    clave: string;
    literal: string;
    estado: EstadoRequisito;
    detalle: string;
    propio: boolean;
    tipo?: string;
    enlace: string | null;
}

export interface CompletitudAmbito {
    ambito: string;
    obraId: string | null;
    dotacion: { dotacion: number; origen: string; calculada: number; declarada: number | null };
    limiteRegistroDT: string | null;
    requisitos: RequisitoFuf[];
    resumen: ResumenCompletitud;
    bloques: BloqueCompletitud[];
    /** Desglose del Art. 22. Solo viene en ámbito empresa: el SGSST es de la
     *  entidad empleadora, no de cada obra. */
    sgsst?: ComponenteSgsst[] | null;
}

/** Color del porcentaje, con los mismos cortes que ya usa el resto del panel DS44. */
export const colorProgreso = (p: number): string =>
    p >= 80 ? '#10b981' : p >= 50 ? '#f59e0b' : '#ef4444';

// ─── Reglas de evaluación (espejo de Backend/lib/completitud.js) ─────────────
//
// El motor del servidor evalúa los requisitos del FUF, que necesitan el
// repositorio completo. Estas mismas reglas se replican acá para el cumplimiento
// POR FASE DEMING, que se calcula con datos que la pantalla ya tiene cargados.
// Son las mismas reglas a propósito: dos formas distintas de contar lo mismo es
// exactamente lo que este motor viene a eliminar.

/** ¿El documento existe y tiene archivo? Sin archivo no hay documento. */
export const tieneArchivo = (doc: any): boolean =>
    Boolean(doc && (doc.s3Key || doc.archivoUrl));

/** Firmas que faltan. Se deriva de las asignaciones, no de un campo duplicado. */
export function firmasPendientes(doc: any): number {
    const asignaciones = Array.isArray(doc?.asignaciones) ? doc.asignaciones : [];
    if (asignaciones.length === 0) return 0;
    return asignaciones.filter((a: any) => a?.estado !== 'firmado' && !a?.fechaFirma).length;
}

/**
 * Estado de un requisito que se acredita con un documento.
 * Un documento con firmas pendientes NO está Cumplido.
 */
export function estadoPorDocumento(
    doc: any,
    { exigeFirma = false, fechaLimite = null, ahora = new Date() }:
        { exigeFirma?: boolean; fechaLimite?: string | null; ahora?: Date } = {}
): { estado: EstadoRequisito; detalle: string } {
    if (!tieneArchivo(doc)) {
        const vencido = Boolean(fechaLimite && new Date(fechaLimite).getTime() < ahora.getTime());
        return {
            estado: vencido ? ESTADO_REQUISITO.VENCIDO : ESTADO_REQUISITO.PENDIENTE,
            detalle: vencido ? 'El plazo venció sin documento cargado.' : 'Falta cargar el documento.',
        };
    }
    if (exigeFirma) {
        const faltan = firmasPendientes(doc);
        if (faltan > 0) {
            return { estado: ESTADO_REQUISITO.PARCIAL, detalle: `Documento cargado, ${faltan} firma(s) pendiente(s).` };
        }
    }
    return { estado: ESTADO_REQUISITO.CUMPLIDO, detalle: 'Documento cargado.' };
}

/**
 * Resumen agregado con las mismas reglas del motor: los que no penalizan salen
 * del denominador y `Parcial` cuenta medio punto.
 */
export function resumirCompletitud(requisitos: Array<{ estado: EstadoRequisito }>): ResumenCompletitud {
    const lista = requisitos || [];
    const porEstado = Object.fromEntries(
        Object.values(ESTADO_REQUISITO).map((e) => [e, 0])
    ) as Record<EstadoRequisito, number>;
    for (const r of lista) porEstado[r.estado] = (porEstado[r.estado] || 0) + 1;

    const exigibles = lista.filter((r) => !ESTADOS_NO_PENALIZAN.includes(r.estado));
    const puntaje = exigibles.reduce((n, r) => {
        if (r.estado === ESTADO_REQUISITO.CUMPLIDO) return n + 1;
        if (r.estado === ESTADO_REQUISITO.PARCIAL) return n + 0.5;
        return n;
    }, 0);

    return {
        total: lista.length,
        exigibles: exigibles.length,
        excluidos: lista.length - exigibles.length,
        cumplidos: porEstado[ESTADO_REQUISITO.CUMPLIDO],
        porEstado,
        progreso: exigibles.length > 0 ? Math.round((puntaje / exigibles.length) * 100) : 0,
    };
}
