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
    empresaId: string;
    obraId?: string | null;
    ubicacion?: string;
    asistentesRequeridos?: string[];
    asistentes: Attendee[];
    firmaRelator?: Signature;
    estado: 'programada' | 'en_curso' | 'completada' | 'cancelada';
    planificacion?: PlanificacionActividad | null;
    permisosTrabajo?: PermisoTrabajo[];
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

    registerAttendance: (id: string, data: AttendanceData) =>
        apiRequest<AttendanceResult>(`/activities/${id}/attendance`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getStats: (params?: StatsParams) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<ActivityStats>(`/activities/stats${query ? `?${query}` : ''}`);
    },

    /** Completar registro post-charla: SOLO planificacion y permisosTrabajo. */
    patch: (id: string, data: { planificacion?: PlanificacionActividad; permisosTrabajo?: PermisoTrabajo[]; solicitanteId?: string }) =>
        apiRequest<Activity>(`/activities/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
};
