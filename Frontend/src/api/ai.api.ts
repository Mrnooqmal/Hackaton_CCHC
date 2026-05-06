import { apiRequest } from './client';

// ========================================
// AI TYPES
// ========================================
export interface MIPERPeligro {
    id: number;
    peligro: string;
    riesgo: string;
    actividad: string;
    probabilidad: 'A' | 'M' | 'B';
    consecuencia: '1' | '2' | '3' | '4';
    nivelRiesgo: 'Crítico' | 'Alto' | 'Medio' | 'Bajo';
    medidasControl: string[];
    epp: string[];
    responsable: string;
    verificacion: string;
}

export interface MIPERResult {
    cargo: string;
    fecha: string;
    actividades: string[];
    peligros: MIPERPeligro[];
    resumen: {
        totalPeligros: number;
        criticos: number;
        altos: number;
        medios: number;
        bajos: number;
    };
    recomendacionesPrioritarias: string[];
    _fallback?: boolean;
}

export interface RiskMatrixRiesgo {
    id: number;
    peligro: string;
    riesgo: string;
    probabilidad: 'Alta' | 'Media' | 'Baja';
    consecuencia: 'Grave' | 'Moderada' | 'Leve';
    nivelRiesgo: 'Crítico' | 'Alto' | 'Medio' | 'Bajo';
    medidasExistentes: string[];
    medidasAdicionales: string[];
    responsable: string;
    plazo: string;
}

export interface RiskMatrixResult {
    titulo: string;
    fecha: string;
    riesgos: RiskMatrixRiesgo[];
    recomendaciones: string[];
    _fallback?: boolean;
}

export interface PreventionPlanResult {
    titulo: string;
    periodo: string;
    objetivos: string[];
    actividades: { actividad: string; frecuencia: string; responsable: string }[];
    capacitaciones: string[];
    inspecciones?: { tipo: string; frecuencia: string; responsable: string }[];
    epp?: string[];
    indicadores: { nombre: string; meta: string; formula: string }[];
    procedimientosEmergencia?: string[];
    cronograma?: { semana: number; actividades: string[] }[];
    _fallback?: boolean;
}

export interface IncidentAnalysisResult {
    resumenIncidente: string;
    arbolDeCausas: {
        hecho: string;
        causasInmediatas: {
            actosSubestandar: string[];
            condicionesSubestandar: string[];
        };
        causasBasicas: {
            factoresPersonales: string[];
            factoresTrabajo: string[];
        };
        faltaControl: string[];
    };
    clasificacion: {
        tipo: string;
        gravedad: string;
        potencial: string;
    };
    accionesCorrectivas: { accion: string; responsable: string; plazo: string; prioridad: string }[];
    accionesPreventivas: { accion: string; responsable: string; plazo: string }[];
    leccionesAprendidas: string[];
    capacitacionRequerida: string[];
    _fallback?: boolean;
}

export interface ExtractedIncident {
    tipo: 'incidente' | 'accidente' | 'condicion_subestandar';
    centroTrabajo: string;
    trabajador: {
        nombre: string;
        rut: string;
    };
    descripcion: string;
    gravedad: 'leve' | 'grave' | 'fatal';
    medidasInmediatas: string[];
    _source?: string;
}

export interface DailyTalkResult {
    titulo: string;
    duracion: string;
    contenido: {
        introduccion: string;
        puntosClaves: string[];
        ejemplos: string[];
        buenasPracticas?: string[];
        conclusion: string;
        preguntas: string[];
    };
    materialesApoyo?: string[];
    normativaRelacionada?: string[];
    _fallback?: boolean;
}

export interface ChatResponse {
    respuesta: string;
    timestamp: string;
    _fallback?: boolean;
}

// ========================================
// AI API
// ========================================
export const aiApi = {
    chat: (mensaje: string, contexto?: object) =>
        apiRequest<ChatResponse>('/ai/chat', {
            method: 'POST',
            body: JSON.stringify({ mensaje, contexto }),
        }),

    generateMIPER: (cargo: string, actividades: string[] = [], contexto?: string, empresaId?: string) =>
        apiRequest<MIPERResult>('/ai/miper', {
            method: 'POST',
            body: JSON.stringify({ cargo, actividades, contexto, empresaId }),
        }),

    generateRiskMatrix: (actividad: string, descripcion?: string, ubicacion?: string) =>
        apiRequest<RiskMatrixResult>('/ai/risk-matrix', {
            method: 'POST',
            body: JSON.stringify({ actividad, descripcion, ubicacion }),
        }),

    generatePreventionPlan: (obra: string, riesgos: string[] = [], duracion?: string) =>
        apiRequest<PreventionPlanResult>('/ai/prevention-plan', {
            method: 'POST',
            body: JSON.stringify({ obra, riesgos, duracion }),
        }),

    generateDailyTalk: (tema: string, contexto?: string) =>
        apiRequest<DailyTalkResult>('/ai/daily-talk', {
            method: 'POST',
            body: JSON.stringify({ tema, contexto }),
        }),

    analyzeIncident: (descripcion: string, contexto?: { tipo?: string; gravedad?: string; area?: string }) =>
        apiRequest<IncidentAnalysisResult>('/ai/analyze-incident', {
            method: 'POST',
            body: JSON.stringify({ descripcion, ...contexto }),
        }),

    extractIncident: (texto: string) =>
        apiRequest<ExtractedIncident>('/ai/extract-incident', {
            method: 'POST',
            body: JSON.stringify({ texto }),
        }),

    transcribeAudio: (audio: string, mimeType: string) =>
        apiRequest<{ text: string }>('/ai/transcribe', {
            method: 'POST',
            body: JSON.stringify({ audio, mimeType }),
        }),
};
