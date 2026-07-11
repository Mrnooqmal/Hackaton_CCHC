import { apiRequest, apiBaseUrl } from './client';
import type { PersonaResponse } from './types';

// ── Tipos del wizard de carga masiva ────────────────────────────────────────
// Campos editables de una fila (los que el usuario puede corregir en la tabla).
export interface BulkRowInput {
    filaExcel: number;
    rut: string;
    nombre: string;
    apellidoPaterno?: string;
    apellidoMaterno?: string;
    fechaNacimiento?: string;
    email?: string;
    telefono?: string;
    rol: string;
    cargo?: string;
    obra?: string;
    supervisor?: string;
    nivelEscolar?: string;
    contactoEmergenciaNombre?: string;
    contactoEmergenciaTelefono?: string;
    contactoEmergenciaRelacion?: string;
    cursos?: string;
}
// Fila del preview: los campos + el resultado de validación del backend.
export interface BulkPreviewRow extends BulkRowInput {
    estado: 'ok' | 'advertencia' | 'error';
    errores: string[];
    advertencias: string[];
    esDuplicado: boolean;
    obraIds: string[];
    supervisorRutKey: string | null;
}
export interface BulkCatalogos {
    roles: string[];
    cargos: string[];
    obras: Array<{ label: string; codigo: string | null; obraId: string }>;
    supervisores: Array<{ rut: string; nombre: string; enSistema: boolean }>;
}
export interface BulkResumen { total: number; ok: number; advertencias: number; errores: number }

// Capacitación/actividad a la que asistió la persona (historial cross-obra).
export interface Capacitacion {
    activityId: string;
    tipo: string;
    tipoDescripcion: string | null;
    subtipo: string | null;
    subtipoDescripcion: string | null;
    titulo: string;
    fecha: string | null;
    obraId: string | null;
    estado: string | null;
    firmaToken: string | null;
    firmadaEn: string | null;
}
export interface BulkResultados {
    creados: Array<{ fila: number; personaId: string; rut: string; passwordTemporal?: string }>;
    errores: Array<{ fila: number; rut?: string; error: string }>;
    duplicados: Array<{ fila: number; rut?: string; motivo: string }>;
    totalProcesados: number;
}

