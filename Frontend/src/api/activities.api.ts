import { apiRequest } from './client';
import type { Signature } from './signatures.api';

export interface Activity {
    activityId: string;
    tipo: string;
    tipoDescripcion: string;
    subtipo?: string | null;
    subtipoDescripcion?: string | null;
    titulo: string;
    descripcion?: string;
    fecha: string;
    horaInicio: string;
    horaFin?: string;
    relatorId: string;
    /** Responsables de la actividad (multi-asignación); relatorId = responsables[0]. */
    responsables?: string[];
    empresaId: string;
    obraId?: string | null;
    ubicacion?: string;
    asistentesRequeridos?: string[];
    asistentes: Attendee[];
    firmaRelator?: Signature;
    /** 'borrador' = planificada por esqueleto, pendiente de completar. */
    estado: 'borrador' | 'programada' | 'en_curso' | 'completada' | 'cancelada';
    planificacion?: PlanificacionActividad | null;
    permisosTrabajo?: PermisoTrabajo[];
    /** 'planificacion' = generada por el esqueleto; 'ad_hoc' = creada suelta. */
    origen?: 'planificacion' | 'ad_hoc' | null;
    /** Etapa constructiva del trabajo (obra_gruesa, terminaciones, etc). */
    tipoTrabajo?: string | null;
    /** Agrupa las ocurrencias generadas por un mismo esqueleto. */
    planId?: string | null;
    /** Campos que vinieron pre-llenados del esqueleto. */
    camposPrellenados?: string[];
    createdAt: string;
    updatedAt: string;
}

export interface Attendee {
    // El backend registra a los asistentes por personaId; workerId es el nombre
    // legacy y ya no viene en asistencias nuevas, por eso es opcional.
    workerId?: string;
    personaId?: string;
    nombre: string;
    rut: string;
    cargo: string;
    /** Firma registrada después de la hora programada de la charla. */
    atraso?: boolean;
    /** Minutos de atraso respecto de horaInicio (0 si no hubo atraso). */
    minutosAtraso?: number;
    firma: {
        token: string;
        fecha: string;
        horario: string;
        timestamp: string;
    };
}

export interface SeleccionCatalogo {
    codigos: string[];
    otro?: string | null;
}

export interface PlanificacionActividad {
    tema?: { codigo?: string | null; otro?: string | null } | null;
    recursos?: SeleccionCatalogo | null;
    riesgos?: SeleccionCatalogo | null;
    medidas?: SeleccionCatalogo | null;
    tipoTrabajo?: 'interior' | 'exterior' | null;
    condicionClimatica?: 'despejado' | 'parcial' | 'nublado' | 'lluvia' | null;
    /** Solo aplica cuando tipoTrabajo === 'exterior'; null en otro caso. */
    protectorSolar?: boolean | null;
    /** "Observaciones o participación y consulta" (Comité Paritario). */
    observaciones?: string;
}

export type PermisoTrabajoTipo = 'ALTURA' | 'ESPACIO_CONFINADO' | 'TRABAJO_CALIENTE';

export interface PermisoTrabajo {
    tipo: PermisoTrabajoTipo;
    responsableId: string;
    responsableNombre?: string;
    horaInicio: string;
    horaFin: string;
    ubicacion?: string;
    checklist: Record<string, 'si' | 'no' | 'na'>;
    /** Lo calcula el backend; el cliente solo lo muestra. */
    completo?: boolean;
}

export interface CreateActivityData {
    tipo: string;
    subtipo?: string;
    titulo: string;
    descripcion?: string;
    fecha?: string;
    horaInicio?: string;
    horaFin?: string;
    relatorId: string;
    empresaId?: string;
    obraId?: string | null;
    ubicacion?: string;
    asistentesRequeridos?: string[];
    /** Responsables adicionales (multi-asignación); el relator siempre queda incluido. */
    responsables?: string[];
    /** Etapa constructiva del trabajo (obra_gruesa, terminaciones, etc). */
    tipoTrabajo?: string;
    /** Periodicidad: 'unica' (default) o repetir hasta `repetirHasta`. */
    frecuencia?: 'unica' | 'diaria' | 'semanal' | 'mensual';
    repetirHasta?: string;
    planificacion?: PlanificacionActividad;
    permisosTrabajo?: PermisoTrabajo[];
}

