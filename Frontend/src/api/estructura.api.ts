import { apiRequest, apiBaseUrl } from './client';
import type { CompletitudAmbito } from '../utils/completitud';
import type {
    Ambito, TipoOrgano, Origen, EstadoOrgano, Estamento, Calidad, CargoOrgano,
    TipoReunion, CausalExtraordinaria, EstadoReunion, Obligaciones, DotacionEfectiva,
} from '../utils/estructuraPreventiva';

/** Acreditación de un integrante: curso OPR, capacitación del OAL o registro Seremi.
 *  Los tres son el mismo patrón, un check más un documento. */
export interface Acreditacion {
    realizada: boolean;
    documentoId: string | null;
    adjunto: { fileKey: string; nombre: string; tipo?: string | null; subidoEn?: string } | null;
    fecha: string | null;
}

export interface MiembroOrgano {
    miembroId: string;
    organoId: string;
    personaId: string;
    nombre: string | null;
    estamento: Estamento;
    calidad: Calidad;
    cargo: CargoOrgano;
    origenDesignacion: 'Designado' | 'Electo' | null;
    acreditacion: Acreditacion;
    fechaInicio: string;
    fechaTermino: string | null;
    estado: string;
}

export interface ReunionOrgano {
    reunionId: string;
    organoId: string;
    tipo: TipoReunion;
    causalExtraordinaria: CausalExtraordinaria | null;
    /** Solo en ordinarias: `YYYY-MM`. Es lo que hace medible la periodicidad del Art. 39. */
    periodoMes: string | null;
    fechaProgramada: string;
    fechaRealizada: string | null;
    actaDocumentoId: string | null;
    comunicacionAcuerdosDocumentoId: string | null;
    comunicacionAcuerdosFecha: string | null;
    estado: EstadoReunion;
    registradoPor: string | null;
}

export interface OrganoPreventivo {
    organoId: string;
    tenantId: string;
    ambito: Ambito;
    obraId: string | null;
    tipo: TipoOrgano;
    /** Histórico: se fija al constituir y no cambia si después cambia la dotación. */
    origen: Origen;
    fechaEleccionODesignacion: string;
    fechaConstitucion: string | null;
    fechaTerminoMandato: string | null;
    estado: EstadoOrgano;
    dotacionAlConstituir: number;
    documentos: Record<string, string>;
    fechaDisolucion?: string | null;
    motivoDisolucion?: string | null;
    createdAt: string;
    updatedAt: string;
}

export type OrganoCompleto = OrganoPreventivo & {
    miembros: MiembroOrgano[];
    reuniones: ReunionOrgano[];
};

export interface ResumenEstructura {
    ambito: Ambito;
    obraId: string | null;
    dotacion: DotacionEfectiva;
    obligaciones: Obligaciones;
    organos: OrganoPreventivo[];
    /** Sección 7: comité, delegado y DPR vigentes como destinatarios asignables. */
    destinatarios: Array<{
        organoId: string; tipo: TipoOrgano; ambito: Ambito; obraId: string | null; personaIds: string[];
    }>;
    registrosIndicadores: { perfil: 'extendido' | 'minimo'; itemFuf: number; articulo: string } | null;
    fechaCreacionAmbito: string | null;
}

/** Origen de la medida (Art. 70). Son los cuatro que nombra el decreto. */
export type OrigenPrescripcion =
    | 'OrganismoFiscalizador' | 'OrganismoAdministrador'
    | 'DepartamentoPrevencion' | 'ComiteParitario';

export const ORIGEN_PRESCRIPCION_LABEL: Record<OrigenPrescripcion, string> = {
    OrganismoFiscalizador: 'Organismo fiscalizador',
    OrganismoAdministrador: 'Organismo Administrador (Ley 16.744)',
    DepartamentoPrevencion: 'Departamento de Prevención',
    ComiteParitario: 'Comité Paritario',
};

