/**
 * Los papeles de un caso: qué documentos y qué datos exige cada tipo de reporte,
 * y cuánto falta (fase 2 del rediseño de incidentes).
 *
 * ESPEJO de Backend/lib/casos.js — mantener sincronizados. Una prueba del
 * backend (tests/casos.test.js) corre los dos con los mismos casos y exige que
 * den lo mismo. Las reglas y su porqué están explicadas en el original.
 */

export type TipoPapel = 'diat' | 'diep' | 'informe_investigacion' | 'constancia_aviso_autoridad' | 'otro';

/** `salud`: el documento trae datos de salud; su descarga queda auditada. */
export const TIPOS_PAPEL: Record<TipoPapel, { etiqueta: string; salud: boolean }> = {
    diat: { etiqueta: 'DIAT (denuncia individual de accidente del trabajo)', salud: true },
    diep: { etiqueta: 'DIEP (denuncia individual de enfermedad profesional)', salud: true },
    informe_investigacion: { etiqueta: 'Informe de investigación', salud: false },
    constancia_aviso_autoridad: { etiqueta: 'Constancia del aviso a la Inspección del Trabajo y a la SEREMI de Salud', salud: false },
    otro: { etiqueta: 'Otro respaldo', salud: false },
};

/** Orden en que se ofrecen en pantalla. */
export const ORDEN_TIPOS_PAPEL: TipoPapel[] = ['diat', 'diep', 'informe_investigacion', 'constancia_aviso_autoridad', 'otro'];

export const esTipoPapel = (tipo: unknown): tipo is TipoPapel =>
    typeof tipo === 'string' && Object.prototype.hasOwnProperty.call(TIPOS_PAPEL, tipo);
export const etiquetaTipoPapel = (tipo: unknown): string => (esTipoPapel(tipo) ? TIPOS_PAPEL[tipo].etiqueta : 'Documento');
export const tipoPapelConSalud = (tipo: unknown): boolean => esTipoPapel(tipo) && TIPOS_PAPEL[tipo].salud;

// ── Archivos aceptados ──

export const EXTENSION_POR_MIME: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};
export const MIME_PAPELES: string[] = Object.keys(EXTENSION_POR_MIME);
/** 15 MB. */
export const MAX_BYTES_PAPEL = 15 * 1024 * 1024;
/** Tope de archivos por caso. */
export const MAX_PAPELES_POR_CASO = 30;

// ── Qué exige cada caso ──

/** Lo que estas reglas leen del incidente. `papeles` es la lista de archivos subidos al caso. */
export interface CasoParaPapeles {
    tipo?: string;
    clasificacion?: string;
    gravedad?: string;
    /** Lo agrega la fase 3 (triaje); ausente cuenta como no requerido. */
    altoPotencial?: boolean;
    evidencias?: unknown[];
    gobernanza?: { responsableId?: string | null; plazoRespuestaISO?: string | null; comentarioCierre?: string | null } | null;
    medidasCorrectivas?: unknown[];
    papeles?: { tipo?: string }[];
}

export interface PapelRequerido {
    clave: string;
    etiqueta: string;
    cumplido: boolean;
    /** Tipo de archivo que lo cumple; null si se cumple con un dato del reporte. */
    tipoDocumento: TipoPapel | null;
}

export interface AvanceDelCaso {
    cumplidos: number;
    total: number;
    porcentaje: number;
}

const HALLAZGOS = ['condicion_subestandar', 'accion_subestandar'];

/** Los incidentes anteriores a la clasificación no la tienen: se deriva del tipo. */
export const esHallazgo = (inc?: CasoParaPapeles | null): boolean =>
    (inc?.clasificacion ? inc.clasificacion === 'hallazgo' : HALLAZGOS.includes(inc?.tipo ?? ''));

const hayTexto = (v: unknown) => typeof v === 'string' && v.trim() !== '';
const hayLista = (v: unknown) => Array.isArray(v) && v.length > 0;
const hayPapel = (inc: CasoParaPapeles, tipo: TipoPapel) => Array.isArray(inc.papeles) && inc.papeles.some((p) => p?.tipo === tipo);

/**
 * Papeles que el caso exige, cada uno con si ya está cumplido.
 *
 * Hallazgo: foto, responsable y plazo, comentario de cierre. Incidente: informe
 * de investigación solo si `altoPotencial === true`. Accidente: DIAT, informe y
 * una medida correctiva; si es grave o fatal, además la constancia del aviso a
 * la autoridad. La DIEP no se exige en ningún caso (no existe el tipo
 * "enfermedad profesional" en el modelo): queda disponible para subir.
 */
export function papelesRequeridos(incidente?: CasoParaPapeles | null): PapelRequerido[] {
    const inc = incidente || {};
    const lista: PapelRequerido[] = [];
    const exigir = (clave: string, etiqueta: string, cumplido: boolean, tipoDocumento: TipoPapel | null = null) =>
        lista.push({ clave, etiqueta, cumplido: Boolean(cumplido), tipoDocumento });

    if (esHallazgo(inc)) {
        exigir('foto', 'Al menos una foto del hallazgo', hayLista(inc.evidencias));
        exigir('responsable_plazo', 'Responsable y plazo', Boolean(inc.gobernanza?.responsableId) && Boolean(inc.gobernanza?.plazoRespuestaISO));
        exigir('comentario_cierre', 'Comentario de cierre', hayTexto(inc.gobernanza?.comentarioCierre));
        return lista;
    }

    const informe = () => exigir('informe_investigacion', etiquetaTipoPapel('informe_investigacion'), hayPapel(inc, 'informe_investigacion'), 'informe_investigacion');

    if (inc.tipo === 'accidente') {
        exigir('diat', 'DIAT', hayPapel(inc, 'diat'), 'diat');
        informe();
        exigir('medida_correctiva', 'Al menos una medida correctiva', hayLista(inc.medidasCorrectivas));
        if (inc.gravedad === 'grave' || inc.gravedad === 'fatal') {
            exigir('constancia_aviso_autoridad', 'Constancia del aviso a la Inspección del Trabajo y a la SEREMI de Salud',
                hayPapel(inc, 'constancia_aviso_autoridad'), 'constancia_aviso_autoridad');
        }
        return lista;
    }

    if (inc.altoPotencial === true) informe();
    return lista;
}

/**
 * Avance: papeles cumplidos sobre los requeridos. Sin papeles requeridos
 * (`total` 0) el porcentaje es 100: no hay nada pendiente. La pantalla debe decir
 * "no exige papeles" en ese caso, no "0 de 0".
 */
export function avanceDelCaso(incidente?: CasoParaPapeles | null): AvanceDelCaso {
    const requeridos = papelesRequeridos(incidente);
    const total = requeridos.length;
    const cumplidos = requeridos.filter((p) => p.cumplido).length;
    return { cumplidos, total, porcentaje: total === 0 ? 100 : Math.round((cumplidos / total) * 100) };
}
