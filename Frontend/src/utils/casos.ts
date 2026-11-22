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

// ── Clasificación, medidas y cierre (fase 3) ──

/** Quien clasifica y cierra el caso. Es el valor de `PERMISSIONS`; una prueba del backend lo comprueba. */
export const PERMISO_CLASIFICAR = 'incidentes.calificar_accidente';
/** Quien reúne papeles y define medidas. */
export const PERMISO_GESTIONAR = 'incidentes.reportar';

export type EstadoMedida = 'pendiente' | 'en_proceso' | 'completada' | 'verificada';
export const ESTADOS_MEDIDA: EstadoMedida[] = ['pendiente', 'en_proceso', 'completada', 'verificada'];
export const medidaTerminada = (m?: { estado?: string } | null): boolean => m?.estado === 'completada' || m?.estado === 'verificada';

export type JerarquiaControl = 'eliminacion' | 'sustitucion' | 'ingenieria' | 'administrativa' | 'epp';
/** Niveles de la jerarquía de controles, del más eficaz al menos eficaz. */
export const JERARQUIA_CONTROL: JerarquiaControl[] = ['eliminacion', 'sustitucion', 'ingenieria', 'administrativa', 'epp'];
export const MAX_MEDIDAS_POR_CASO = 30;
export const MAX_TEXTO_MEDIDA = 500;

export type PasoDelCaso = 'clasificar' | 'papeles' | 'medidas' | 'cerrar' | 'cerrado';

export interface SiguientePaso {
    paso: PasoDelCaso;
    titulo: string;
    detalle: string;
    /** Permiso que necesita quien lo hace; null cuando ya no hay nada que hacer. */
    permiso: string | null;
}

/** Lo que las reglas de clasificación, medidas y cierre leen del incidente (además de `CasoParaPapeles`). */
export interface CasoParaPasos extends Omit<CasoParaPapeles, 'medidasCorrectivas'> {
    estado?: string;
    triaje?: unknown;
    medidasCorrectivas?: { numero?: number | string; medida?: string; estado?: string }[];
    gobernanza?: { responsableId?: string | null; plazoRespuestaISO?: string | null; comentarioCierre?: string | null; estadoCierre?: string | null } | null;
}

const medidasDe = (inc: CasoParaPasos) => (Array.isArray(inc?.medidasCorrectivas) ? inc.medidasCorrectivas : []);
const medidasSinTerminar = (inc: CasoParaPasos) => medidasDe(inc).filter((m) => !medidaTerminada(m));

/** Un hallazgo se cierra por su gobernanza y un incidente por su estado (como `utils/incidentes.ts`). */
export const estaCerrado = (inc?: CasoParaPasos | null): boolean => (esHallazgo(inc)
    ? inc?.gobernanza?.estadoCierre === 'cerrado' || inc?.estado === 'cerrado'
    : inc?.estado === 'cerrado');

const resumenMedida = (m?: { medida?: string } | null) => {
    const texto = String(m?.medida || '').trim();
    return texto.length > 60 ? `${texto.slice(0, 57)}…` : texto;
};

/**
 * Lo que falta para poder cerrar el caso, en frases listas para mostrar. Vacío = se
 * puede cerrar. `comentarioCierre` es el de la misma petición de cierre: en un
 * hallazgo cuenta como el papel "comentario de cierre", que solo existe al cerrar.
 */
export function pendientesDeCierre(incidente?: CasoParaPasos | null, comentarioCierre?: string | null): string[] {
    const inc: CasoParaPasos = incidente || {};
    const evaluado: CasoParaPasos = esHallazgo(inc) && hayTexto(comentarioCierre)
        ? { ...inc, gobernanza: { ...(inc.gobernanza || {}), comentarioCierre } }
        : inc;
    const faltas: string[] = [];
    if (!inc.triaje) faltas.push('Clasificar el reporte (tipo y gravedad).');
    for (const p of papelesRequeridos(evaluado as CasoParaPapeles)) {
        if (!p.cumplido) faltas.push(`Falta: ${p.etiqueta}.`);
    }
    for (const m of medidasSinTerminar(inc)) {
        const resumen = resumenMedida(m);
        faltas.push(`Una medida sigue sin completar${resumen ? `: ${resumen}` : ''}.`);
    }
    return faltas;
}

/**
 * Qué toca hacer ahora con el caso y a quién le toca: clasificar → papeles →
 * medidas → cerrar. Las razones del orden están en el original (lib/casos.js).
 */
export function siguientePaso(incidente?: CasoParaPasos | null): SiguientePaso {
    const inc: CasoParaPasos = incidente || {};
    if (estaCerrado(inc)) {
        return { paso: 'cerrado', titulo: 'Caso cerrado', detalle: 'El caso está cerrado y ya no admite cambios.', permiso: null };
    }
    const hallazgo = esHallazgo(inc);
    if (!inc.triaje) {
        return {
            paso: 'clasificar',
            titulo: 'Clasificar el reporte',
            detalle: hallazgo
                ? 'Confirmar que es un hallazgo y si es una condición o una acción subestándar.'
                : 'Confirmar el tipo de caso, la gravedad y si pudo haber sido más grave.',
            permiso: PERMISO_CLASIFICAR,
        };
    }
    const requeridos = papelesRequeridos(inc as CasoParaPapeles);
    const faltantes = requeridos.filter((p) => !p.cumplido && p.clave !== 'comentario_cierre' && p.clave !== 'medida_correctiva');
    if (faltantes.length > 0) {
        return {
            paso: 'papeles',
            titulo: 'Juntar los papeles del caso',
            detalle: `Falta: ${faltantes.map((p) => p.etiqueta).join('; ')}.`,
            permiso: PERMISO_GESTIONAR,
        };
    }
    if (requeridos.some((p) => p.clave === 'medida_correctiva' && !p.cumplido)) {
        return {
            paso: 'medidas',
            titulo: 'Definir las medidas correctivas',
            detalle: 'Agregar al menos una medida con responsable y plazo.',
            permiso: PERMISO_GESTIONAR,
        };
    }
    const sinTerminar = medidasSinTerminar(inc).length;
    if (sinTerminar > 0) {
        return {
            paso: 'medidas',
            titulo: 'Completar las medidas',
            detalle: sinTerminar === 1 ? 'Queda 1 medida sin completar.' : `Quedan ${sinTerminar} medidas sin completar.`,
            permiso: PERMISO_GESTIONAR,
        };
    }
    return {
        paso: 'cerrar',
        titulo: 'Cerrar el caso',
        detalle: hallazgo ? 'Todo está al día. Falta cerrarlo con un comentario de cierre.' : 'Papeles y medidas completos. Falta cerrarlo con un comentario de cierre.',
        permiso: PERMISO_CLASIFICAR,
    };
}