/** Derivado del plazo y de la evidencia; nunca se envía al servidor. */
export type EstadoPrescripcion = 'Pendiente' | 'Implementada' | 'Vencida';

export interface Prescripcion {
    prescripcionId: string;
    obraId: string | null;
    origen: OrigenPrescripcion;
    fechaPrescripcion: string;
    descripcion: string;
    plazoImplementacion: string | null;
    documentoPrescripcionId: string | null;
    reunionOrigenId: string | null;
    fechaImplementacion: string | null;
    evidenciaImplementacionDocumentoId: string | null;
    registradoPor: string | null;
    estado: EstadoPrescripcion;
    createdAt: string;
    updatedAt: string;
}

export interface PrescripcionData {
    obraId?: string | null;
    origen: OrigenPrescripcion;
    fechaPrescripcion: string;
    descripcion: string;
    plazoImplementacion?: string | null;
    documentoPrescripcionId?: string | null;
    fechaImplementacion?: string | null;
    evidenciaImplementacionDocumentoId?: string | null;
    solicitanteId?: string;
}

export interface ConstituirOrganoData {
    ambito: Ambito;
    obraId?: string | null;
    tipo: TipoOrgano;
    fechaEleccionODesignacion: string;
    fechaConstitucion?: string | null;
    /** Editable solo a la baja: el backend rechaza más de 2 años desde la elección. */
    fechaTerminoMandato?: string | null;
    miembros: Array<{
        personaId: string; nombre?: string; estamento: Estamento;
        calidad: Calidad; cargo: CargoOrgano; origenDesignacion?: 'Designado' | 'Electo';
    }>;
    solicitanteId?: string;
}

const qs = (params: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : '';
};

