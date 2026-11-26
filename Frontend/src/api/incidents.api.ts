import { apiRequest } from './client';
import { huellaSha256, headersDeSubida } from '../utils/huellaArchivo';
import type { Worker } from './workers.api';
import type { AvanceDelCaso, EstadoMedida, PapelRequerido, SiguientePaso, TipoPapel } from '../utils/casos';

export interface IncidentLocation {
    lat: number;
    lng: number;
    accuracy?: number;
    source?: 'geolocalizacion' | 'manual';
    timestamp?: number;
}

export interface IncidentEvidencePreview {
    key: string;
    url?: string;
}

// Gobernanza de hallazgos (reunion 2026-06-10): responsable, plazo y cierre verificado.
export interface HallazgoGobernanza {
    responsableId: string | null;
    responsableNombre: string | null;
    plazoRespuestaISO: string | null;
    estadoCierre: 'abierto' | 'en_proceso' | 'cerrado';
    verificadoPor: string | null;
    fechaVerificacion: string | null;
    comentarioCierre: string | null;
}

// Reporte flash: datos minimos al momento del registro, editable en investigacion.
// esFlash y segunInformacionDisponible son inmutables (trazabilidad).
export interface ReporteFlash {
    esFlash: boolean;
    segunInformacionDisponible: boolean;
    afectados: { nombre: string; rut: string | null; cargo: string | null }[];
    descripcionBreve: string;
    severidad: 'leve' | 'grave' | 'fatal';
    evidencias: string[];
    ubicacionReferencia: string;
    creadoEn: string;
    editadoEn: string | null;
}

/**
 * Una medida correctiva guardada antes de que se definieran con el plan de medidas correctivas
 * (Art. 71). Ya no se crean: el caso las muestra solo para consulta, y la obra sigue listándolas.
 * Las anteriores a la fase 3 pueden no traer `jerarquia`.
 */
export interface MedidaCorrectiva {
    numero: number | string;
    causaRaiz: string;
    medida: string;
    responsableId: string | null;
    responsableNombre: string;
    fechaMaxEjecucion: string | null;
    estado: EstadoMedida;
    jerarquia?: string | null;
}

/** La clasificación del caso: lo que confirmó quien la hizo, y las anteriores. */
export interface TriajeDelCaso {
    tipo: Incident['tipo'];
    clasificacion: 'hallazgo' | 'incidente';
    /** Solo en incidentes y accidentes. */
    gravedad: 'leve' | 'grave' | 'fatal' | null;
    /** Solo en incidentes. */
    danoMayor: boolean | null;
    granSusto: boolean | null;
    clasificadoPor: string;
    clasificadoEn: string;
    anteriores: Array<Partial<TriajeDelCaso> & { origen?: 'reporte' }>;
}

export interface Incident {
    incidentId: string;
    obraId?: string;
    tenantId?: string;
    tipo: 'accidente' | 'incidente' | 'condicion_subestandar' | 'accion_subestandar';
    clasificacion?: 'hallazgo' | 'incidente';
    gobernanza?: HallazgoGobernanza | null;
    reporteFlash?: ReporteFlash | null;
    centroTrabajo: string;
    etapaConstructiva?: string;
    // Nombre para la tabla en pantalla. Viaja siempre, también en el listado.
    trabajadorNombre?: string;
    // Datos personales del accidentado: RUT, género y cargo. **Solo vienen en el
    // detalle** (`GET /incidents/{id}`), porque en el servidor viven en un
    // elemento aparte que ningún índice contiene. En el listado es `undefined`:
    // usa `trabajadorNombre`.
    trabajador?: {
        nombre: string;
        rut: string;
        genero: string;
        cargo: string;
    };
    realizadoPor?: {
        /** Lo pone el servidor desde la sesión; si el cliente lo manda, se ignora. */
        personaId?: string | null;
        nombre: string;
        cargo: string;
    };
    fecha: string;
    hora: string;
    descripcion: string;
    // Qué se hizo en el momento para contener el riesgo. Vacío en los reportes
    // anteriores al campo (fase 1 del rediseño).
    medidasInmediatas?: string;
    gravedad: 'leve' | 'grave' | 'fatal';
    diasPerdidos?: number;
    evidencias: string[];
    // Medidas del caso (Art. 71); cuenta como papel en `utils/casos`.
    medidasCorrectivas?: MedidaCorrectiva[];
    // Lo agrega el triaje: un incidente de alto potencial exige informe de investigación.
    altoPotencial?: boolean;
    // Ausente mientras el caso no se clasifica.
    triaje?: TriajeDelCaso | null;
    cierre?: { comentario: string; cerradoPor: string; cerradoEn: string } | null;
    // Solo en `GET /incidents/{id}`: lo calcula el servidor con los papeles reales (el cliente no los recibe).
    siguientePaso?: SiguientePaso;
    avance?: AvanceDelCaso;
    investigaciones: {
        prevencionista?: Investigation;
        jefeDirecto?: Investigation;
        comiteParitario?: Investigation;
    };
    estado: 'reportado' | 'en_investigacion' | 'cerrado';
    reportadoPor: string;
    viewedBy?: string[];
    createdAt: string;
    updatedAt: string;
    evidencePreviews?: IncidentEvidencePreview[];
    ubicacion?: IncidentLocation;
}

