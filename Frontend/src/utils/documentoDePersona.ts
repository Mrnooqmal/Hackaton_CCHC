type Asignacion = { personaId?: string; estado?: string; fechaFirma?: string | null; reutilizado?: boolean };

export type DocumentoFirmable = {
    tipo?: string;
    obraId?: string | null;
    clasificacion?: string;
    asignaciones?: Asignacion[];
    firmas?: unknown[];
    firmaRelator?: { estado?: string } | null;
};

export const tieneFirmas = (doc: DocumentoFirmable | null | undefined): boolean => Boolean(doc?.firmas?.length)
    || doc?.firmaRelator?.estado === 'firmado'
    || Boolean(doc?.asignaciones?.some((a) => (a.estado === 'firmado' || a.fechaFirma) && !a.reutilizado));

const CLASIFICACIONES_DE_COPIA = ['diario', 'empresa'];

export const esCopiaDe = (doc: DocumentoFirmable, personaId: string): boolean => CLASIFICACIONES_DE_COPIA.includes(doc.clasificacion || 'diario')
    && doc.asignaciones?.length === 1 && doc.asignaciones[0].personaId === personaId;

export function copiaDePersona<D extends DocumentoFirmable>(
    documentos: D[], { personaId, tipo, obraId }: { personaId: string; tipo: string; obraId?: string | null },
): D | undefined {
    const copias = documentos.filter((d) => d.tipo === tipo && esCopiaDe(d, personaId)
        && (!obraId || !d.obraId || d.obraId === obraId));
    return copias.find((d) => d.obraId === obraId) || copias[0];
}

export const AVISO_REEMPLAZO_FIRMADO = 'Este documento ya tiene firmas. Quedan guardadas con la versión anterior y todas las personas asignadas deberán firmar de nuevo. ¿Reemplazar el archivo?';
