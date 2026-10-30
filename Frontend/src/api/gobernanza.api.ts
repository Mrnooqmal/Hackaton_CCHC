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
    /** Calculada por el backend de lo registrado (lib/gobernanza/derechos.js, `etapaDe`). */
    etapa: Etapa;
    verificacion?: null | { metodo: MetodoVerificacion; observacion: string | null; verificadaEl: string; por: Actor | { sistema: true } };
    ejecucion?: null | { en: string; por: Actor; detalle?: Record<string, unknown> };
    camposPedidos?: CampoRectificable[] | null;
}

export type Etapa = 'recibida' | 'verificada' | 'respondida' | 'cerrada';
export const ETAPA_LABEL: Record<Etapa, string> = {
    recibida: 'Recibida',
    verificada: 'Identidad verificada, en evaluación',
    respondida: 'Respondida, falta ejecutar',
    cerrada: 'Cerrada',
};

export type MetodoVerificacion = 'sesion_y_contrasena' | 'presencial_cedula' | 'correo_registrado' | 'otro';
export const METODO_LABEL: Record<MetodoVerificacion, string> = {
    sesion_y_contrasena: 'Desde su sesión, con su contraseña',
    presencial_cedula: 'En persona, con su cédula',
    correo_registrado: 'Desde el correo registrado en su ficha',
    otro: 'Otro (describir)',
};

export type CampoRectificable = 'nombre' | 'apellidoPaterno' | 'apellidoMaterno' | 'rut' | 'fechaNacimiento';
export const CAMPO_LABEL: Record<CampoRectificable, string> = {
    nombre: 'Nombre',
    apellidoPaterno: 'Apellido paterno',
    apellidoMaterno: 'Apellido materno',
    rut: 'RUT',
    fechaNacimiento: 'Fecha de nacimiento',
};

export interface EventoHistorial {
    sk: string;
    tipo: 'solicitud' | 'bloqueo' | 'prorroga' | 'respuesta' | 'desbloqueo' | 'supresion' | 'alerta' | 'verificacion' | 'ejecucion';
    en: string;
    por: Actor | { sistema: true };
    datos: Record<string, unknown>;
}