export interface Investigation {
    investigador: string;
    rolInvestigador: 'prevencionista' | 'jefe_directo' | 'comite_paritario';
    fecha: string;
    hallazgos: string;
    recomendaciones: string;
    medidas: string[];
    estado: 'pendiente' | 'completada';
}

export interface CreateIncidentData {
    tipo: 'accidente' | 'incidente' | 'condicion_subestandar' | 'accion_subestandar';
    obraId?: string;
    centroTrabajo: string;
    // Quien reporta (el backend valida rol para clasificacion 'incidente')
    solicitanteId?: string;
    // Reporte flash (solo clasificacion 'incidente')
    esFlash?: boolean;
    afectados?: { nombre: string; rut?: string | null; cargo?: string | null }[];
    descripcionBreve?: string;
    ubicacionReferencia?: string;
    // Gobernanza inicial del hallazgo
    responsableId?: string;
    responsableNombre?: string;
    plazoRespuestaISO?: string;
    trabajador: {
        nombre: string;
        rut: string;
        genero: string;
        cargo: string;
    };
    fecha?: string;
    hora?: string;
    descripcion: string;
    // Opcional, hasta MAX_MEDIDAS_INMEDIATAS caracteres (el backend corta lo demás).
    medidasInmediatas?: string;
    gravedad?: 'leve' | 'grave' | 'fatal';
    diasPerdidos?: number;
    evidencias?: string[];
    reportadoPor?: string;
    tenantId?: string;
    empresaId?: string;
    clasificacion?: 'hallazgo' | 'incidente';
    tipoHallazgo?: 'accion' | 'condicion';
    etapaConstructiva?: string;
    ubicacion?: IncidentLocation;
}

export interface UpdateIncidentData {
    // Sin `estado`: el servidor lo rechaza (cambia al clasificar, cerrar o reabrir el caso).
    investigacionPrevencionista?: Omit<Investigation, 'fecha'>;
    investigacionJefeDirecto?: Omit<Investigation, 'fecha'>;
    investigacionComiteParitario?: Omit<Investigation, 'fecha'>;
    diasPerdidos?: number;
    // Sin `evidencias`: el servidor no las acepta por esta vía. Las fotos se agregan con `agregarEvidencias`.
    medidasInmediatas?: string;
    ubicacion?: IncidentLocation;
}

/** El tope de las medidas inmediatas es el mismo que aplica el backend: vive en `utils/casos`, espejo de lib/casos.js. */
export { MAX_MEDIDAS_INMEDIATAS } from '../utils/casos';

export interface AddInvestigationData {
    tipo: 'prevencionista' | 'jefe_directo' | 'comite_paritario';
    hallazgos: string;
    recomendaciones: string;
    medidas: string[];
}

