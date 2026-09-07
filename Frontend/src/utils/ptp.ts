/**
 * Programa de Trabajo Preventivo (PTP) — DS 44 Art. 8.
 *
 * ESPEJO de Backend/lib/ptp.js — mantener ambos sincronizados.
 *
 * El PTP lo redacta la empresa y se sube al repositorio de la obra como
 * cualquier otro documento normativo: la plataforma lo guarda, lo asigna y lo
 * hace firmar, pero no lo genera ni conoce su contenido. Lo único que el sistema
 * sí puede afirmar sobre él son dos hechos verificables: si llegó dentro del
 * plazo de 30 días desde la MIPER, y si lo firmó el representante legal.
 */

/** Plazo del Art. 8 inc. 1: días corridos desde que se confecciona/actualiza la MIPER. */
export const PLAZO_PTP_DIAS = 30;

export type PtpEstadoClave = 'sin_miper' | 'faltante' | 'desactualizado' | 'vigente';

export interface PtpEstado {
    estado: PtpEstadoClave;
    dias: number | null;
    diasRestantes: number | null;
    vencido: boolean;
    detalle: string;
}

/** Documento de obra, con los campos que el plazo y la aprobación necesitan. */
export interface DocumentoRef {
    s3Key?: string | null;
    archivoUrl?: string | null;
    publicadaEn?: string | null;
    updatedAt?: string | null;
    createdAt?: string | null;
    firmas?: { personaId?: string }[];
}

export function diasCorridosDesde(iso?: string | null, ahora: Date = new Date()): number | null {
    if (!iso) return null;
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) return null;
    return Math.floor((ahora.getTime() - fecha.getTime()) / 86400000);
}

/** Fecha en que un documento quedó en su estado actual (última publicación). */
const fechaDocumento = (doc?: DocumentoRef | null) =>
    doc?.publicadaEn || doc?.updatedAt || doc?.createdAt || null;

/** ¿El documento existe y tiene archivo cargado? Sin archivo no hay documento. */
const tieneArchivo = (doc?: DocumentoRef | null) => Boolean(doc && (doc.s3Key || doc.archivoUrl));

/**
 * Estado del PTP frente al plazo del Art. 8. Se DERIVA de las fechas de los dos
 * documentos, sin campos declarados: nadie tiene que decir "este PTP viene de la
 * MIPER v2", porque el sistema no puede leer el PDF para verificarlo.
 *
 * La regla es simple y comprobable: si la MIPER se revisó después de la última
 * versión del PTP, el PTP quedó atrás y el plazo corre desde esa revisión.
 */
export function estadoPtp(
    ptpDoc: DocumentoRef | null,
    miperDoc: DocumentoRef | null,
    ahora: Date = new Date(),
): PtpEstado {
    const sinMiper: PtpEstado = {
        estado: 'sin_miper', dias: null, diasRestantes: null, vencido: false,
        detalle: 'El plazo empieza a correr cuando se carga la MIPER.',
    };
    if (!tieneArchivo(miperDoc)) return sinMiper;

    const fechaMiper = fechaDocumento(miperDoc);
    if (!fechaMiper) return sinMiper;

    const conPlazo = (detalle: string) => {
        const dias = diasCorridosDesde(fechaMiper, ahora);
        return {
            dias,
            diasRestantes: dias === null ? null : PLAZO_PTP_DIAS - dias,
            vencido: dias !== null && dias > PLAZO_PTP_DIAS,
            detalle,
        };
    };

    if (!tieneArchivo(ptpDoc)) {
        return { estado: 'faltante', ...conPlazo('Hay MIPER pero todavía no se ha cargado el programa de trabajo.') };
    }

    const fechaPtp = fechaDocumento(ptpDoc);
    if (fechaPtp && new Date(fechaPtp) < new Date(fechaMiper)) {
        return {
            estado: 'desactualizado',
            ...conPlazo('La MIPER se revisó después de la última versión del programa de trabajo.'),
        };
    }

    return {
        estado: 'vigente', dias: null, diasRestantes: null, vencido: false,
        detalle: 'El programa de trabajo es posterior a la última revisión de la MIPER.',
    };
}

/**
 * ¿Está aprobado por el representante legal (Art. 8 inc. 1)? Es la firma real
 * sobre el documento, no una declaración: se busca al representante legal
 * designado entre los firmantes del PTP.
 */
export function aprobadoPorRepresentanteLegal(
    ptpDoc: DocumentoRef | null,
    representanteLegal?: { personaId?: string } | null,
): boolean {
    if (!representanteLegal?.personaId) return false;
    return (ptpDoc?.firmas || []).some((f) => f.personaId === representanteLegal.personaId);
}

/** Etiqueta corta del plazo, para la fila del documento en la ficha de obra. */
export function etiquetaEstadoPtp(e: PtpEstado): string | null {
    if (e.estado === 'sin_miper') return null;
    if (e.estado === 'vigente') return 'Dentro de plazo';
    if (e.vencido) {
        return e.estado === 'faltante'
            ? `Vencido · ${e.dias} días desde la MIPER`
            : `Vencido · ${e.dias} días desde la revisión`;
    }
    return `Quedan ${e.diasRestantes} días de plazo`;
}