export interface ActivityListParams {
    empresaId?: string;
    obraId?: string;
    tipo?: string;
    estado?: string;
    fecha?: string;
    relatorId?: string;
    /** Busca en responsables[] con fallback a relatorId. */
    responsableId?: string;
    planId?: string;
    tipoTrabajo?: string;
    /** Rango de fechas (para cargar el mes del calendario de una vez). */
    fechaDesde?: string;
    fechaHasta?: string;
}

/** Ítem del esqueleto de planificación mensual. */
export interface PlanItem {
    tipo: string;
    subtipo?: string;
    periodicidad: 'diaria' | 'semanal' | 'mensual';
    /** Etapa constructiva a la que aplica (obra_gruesa, terminaciones, etc). */
    tipoTrabajo?: string;
    /** Responsables de ESTE ítem (filtrado por corresponsalía). */
    responsables: string[];
    tituloBase?: string;
    /** Defaults que quedan pre-llenados en cada borrador. */
    camposPrellenados?: {
        horaInicio?: string;
        ubicacion?: string;
        descripcion?: string;
    };
}

export interface PlanData {
    obraId: string;
    rangoDesde: string;
    rangoHasta: string;
    solicitanteId: string;
    items: PlanItem[];
}

export interface PlanResult {
    planId: string;
    count: number;
    /** Duplicados omitidos por idempotencia (misma obra/fecha/tipo/responsable). */
    omitidas: number;
    activities: Activity[];
}

/**
 * Campos editables vía PATCH: completar borrador / editar contenido y/o el
 * registro post-charla (planificacion + permisosTrabajo). El backend congela el
 * contenido (salvo descripción) cuando ya hay firmas registradas.
 */
export interface PatchActivityData {
    solicitanteId: string;
    titulo?: string;
    descripcion?: string;
    ubicacion?: string;
    horaInicio?: string;
    horaFin?: string;
    fecha?: string;
    asistentesRequeridos?: string[];
    subtipo?: string;
    tipoTrabajo?: string;
    /** 'completada' = cierre explícito de la actividad (requiere firma + contenido). */
    estado?: 'borrador' | 'programada' | 'completada' | 'cancelada';
    planificacion?: PlanificacionActividad;
    permisosTrabajo?: PermisoTrabajo[];
}

export interface ActivityListResponse {
    activities: Activity[];
    types: Record<string, string>;
}

export interface AttendanceData {
    workerId?: string;
    workerIds?: string[];
    incluirFirmaRelator?: boolean;
    pin?: string;
}

export interface AttendanceResult {
    message: string;
    totalAsistentes: number;
    nuevosAsistentes: Attendee[];
    firmaRelator?: Signature;
}

export interface StatsParams {
    empresaId?: string;
    obraId?: string;
    fechaInicio?: string;
    fechaFin?: string;
}

export interface ActivityStats {
    total: number;
    completadas: number;
    programadas: number;
    canceladas: number;
    porTipo: Record<string, { nombre: string; total: number; completadas: number }>;
    totalAsistentes: number;
    promedioAsistentesPorActividad: number;
    porcentajeCumplimiento: number;
}

export const activitiesApi = {
    list: (params?: ActivityListParams) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<ActivityListResponse>(`/activities${query ? `?${query}` : ''}`);
    },

    get: (id: string) =>
        apiRequest<Activity>(`/activities/${id}`),

    create: (activity: CreateActivityData) =>
        apiRequest<Activity>('/activities', {
            method: 'POST',
            body: JSON.stringify(activity),
        }),

    /** Genera el esqueleto de planificación: borradores por (fecha × responsable). */
    plan: (data: PlanData) =>
        apiRequest<PlanResult>('/activities/plan', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    /**
     * Completa/edita una actividad: borrador → programada, contenido, y/o el
     * registro post-charla (planificacion + permisosTrabajo). Nunca toca firmas.
     */
    patch: (id: string, data: PatchActivityData) =>
        apiRequest<Activity>(`/activities/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        }),

    registerAttendance: (id: string, data: AttendanceData) =>
        apiRequest<AttendanceResult>(`/activities/${id}/attendance`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getStats: (params?: StatsParams) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<ActivityStats>(`/activities/stats${query ? `?${query}` : ''}`);
    },
};