/** Un archivo subido a la carpeta del caso (DIAT, DIEP, informe…). Sin la clave de S3 ni enlace: el enlace se pide aparte (`getEnlacePapel`). */
export interface PapelDelCaso {
    papelId: string;
    tipo: TipoPapel;
    nombreArchivo: string;
    tipoMime: string;
    /** `null` en un papel guardado con el contrato anterior (la DIAT y la DIEP de antes). */
    subidoPor: string | null;
    subidoEn: string | null;
    /** Fecha que declaró quien subió el archivo (por ejemplo, la de la DIAT); AAAA-MM-DD. */
    fechaDocumento: string | null;
    /** `null` en un papel guardado con el contrato anterior: no se midió. */
    tamano: number | null;
    /** El papel venía guardado con el contrato anterior (`documentos.diat`/`diep`): se ve y cuenta igual. */
    legado?: boolean;
    anulado?: { anuladoEn: string; anuladoPor: string; motivo: string };
    firmado?: boolean;
    /** La DIAT y la DIEP traen datos de salud: su descarga queda auditada. */
    contieneSalud: boolean;
}

export interface PapelesDelCaso {
    archivos: PapelDelCaso[];
    informeNoDisponible?: boolean;
    requeridos: PapelRequerido[];
    avance: AvanceDelCaso;
}

/**
 * Un caso de la obra visto sin sus datos: lo que entrega `GET /incidents/casos-resumen`
 * (fase 4). No trae nombres, RUT, relato, archivos ni claves de S3; para eso está el
 * detalle del caso y su descarga auditada.
 */
export interface CasoResumen {
    incidentId: string;
    tipo: Incident['tipo'] | null;
    clasificacion: 'hallazgo' | 'incidente';
    /** `null` en un hallazgo. */
    gravedad: 'leve' | 'grave' | 'fatal' | null;
    /** AAAA-MM-DD */
    fecha: string | null;
    estado: 'abierto' | 'cerrado';
    clasificado: boolean;
    avance: AvanceDelCaso;
    /** Los papeles que el caso exige, sin tipo de archivo. */
    requeridos: Pick<PapelRequerido, 'clave' | 'etiqueta' | 'cumplido'>[];
    informeInvestigacion: boolean;
}

export interface SubirPapelData {
    /** De él sale la huella SHA-256 que exige el bucket de evidencia. */
    archivo: File;
    tipo: TipoPapel;
    /** AAAA-MM-DD, opcional. */
    fechaDocumento?: string;
}

/** Lo que confirma el prevencionista al clasificar. */
export interface ClasificarData {
    tipo: Incident['tipo'];
    /** Solo incidentes y accidentes. */
    gravedad?: 'leve' | 'grave' | 'fatal';
    /** Solo incidentes: ¿pudo causar un daño mayor o la muerte? */
    danoMayor?: boolean;
    /** Solo incidentes: ¿generó un gran susto en los testigos? */
    granSusto?: boolean;
    /** Solo hallazgos: quién lo corrige y en qué plazo (AAAA-MM-DD). */
    responsableId?: string;
    plazoRespuestaISO?: string;
}

export interface AnalyticsData {
    periodo: string;
    distribucionPorTipo: {
        accidentes: number;
        incidentes: number;
        condicionesSubestandar: number;
    };
    distribucionPorGravedad: {
        leve: number;
        grave: number;
        fatal: number;
    };
    tendencias: Array<{
        mes: string;
        total: number;
        accidentes: number;
        incidentes: number;
    }>;
    porCentroTrabajo: Array<{
        centro: string;
        total: number;
        tasa: number;
    }>;
}

export interface IncidentListParams {
    tenantId?: string;
    obraId?: string;
    tipo?: string;
    estado?: string;
    fechaInicio?: string;
    fechaFin?: string;
}

export interface UploadEvidenceData {
    /** De él sale la huella SHA-256 que exige el bucket de evidencia. */
    archivo: Blob;
    fileName: string;
    fileType: string;
    incidentId?: string;
}

export interface UploadEvidenceResponse {
    /** Headers que el PUT a `uploadUrl` tiene que llevar tal cual (incluye la huella). */
    uploadHeaders: Record<string, string>;
    uploadUrl: string;
    s3Key: string;
    fileUrl: string;
}

