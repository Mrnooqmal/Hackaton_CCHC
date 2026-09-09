import type { Activity, Worker } from '../api/client';

export interface FilaAsistencia {
    personaId: string;
    nombre: string;
    cargo: string;
    asistio: boolean;
    hora: string | null;
    convocado: boolean;
    /** Firmó después de la hora programada de la charla. */
    atraso: boolean;
    /** Minutos de atraso respecto de la hora de inicio (0 si no hubo). */
    minutosAtraso: number;
}

// Chile (America/Santiago). Las firmas guardan el timestamp en UTC (FirmaService
// corre en Lambda con reloj UTC), pero horaInicio la ingresa el usuario en hora
// local. Para que la "hora de firma" y el atraso sean correctos, se convierte el
// timestamp a hora de Chile antes de compararlo/mostrarlo.
const CHILE_TZ = 'America/Santiago';

const horaChileDesdeISO = (iso?: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString('es-CL', { timeZone: CHILE_TZ, hour12: false, hour: '2-digit', minute: '2-digit' });
};

const hhmmAMin = (hora?: string | null): number | null => {
    if (typeof hora !== 'string') return null;
    const m = hora.match(/^(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};

const calcAtraso = (horaFirma: string | null, horaInicio?: string | null) => {
    const f = hhmmAMin(horaFirma);
    const p = hhmmAMin(horaInicio);
    if (f === null || p === null) return { atraso: false, minutosAtraso: 0 };
    const diff = f - p;
    return { atraso: diff > 0, minutosAtraso: diff > 0 ? diff : 0 };
};

/**
 * Cruza asistentesRequeridos × asistentes: cada requerido sale Sí/No; quien
 * firmó sin estar convocado aparece igual (asistió = sí, convocado = false).
 * Los asistentes guardan personaId (o workerId legacy).
 */
export function construirFilasAsistencia(activity: Activity, workers: Worker[]) {
    const firmadoPor = new Map<string, { hora: string | null; nombre: string; cargo: string; atraso: boolean; minutosAtraso: number }>();
    for (const a of activity.asistentes || []) {
        const id = (a as any).personaId || a.workerId;
        if (!id) continue;
        // Hora de firma en horario de Chile, derivada del timestamp (autoritativo).
        // Si no hay timestamp (datos muy antiguos), se cae al horario guardado.
        const horaLocal = horaChileDesdeISO(a.firma?.timestamp) || a.firma?.horario || null;
        // El atraso se recalcula acá (no se confía en el valor guardado, que pudo
        // computarse contra un horario UTC): compara la hora local con horaInicio.
        const { atraso, minutosAtraso } = a.firma?.timestamp
            ? calcAtraso(horaLocal, activity.horaInicio)
            : { atraso: !!a.atraso, minutosAtraso: a.minutosAtraso || 0 };
        firmadoPor.set(id, {
            hora: horaLocal,
            nombre: a.nombre,
            cargo: a.cargo || '',
            atraso,
            minutosAtraso,
        });
    }

    const filas: FilaAsistencia[] = [];
    const requeridosIds = activity.asistentesRequeridos || [];
    for (const id of requeridosIds) {
        const w = workers.find((x) => x.personaId === id);
        const firma = firmadoPor.get(id);
        filas.push({
            personaId: id,
            nombre: firma?.nombre || (w ? `${w.nombre} ${w.apellido || ''}`.trim() : id),
            cargo: firma?.cargo || w?.cargo || '',
            asistio: !!firma,
            hora: firma?.hora || null,
            convocado: true,
            atraso: firma?.atraso || false,
            minutosAtraso: firma?.minutosAtraso || 0,
        });
    }
    for (const [id, firma] of firmadoPor) {
        if (requeridosIds.includes(id)) continue;
        filas.push({ personaId: id, nombre: firma.nombre, cargo: firma.cargo, asistio: true, hora: firma.hora, convocado: false, atraso: firma.atraso, minutosAtraso: firma.minutosAtraso });
    }

    const requeridos = requeridosIds.length;
    const asistieron = filas.filter((f) => f.asistio).length;
    const porcentaje = requeridos > 0
        ? Math.round((filas.filter((f) => f.convocado && f.asistio).length / requeridos) * 100)
        : (asistieron > 0 ? 100 : 0);
    return { filas, requeridos, asistieron, porcentaje };
}

export interface EstadoEvaluacion {
    notaMinima: number;
    /** El respaldo está cargado. Es lo único que el sistema puede afirmar sin abrirlo. */
    tieneRespaldo: boolean;
    nombreArchivo: string | null;
    fileKey: string | null;
    subidoEn: string | null;
}

/**
 * Estado de la evaluación de aprendizaje de una capacitación.
 *
 * La plataforma no lee el documento ni conoce las notas: solo sabe que la
 * capacitación exige evaluación, con qué nota mínima, y si el respaldo con las
 * evaluaciones corregidas está cargado o falta. Mismo criterio con que `ptp.ts`
 * deriva el estado del Programa de Trabajo Preventivo sin abrir el PDF.
 *
 * Devuelve null si la actividad no exige evaluación.
 */
export function estadoEvaluacion(activity: Activity): EstadoEvaluacion | null {
    const cfg = activity.evaluacion;
    if (!cfg?.exigida || !cfg.notaMinima) return null;
    const r = cfg.respaldo || null;
    return {
        notaMinima: cfg.notaMinima,
        tieneRespaldo: Boolean(r?.fileKey),
        nombreArchivo: r?.nombre || null,
        fileKey: r?.fileKey || null,
        subidoEn: r?.subidoEn || null,
    };
}

export type EstadoDuracion = {
    /** Minutos que el decreto exige a esta capacitación. */
    minimoMin: number;
    /** Minutos declarados desde el certificado, o null si nadie los declaró. */
    declaradaMin: number | null;
    tieneRespaldo: boolean;
    nombreArchivo: string | null;
    fileKey: string | null;
    /** false solo cuando hay declaración y NO alcanza; null mientras no se declare. */
    cumple: boolean | null;
};

/**
 * Duración de una capacitación contra el mínimo del DS 44 (FUF 18 y 23):
 * 1 hora para el uso de EPP (Art. 13 inc. 3) y 8 horas para la capacitación en
 * prevención de riesgos (Art. 16 inc. 1 letra d).
 *
 * La plataforma NO cronometra la clase ni deduce las horas del reloj de la
 * actividad: la capacitación la puede dictar un OAL externo sin pasar por el
 * sistema, y `horaFin` se sobrescribe con la hora en que alguien cerró la
 * actividad. Se declara lo que dice el certificado y se custodia el certificado
 * — el mismo criterio de la evaluación de aprendizaje y del PTP.
 */
export function estadoDuracion(activity: Activity): EstadoDuracion | null {
    const cfg = (activity as { duracion?: {
        minimaMin?: number | null;
        declaradaMin?: number | null;
        respaldo?: { fileKey?: string; nombre?: string } | null;
    } }).duracion;
    if (!cfg?.minimaMin || cfg.minimaMin <= 0) return null;

    const declarada = cfg.declaradaMin ?? null;
    const r = cfg.respaldo || null;
    return {
        minimoMin: cfg.minimaMin,
        declaradaMin: declarada,
        tieneRespaldo: Boolean(r?.fileKey),
        nombreArchivo: r?.nombre || null,
        fileKey: r?.fileKey || null,
        cumple: declarada === null ? null : declarada >= cfg.minimaMin,
    };
}

/** "8 h" / "1 h 30 min" / "45 min" a partir de minutos. */
export function formatoDuracion(min?: number | null): string | null {
    if (min === null || min === undefined || min < 0) return null;
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m} min`;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Etiqueta legible de un código del catálogo (o el código, si no está). */
export const labelDe = (items: { codigo: string; label: string }[], codigo: string) =>
    items.find((i) => i.codigo === codigo)?.label || codigo;

/** Selección de catálogo → lista de etiquetas, con el "otro" al final. */
export const listaSeleccion = (
    sel: { codigos?: string[]; otro?: string | null } | null | undefined,
    items: { codigo: string; label: string }[],
) => {
    const parts = (sel?.codigos || []).map((c) => labelDe(items, c));
    if (sel?.otro) parts.push(`Otro: ${sel.otro}`);
    return parts;
};

export const CLIMA_LABEL: Record<string, string> = {
    despejado: 'Despejado',
    parcial: 'Parcialmente nublado',
    nublado: 'Nublado',
    lluvia: 'Lluvia',
};
