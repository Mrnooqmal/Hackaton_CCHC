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