export interface IncidentStats {
    mes: string;
    masaLaboral: number;
    numeroAccidentes: number;
    diasPerdidos: number;
    tasaAccidentabilidad: number;
    siniestralidad: number;
    tasaFrecuencia: number;
    porTipo: {
        accidentes: number;
        incidentes: number;
        condicionesSubestandar: number;
    };
    porGravedad: {
        leve: number;
        grave: number;
        fatal: number;
    };
    totalIncidentes: number;
}

export interface IncidentStatsParams {
    tenantId?: string;
    obraId?: string;
    mes?: string;
    masaLaboral?: number;
}

export const incidentsApi = {
    create: (data: CreateIncidentData) =>
        apiRequest<Incident>('/incidents', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    list: (params?: IncidentListParams) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<Incident[]>(`/incidents${query ? `?${query}` : ''}`);
    },

    get: (id: string) =>
        apiRequest<Incident>(`/incidents/${id}`),

    update: (id: string, data: UpdateIncidentData) =>
        apiRequest<Incident>(`/incidents/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    // Adjunta fotos ya subidas a S3. Solo agrega claves, y la puede usar quien
    // reportó el caso aunque no tenga `incidentes.reportar` (el PUT de arriba
    // sí lo exige, y por eso las fotos de un trabajador se perdían).
    agregarEvidencias: (id: string, evidencias: string[]) =>
        apiRequest<{ evidencias: string[] }>(`/incidents/${id}/evidencias`, {
            method: 'POST',
            body: JSON.stringify({ evidencias }),
        }),

    uploadEvidence: async ({ archivo, ...data }: UploadEvidenceData) => {
        const checksumSha256 = await huellaSha256(archivo);
        const res = await apiRequest<Omit<UploadEvidenceResponse, 'uploadHeaders'>>('/incidents/upload-evidence', {
            method: 'POST',
            body: JSON.stringify({ ...data, checksumSha256 }),
        });
        if (!res.success || !res.data) return res as { success: boolean; data?: UploadEvidenceResponse; error?: string };
        return { ...res, data: { ...res.data, uploadHeaders: headersDeSubida(data.fileType, checksumSha256) } };
    },

    getStats: (params?: IncidentStatsParams) => {
        const query = params ? new URLSearchParams(params as unknown as Record<string, string>).toString() : '';
        return apiRequest<IncidentStats>(`/incidents/stats${query ? `?${query}` : ''}`);
    },

    addInvestigation: (incidentId: string, data: AddInvestigationData) =>
        apiRequest<{ message: string; investigation: Investigation }>(`/incidents/${incidentId}/investigations`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    // Papeles del caso, en dos pasos: (1) pedir la URL de subida, (2) confirmar
    // cuando el archivo ya está en S3. El servidor registra el papel solo en el
    // paso 2, después de comprobar que el archivo existe.
    pedirSubidaPapel: async (incidentId: string, { archivo, tipo }: Pick<SubirPapelData, 'archivo' | 'tipo'>) => {
        const checksumSha256 = await huellaSha256(archivo);
        const res = await apiRequest<{ uploadUrl: string; s3Key: string; papelId: string }>(`/incidents/${incidentId}/documents`, {
            method: 'POST',
            body: JSON.stringify({ tipo, fileType: archivo.type, tamano: archivo.size, checksumSha256 }),
        });
        if (!res.success || !res.data) return res as { success: boolean; data?: undefined; error?: string };
        return { ...res, data: { ...res.data, uploadHeaders: headersDeSubida(archivo.type, checksumSha256) } };
    },

    confirmarPapel: (incidentId: string, data: { s3Key: string; fileName: string; fechaDocumento?: string }) =>
        apiRequest<{ papel: Omit<PapelDelCaso, 'contieneSalud'> }>(`/incidents/${incidentId}/documents/confirmar`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    /** Papeles subidos (sin enlaces), lo que el caso exige y el avance. Exige `incidentes.historial`. */
    getDocuments: (incidentId: string) =>
        apiRequest<PapelesDelCaso>(`/incidents/${incidentId}/documents`),

    /** Enlace firmado de 15 minutos de UN papel. Pedirlo es lo que queda en la auditoría de la DIAT y la DIEP. Exige `incidentes.historial`. */
    getEnlacePapel: (incidentId: string, papelId: string) =>
        apiRequest<{ url: string }>(`/incidents/${incidentId}/documents/${encodeURIComponent(papelId)}/enlace`),

    anularPapel: (incidentId: string, papelId: string, motivo: string) =>
        apiRequest<{ papel: Omit<PapelDelCaso, 'contieneSalud'> }>(`/incidents/${incidentId}/documents/${encodeURIComponent(papelId)}/anular`, {
            method: 'PUT',
            body: JSON.stringify({ motivo }),
        }),

    /** Casos de una obra sin datos personales ni archivos, del más reciente al más antiguo. Exige `incidentes.historial`. */
    getCasosResumen: (obraId: string) =>
        apiRequest<CasoResumen[]>(`/incidents/casos-resumen?obraId=${encodeURIComponent(obraId)}`),

    getAnalytics: (params?: { tenantId?: string; obraId?: string; fechaInicio?: string; fechaFin?: string }) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<AnalyticsData>(`/incidents/analytics${query ? `?${query}` : ''}`);
    },

    // Gobernanza de hallazgos: asignar responsable/plazo y verificar cierre (supervisor+).
    updateGobernanza: (id: string, data: Partial<HallazgoGobernanza> & { actorId: string }) =>
        apiRequest<{ incident: Incident; gobernanza: HallazgoGobernanza }>(`/incidents/${id}/gobernanza`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    // Completa/corrige el reporte flash con la informacion de la investigacion (supervisor+).
    completarFlash: (id: string, data: Partial<CreateIncidentData> & { actorId: string }) =>
        apiRequest<{ incident: Incident }>(`/incidents/${id}/flash-completar`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    // Seguimiento del estado de una medida correctiva (Art. 71): pendiente ->
    // en_proceso -> completada -> verificada. Insumo de la Fase ACT.
    updateMedidaEstado: (incidentId: string, numero: string | number, estado: 'pendiente' | 'en_proceso' | 'completada' | 'verificada') =>
        apiRequest<{ incident: Incident; medidas: unknown[] }>(`/incidents/${incidentId}/medidas/${encodeURIComponent(String(numero))}`, {
            method: 'PUT',
            body: JSON.stringify({ estado }),
        }),

    // Fase 3: clasificar y cerrar el caso.
    clasificar: (id: string, data: ClasificarData) =>
        apiRequest<{ incident: Incident; siguientePaso: SiguientePaso }>(`/incidents/${id}/triaje`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    /** Si falta algo, responde 409 con `error` y `pendientes` listos para mostrar. */
    cerrarCaso: (id: string, comentarioCierre: string) =>
        apiRequest<{ incident: Incident; siguientePaso: SiguientePaso }>(`/incidents/${id}/cerrar`, {
            method: 'PUT',
            body: JSON.stringify({ comentarioCierre }),
        }),

    reabrirCaso: (id: string, motivo: string) =>
        apiRequest<{ incident: Incident; siguientePaso: SiguientePaso }>(`/incidents/${id}/reabrir`, {
            method: 'PUT',
            body: JSON.stringify({ motivo }),
        }),

    /**
     * Las personas ACTIVAS de la empresa a quienes se puede dejar a cargo de algo (el servidor las
     * filtra: `estado=activo`, y el listado recortado de quien no tiene `personas.ver` ni trae el
     * estado, así que no se puede filtrar acá).
     */
    personasACargo: async () => {
        const res = await apiRequest<{ total: number; personas: Worker[] }>('/personas?estado=activo&conPermiso=incidentes.historial');
        if (res.success && res.data) return { success: true as const, data: res.data.personas };
        return { success: false as const, data: undefined, error: res.error };
    },

    markAsViewed: (id: string, userId: string) =>
        apiRequest<{ success: true }>(`/incidents/${id}/viewed`, {
            method: 'POST',
            body: JSON.stringify({ userId }),
        }),

    marcarAccidente: (id: string, actorId: string) =>
        apiRequest<Incident>(`/incidents/${id}/calificar-accidente`, {
            method: 'PUT',
            body: JSON.stringify({ actorId }),
        }),
};