// ========================================
// PERSONAS API (Multi-tenant)
// ========================================
export const personasApi = {
    create: (tenantId: string, data: {
        rut: string;
        nombre: string;
        apellidoPaterno?: string;
        apellidoMaterno?: string;
        fechaNacimiento?: string;
        email?: string;
        telefono?: string;
        rol: string;
        cargo?: string;
        tieneAccesoWeb?: boolean;
        obraIds?: string[];
        solicitanteId?: string;
        nivelEscolar?: string;
        contactoEmergencia?: { nombre?: string; telefono?: string; relacion?: string };
        cursos?: Array<{ nombre: string }>;
    }) =>
        apiRequest<{ message: string; persona: PersonaResponse; passwordTemporal?: string; emailNotificado: boolean }>(
            `/personas?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    list: (tenantId: string, filters?: { rol?: string; estado?: string; obraId?: string }) => {
        const params = new URLSearchParams({ tenantId });
        if (filters?.rol) params.append('rol', filters.rol);
        if (filters?.estado) params.append('estado', filters.estado);
        if (filters?.obraId) params.append('obraId', filters.obraId);
        return apiRequest<{ total: number; personas: PersonaResponse[] }>(`/personas?${params}`);
    },

    get: (id: string) =>
        apiRequest<PersonaResponse>(`/personas/${id}`),

    // Desvincula (elimina) a la persona de la empresa. Requiere el permiso
    // persona.desvincular del solicitante; decrementa el conteo del tenant.
    remove: (tenantId: string, id: string, solicitanteId?: string) =>
        apiRequest<{ message: string; personaId: string }>(`/personas/${id}?tenantId=${tenantId}`, {
            method: 'DELETE',
            body: JSON.stringify({ solicitanteId }),
        }),

    validateRut: (rut: string) =>
        apiRequest<{ existe: boolean; valido: boolean; mensaje: string | null }>(`/personas/validate?rut=${encodeURIComponent(rut)}`),

    getByRut: (tenantId: string, rut: string) =>
        apiRequest<PersonaResponse>(`/personas/by-rut/${encodeURIComponent(rut)}?tenantId=${tenantId}`),

    update: (tenantId: string, id: string, data: Partial<PersonaResponse>) =>
        apiRequest<{ message: string; persona: PersonaResponse }>(`/personas/${id}?tenantId=${tenantId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    // Asigna/actualiza los cargos del trabajador EN una obra (multi-cargo). El
    // cargo de terreno vive en la asignación (persona × obra), no en la persona.
    // Dispara el onboarding de esa obra si la asignación es nueva.
    setAsignacion: (tenantId: string, id: string, obraId: string, cargos: string[], solicitanteId?: string, supervisorPersonaId?: string | null) =>
        apiRequest<{ message: string; persona: PersonaResponse }>(`/personas/${id}/asignaciones?tenantId=${tenantId}`, {
            method: 'POST',
            // supervisorPersonaId solo se envía cuando se quiere fijar/cambiar la
            // cuadrilla; si es undefined el backend conserva el supervisor previo.
            body: JSON.stringify({ obraId, cargos, solicitanteId, ...(supervisorPersonaId !== undefined ? { supervisorPersonaId } : {}) }),
        }),

    // Quita al trabajador de una obra (mueve la asignación al historial con auditoría;
    // conserva evidencias persona-level). opts.solicitanteId = quién lo saca.
    quitarAsignacion: (tenantId: string, id: string, obraId: string, opts?: { solicitanteId?: string; motivo?: string }) =>
        apiRequest<{ message: string; persona: PersonaResponse }>(`/personas/${id}/asignaciones/${obraId}?tenantId=${tenantId}`, {
            method: 'DELETE',
            ...(opts ? { body: JSON.stringify(opts) } : {}),
        }),

    // Transfiere a la persona de una obra a otra: finaliza el tramo en origen
    // (→ historial + archiva docs) y crea la asignación en destino (+ onboarding).
    transferir: (tenantId: string, id: string, data: { obraOrigen: string; obraDestino: string; cargos?: string[]; supervisorPersonaId?: string | null; solicitanteId?: string; motivo?: string }) =>
        apiRequest<{ message: string; persona: PersonaResponse }>(`/personas/${id}/transferir?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    // Historial de capacitaciones/actividades (cross-obra) donde la persona asistió.
    getCapacitaciones: (tenantId: string, id: string) =>
        apiRequest<{ capacitaciones: Capacitacion[] }>(`/personas/${id}/capacitaciones?tenantId=${tenantId}`),

    // Registra evidencia persona-level con vigencia (examen altura, SPDC…),
    // reutilizable entre obras mientras esté vigente.
    addEvidencia: (tenantId: string, id: string, evidencia: {
        tipo: string; fileKey?: string; nombre?: string; emitidoEn?: string; venceEn?: string; origenObraId?: string;
    }) =>
        apiRequest<{ message: string; persona: PersonaResponse }>(`/personas/${id}/evidencias?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(evidencia),
        }),

    setPin: (tenantId: string, id: string, pin: string, pinActual?: string) =>
        apiRequest<{ message: string; pinCreatedAt: string }>(`/personas/${id}/set-pin?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify({ pin, pinActual }),
        }),

    completarEnrolamiento: (tenantId: string, id: string, pin: string) =>
        apiRequest<{ message: string; personaId: string; habilitado: boolean; firmaEnrolamiento: any }>(`/personas/${id}/enrolamiento?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify({ pin }),
        }),

    resetPassword: (tenantId: string, id: string) =>
        apiRequest<{ message: string; passwordTemporal: string; personaId: string }>(`/personas/${id}/reset-password?tenantId=${tenantId}`, {
            method: 'POST',
        }),

    // Historial dinamico de entregas/reposiciones de EPP (Art. 13)
    getHistorialEpp: (tenantId: string, personaId: string) =>
        apiRequest<{ entregas: any[]; total: number }>(`/personas/${personaId}/historial-epp?tenantId=${tenantId}`),

    // Crear entrega/reposicion de EPP (solo instancia superior)
    crearEntregaEpp: (tenantId: string, personaId: string, data: {
        creadorId: string;
        obraId?: string | null;
        itemsEntregados: Array<{ descripcion: string; cantidad: number; talla?: string | null; fechaVencimiento?: string | null }>;
        esReposicion?: boolean;
        motivoReposicion?: string | null;
        capacitacion?: { completada: boolean; duracionRealMinutos?: number | null; relatorId?: string | null };
    }) =>
        apiRequest<{ message: string; entrega: any }>(`/personas/${personaId}/epp?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    // Validar una entrega de EPP (instancia superior)
    validarEntregaEpp: (tenantId: string, personaId: string, data: { entregaDocumentId: string; validadorId: string; observacion?: string | null }) =>
        apiRequest<{ message: string; entrega: any }>(`/personas/${personaId}/epp/validar?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    bulkUpload: (tenantId: string, data: { fileBase64: string; fileName: string; sendWelcomeEmail?: boolean; obraId?: string }) =>
        apiRequest<{ mensaje: string; resultados: any }>(`/personas/carga-masiva?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    // Wizard paso 1: valida el Excel SIN crear nada. Devuelve filas con estado + catálogos.
    bulkValidate: (tenantId: string, data: { fileBase64: string; fileName: string }) =>
        apiRequest<{ filas: BulkPreviewRow[]; catalogos: BulkCatalogos; resumen: BulkResumen }>(`/personas/carga-masiva/validar?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    // Wizard paso 2: crea las filas aprobadas (JSON, no el Excel).
    bulkConfirm: (tenantId: string, data: { filas: BulkRowInput[]; sendWelcomeEmail?: boolean }) =>
        apiRequest<{ mensaje: string; resultados: BulkResultados }>(`/personas/carga-masiva/confirmar?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    parseExcel: (data: { fileBase64: string; fileName: string }) =>
        apiRequest<{
            trabajadores: Array<{
                rut: string; nombre: string; apellidoPaterno: string; apellidoMaterno: string;
                email: string; rol: string; cargo: string; tieneAccesoWeb: boolean; fechaNacimiento: string;
            }>;
            errores: Array<{ fila: number; error: string }>;
            total: number;
        }>('/personas/parse-excel', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    downloadTemplate: () => {
        // Incluye el tenantId para que la plantilla traiga los desplegables de rol
        // y cargo con los valores reales de la empresa.
        const tenantId = localStorage.getItem('tenant_id') || '';
        const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
        window.open(`${apiBaseUrl}/personas/plantilla${qs}`, '_blank');
    },
};