export const gobernanzaApi = {
    listar: (estado?: 'abierta' | 'resuelta') =>
        apiRequest<{ solicitudes: Solicitud[]; total: number }>(`/gobernanza/solicitudes${estado ? `?estado=${estado}` : ''}`),

    detalle: (solicitudId: string) =>
        apiRequest<Solicitud & { historial: EventoHistorial[]; cambiosPropuestos: Partial<Record<CampoRectificable, string>> | null }>(`/gobernanza/solicitudes/${solicitudId}`),

    registrar: (datos: { personaId: string; derecho: Derecho; canal: string; recibidaEl: string; detalle?: string; verificacion?: { metodo: MetodoVerificacion; observacion?: string } }) =>
        apiRequest<Solicitud>('/gobernanza/solicitudes', { method: 'POST', body: JSON.stringify(datos) }),

    verificar: (solicitudId: string, datos: { metodo: MetodoVerificacion; observacion?: string }) =>
        apiRequest<Solicitud>(`/gobernanza/solicitudes/${solicitudId}/verificacion`, { method: 'POST', body: JSON.stringify(datos) }),

    /** Copia de los datos para una solicitud de acceso o portabilidad (con identidad verificada). */
    exportar: (solicitudId: string) =>
        apiRequest<ExportacionTitular>(`/gobernanza/solicitudes/${solicitudId}/exportacion`, { method: 'POST', body: '{}' }),

    prorrogar: (solicitudId: string, datos: { comunicadaEl: string; motivo: string; medio?: string }) =>
        apiRequest<Solicitud>(`/gobernanza/solicitudes/${solicitudId}/prorroga`, { method: 'POST', body: JSON.stringify(datos) }),

    responder: (solicitudId: string, datos: { resultado: Resultado; fundamento: string; medio?: string; camposAceptados?: CampoRectificable[] }) =>
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

// ── Autoservicio del titular: Mis datos y privacidad ─────────────────────────

export interface FinalidadConsentimiento {
    finalidad: string;
    nombre: string;
    dato: string;
    efectoRevocacion: string;
    version: string;
    texto: string;
    estado: 'otorgado' | 'revocado' | 'sin_decision';
    vigente: boolean;
    requiereRenovar: boolean;
    otorgadoEl: string | null;
    revocadoEl: string | null;
    versionAceptada: string | null;
}

export interface EventoConsentimiento {
    tipo: 'consentimiento_otorgado' | 'consentimiento_revocado';
    en: string;
    finalidad: string;
    version: string;
}

export interface MiSolicitud {
    solicitudId: string;
    derecho: Derecho;
    canal: string;
    recibidaEl: string;
    plazoVigente: string;
    etapa: Etapa;
    estado: 'abierta' | 'resuelta';
    camposPedidos: CampoRectificable[] | null;
    verificadaEl: string | null;
    respuesta: null | { resultado: Resultado; fundamento: string; respondidaEl: string };
    ejecutadaEl: string | null;
}

/** El documento que entrega la exportación (formato `buildandserve.datos-titular`). */
export interface ExportacionTitular {
    formato: string;
    version: number;
    generadoEl: string;
    secciones: Record<string, { finalidad: string; datos: unknown }>;
    [k: string]: unknown;
}

export const privacidadApi = {
    consentimientos: () =>
        apiRequest<{ finalidades: FinalidadConsentimiento[]; basesSinConsentimiento: { tratamiento: string; base: string }[]; historial: EventoConsentimiento[] }>('/gobernanza/mis-datos/consentimientos'),
    otorgar: (finalidad: string, version: string) =>
        apiRequest<FinalidadConsentimiento>(`/gobernanza/mis-datos/consentimientos/${finalidad}`, { method: 'POST', body: JSON.stringify({ accion: 'otorgar', version }) }),
    revocar: (finalidad: string) =>
        apiRequest<FinalidadConsentimiento>(`/gobernanza/mis-datos/consentimientos/${finalidad}`, { method: 'POST', body: JSON.stringify({ accion: 'revocar' }) }),
    exportar: (password: string) =>
        apiRequest<ExportacionTitular>('/gobernanza/mis-datos/exportacion', { method: 'POST', body: JSON.stringify({ password }) }),
    solicitudes: () => apiRequest<{ solicitudes: MiSolicitud[] }>('/gobernanza/mis-datos/solicitudes'),
    solicitar: (datos: { derecho: 'rectificacion' | 'supresion' | 'oposicion' | 'bloqueo'; detalle?: string; cambios?: Partial<Record<CampoRectificable, string>>; password: string }) =>
        apiRequest<MiSolicitud>('/gobernanza/mis-datos/solicitudes', { method: 'POST', body: JSON.stringify(datos) }),
};

/** Descarga un objeto como archivo JSON (lo arma el navegador; no pasa por ningún servidor). */
export function descargarJson(objeto: unknown, nombre: string) {
    const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Auditoría ────────────────────────────────────────────────────────────────

export interface EventoAuditoria {
    sk: string;
    eventoId?: string;
    en: string;
    categoria: string;
    operacion?: string;
    resultado?: 'exito' | 'denegado' | 'fallido';
    actorId: string;
    actorTipo?: string;
    actorRol?: string | null;
    recurso?: { tipo: string; id: string | null } | null;
    titulares?: string[];
    origen?: { ip: string | null; canal: string | null } | null;
    ip?: string | null;
    ruta?: string;
    tipos?: string[];
    detalle?: Record<string, unknown>;
    integridad: 'integro' | 'alterado' | 'sin_sello';
}

export const auditoriaApi = {
    listar: (filtros: { desde?: string; hasta?: string; categoria?: string } = {}) => {
        const q = Object.entries(filtros).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
        return apiRequest<{ eventos: EventoAuditoria[]; total: number; integridad: Record<string, number> }>(`/gobernanza/auditoria${q ? `?${q}` : ''}`);
    },
};