export const estructuraApi = {
    /** Dotación, obligación por figura, órganos y destinatarios del ámbito. */
    resumen: (tenantId: string, ambito: Ambito, obraId?: string | null) =>
        apiRequest<ResumenEstructura>(`/estructura/resumen${qs({ tenantId, ambito, obraId })}`),

    /** Estado de los requisitos del FUF del ámbito. Lee las mismas definiciones
     *  que el export, para que panel y expediente no discrepen. */
    completitud: (tenantId: string, ambito: Ambito, obraId?: string | null) =>
        apiRequest<CompletitudAmbito>(`/estructura/completitud${qs({ tenantId, ambito, obraId })}`),

    /** URL del reporte imprimible. Se abre en pestaña nueva en vez de descargarse
     *  por fetch: el navegador ya sabe mostrar e imprimir HTML, y así el usuario
     *  decide si guardarlo como PDF. */
    urlExport: (tenantId: string, ambito: Ambito, obraId?: string | null) =>
        `${apiBaseUrl}/estructura/completitud/export${qs({ tenantId, ambito, obraId, formato: 'html' })}`,

    /** Prescripciones del ámbito, con su estado ya derivado del plazo. */
    listarPrescripciones: (tenantId: string, obraId?: string | null) =>
        apiRequest<{ total: number; prescripciones: Prescripcion[] }>(
            `/estructura/prescripciones${qs({ tenantId, obraId })}`
        ),

    crearPrescripcion: (tenantId: string, data: PrescripcionData) =>
        apiRequest<{ message: string; prescripcion: Prescripcion }>(
            `/estructura/prescripciones${qs({ tenantId })}`,
            { method: 'POST', body: JSON.stringify(data) }
        ),

    actualizarPrescripcion: (tenantId: string, prescripcionId: string, cambios: Partial<PrescripcionData>) =>
        apiRequest<{ message: string; prescripcion: Prescripcion }>(
            `/estructura/prescripciones/${prescripcionId}${qs({ tenantId })}`,
            { method: 'PUT', body: JSON.stringify(cambios) }
        ),

    eliminarPrescripcion: (tenantId: string, prescripcionId: string) =>
        apiRequest<{ message: string }>(
            `/estructura/prescripciones/${prescripcionId}${qs({ tenantId })}`,
            { method: 'DELETE' }
        ),

    listar: (tenantId: string, filtros: { ambito?: Ambito; obraId?: string | null } = {}) =>
        apiRequest<{ total: number; organos: OrganoPreventivo[] }>(
            `/estructura/organos${qs({ tenantId, ambito: filtros.ambito, obraId: filtros.obraId })}`
        ),

    obtener: (tenantId: string, organoId: string) =>
        apiRequest<OrganoCompleto>(`/estructura/organos/${organoId}${qs({ tenantId })}`),

    constituir: (tenantId: string, data: ConstituirOrganoData) =>
        apiRequest<{ message: string; organo: OrganoCompleto }>(`/estructura/organos${qs({ tenantId })}`, {
            method: 'POST', body: JSON.stringify(data),
        }),

    disolver: (tenantId: string, organoId: string, motivo?: string, solicitanteId?: string) =>
        apiRequest<{ message: string; canceladas: number }>(
            `/estructura/organos/${organoId}/disolver${qs({ tenantId })}`,
            { method: 'POST', body: JSON.stringify({ motivo, solicitanteId }) }
        ),

    /** Curso OPR (Art. 32), capacitación OAL (Art. 65) y registro Seremi (Art. 55). */
    acreditar: (tenantId: string, organoId: string, miembroId: string, acreditacion: Partial<Acreditacion>) =>
        apiRequest<{ message: string; miembro: MiembroOrgano }>(
            `/estructura/organos/${organoId}/miembros/${miembroId}/acreditacion${qs({ tenantId })}`,
            { method: 'PUT', body: JSON.stringify({ acreditacion }) }
        ),

    vincularDocumento: (tenantId: string, organoId: string, clave: string, documentoId: string) =>
        apiRequest<{ message: string; organo: OrganoPreventivo }>(
            `/estructura/organos/${organoId}/documentos${qs({ tenantId })}`,
            { method: 'POST', body: JSON.stringify({ clave, documentoId }) }
        ),

    /** Solo extraordinarias: las ordinarias se generan al constituir el órgano. */
    crearReunionExtraordinaria: (
        tenantId: string, organoId: string,
        data: { causal: CausalExtraordinaria; fechaProgramada?: string; solicitanteId?: string }
    ) =>
        apiRequest<{ message: string; reunion: ReunionOrgano }>(
            `/estructura/organos/${organoId}/reuniones${qs({ tenantId })}`,
            { method: 'POST', body: JSON.stringify(data) }
        ),

    /** Registrar realizada exige acta: sin ella el backend responde 400 (regla 8). */
    registrarReunion: (
        tenantId: string, organoId: string, reunionId: string,
        data: { fechaRealizada: string; actaDocumentoId: string; solicitanteId?: string }
    ) =>
        apiRequest<{ message: string; reunion: ReunionOrgano }>(
            `/estructura/organos/${organoId}/reuniones/${reunionId}${qs({ tenantId })}`,
            { method: 'PUT', body: JSON.stringify(data) }
        ),

    reagendarReunion: (tenantId: string, organoId: string, reunionId: string, fechaProgramada: string) =>
        apiRequest<{ message: string; reunion: ReunionOrgano }>(
            `/estructura/organos/${organoId}/reuniones/${reunionId}${qs({ tenantId })}`,
            { method: 'PUT', body: JSON.stringify({ fechaProgramada }) }
        ),

    /** Ítem 36: comunicación escrita de los acuerdos a la entidad empleadora. */
    comunicarAcuerdos: (tenantId: string, organoId: string, reunionId: string, documentoId: string, fecha?: string) =>
        apiRequest<{ message: string; reunion: ReunionOrgano }>(
            `/estructura/organos/${organoId}/reuniones/${reunionId}/comunicacion-acuerdos${qs({ tenantId })}`,
            { method: 'POST', body: JSON.stringify({ documentoId, fecha }) }
        ),
};
