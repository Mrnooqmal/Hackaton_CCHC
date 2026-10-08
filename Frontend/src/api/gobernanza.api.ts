import { apiRequest } from './client';

/**
 * Derechos de los titulares (Ley 21.719). La constructora es la responsable del
 * tratamiento; esto es su herramienta para registrar y responder solicitudes.
 * Las reglas (plazos, prórroga, bloqueo) las aplica el backend:
 * Backend/lib/gobernanza/derechos.js.
 */

export type Derecho = 'acceso' | 'rectificacion' | 'supresion' | 'oposicion' | 'portabilidad' | 'bloqueo';
export type Resultado = 'acogida' | 'acogida_parcial' | 'rechazada';
export type TipoAlerta = 'por_vencer' | 'vencida' | 'prorroga_posible' | 'bloqueo_pendiente';

export const DERECHO_LABEL: Record<Derecho, string> = {
    acceso: 'Acceso',
    rectificacion: 'Rectificación',
    supresion: 'Supresión',
    oposicion: 'Oposición',
    portabilidad: 'Portabilidad',
    bloqueo: 'Bloqueo',
};

export const RESULTADO_LABEL: Record<Resultado, string> = {
    acogida: 'Acogida',
    acogida_parcial: 'Acogida en parte',
    rechazada: 'Rechazada',
};

/** Derechos que bloquean el tratamiento mientras se resuelven. */
export const DERECHOS_QUE_BLOQUEAN: Derecho[] = ['rectificacion', 'supresion', 'oposicion', 'bloqueo'];

interface Actor { personaId: string; nombre: string | null }

export interface Solicitud {
    solicitudId: string;
    personaId: string;
    derecho: Derecho;
    canal: string;
    detalle: string;
    recibidaEl: string;
    registradaEl: string;
    registradaPor: Actor;
    estado: 'abierta' | 'resuelta';
    venceEl: string;
    plazoVigente: string;
    prorroga: null | { comunicadaEl: string; registradaEl: string; medio: string | null; motivo: string; por: Actor; venceEl: string };
    bloqueo: { exigido: boolean; plazoHasta?: string | null; aplicadoEl?: string | null };
    respuesta: null | { resultado: Resultado; fundamento: string; medio: string | null; respondidaEl: string; por: Actor; dentroDePlazo: boolean };
    alertas: { tipo: TipoAlerta; clave: string; dias?: number }[];
}

export interface EventoHistorial {
    sk: string;
    tipo: 'solicitud' | 'bloqueo' | 'prorroga' | 'respuesta' | 'desbloqueo' | 'supresion' | 'alerta';
    en: string;
    por: Actor | { sistema: true };
    datos: Record<string, unknown>;
}

export const gobernanzaApi = {
    listar: (estado?: 'abierta' | 'resuelta') =>
        apiRequest<{ solicitudes: Solicitud[]; total: number }>(`/gobernanza/solicitudes${estado ? `?estado=${estado}` : ''}`),

    detalle: (solicitudId: string) =>
        apiRequest<Solicitud & { historial: EventoHistorial[] }>(`/gobernanza/solicitudes/${solicitudId}`),

    registrar: (datos: { personaId: string; derecho: Derecho; canal: string; recibidaEl: string; detalle?: string }) =>
        apiRequest<Solicitud>('/gobernanza/solicitudes', { method: 'POST', body: JSON.stringify(datos) }),

    prorrogar: (solicitudId: string, datos: { comunicadaEl: string; motivo: string; medio?: string }) =>
        apiRequest<Solicitud>(`/gobernanza/solicitudes/${solicitudId}/prorroga`, { method: 'POST', body: JSON.stringify(datos) }),

    responder: (solicitudId: string, datos: { resultado: Resultado; fundamento: string; medio?: string }) =>
        apiRequest<Solicitud>(`/gobernanza/solicitudes/${solicitudId}/respuesta`, { method: 'POST', body: JSON.stringify(datos) }),
};

// ── Lotes de supresión (dos personas: una aprueba, otra ejecuta) ─────────────

export type EstadoLote = 'propuesto' | 'aprobado' | 'desactualizado' | 'ejecutando' | 'ejecutado' | 'ejecutado_con_errores';

export interface OperacionLote {
    tabla: string;
    clave: Record<string, string>;
    accion: 'suprimir' | 'anonimizar' | 'quitar_campos';
    campos?: string[];
    traza?: Record<string, string>;
    /** Qué es, en palabras (lo agrega el detalle). */
    que?: string;
}

export interface Lote {
    loteId: string;
    ambito: { origen: 'retencion' | 'solicitud'; solicitudId?: string };
    huella: string;
    estado: EstadoLote;
    propuestoPor: Actor; propuestoEl: string;
    aprobadoPor?: Actor; aprobadoEl?: string;
    ejecutadoPor?: Actor; ejecutadoEl?: string;
    resultado?: { operaciones: number; versiones: number; errores: unknown[] };
}

export interface LoteDetalle extends Lote {
    contenido: { operaciones: OperacionLote[]; archivos: { key: string; versiones: string[] }[]; personas: string[] };
    /** ¿Coincide con lo que hay ahora? null si ya no aplica (ejecutado, desactualizado). */
    vigente: boolean | null;
}

export type LoteResumen = Lote & { operaciones: number; archivos: number; personas: number };

export const lotesApi = {
    listar: () => apiRequest<{ lotes: LoteResumen[] }>('/gobernanza/lotes'),
    detalle: (loteId: string) => apiRequest<LoteDetalle>(`/gobernanza/lotes/${loteId}`),
    proponerRetencion: () => apiRequest<LoteDetalle>('/gobernanza/lotes', { method: 'POST', body: JSON.stringify({ origen: 'retencion' }) }),
    proponerSolicitud: (solicitudId: string) =>
        apiRequest<LoteDetalle>('/gobernanza/lotes', { method: 'POST', body: JSON.stringify({ origen: 'solicitud', solicitudId }) }),
    /** Se envía la huella de lo que se vio: se aprueba exactamente eso. */
    aprobar: (loteId: string, huella: string) =>
        apiRequest<Lote>(`/gobernanza/lotes/${loteId}/aprobar`, { method: 'POST', body: JSON.stringify({ huella }) }),
    ejecutar: (loteId: string, huella: string) =>
        apiRequest<Lote>(`/gobernanza/lotes/${loteId}/ejecutar`, { method: 'POST', body: JSON.stringify({ huella }) }),
};
