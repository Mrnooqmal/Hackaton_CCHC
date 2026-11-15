import { signatureRequestsApi, documentsApi } from '../api/client';
import { leerCola } from './colaFirmas';

/**
 * Cuántas firmas tiene pendientes una persona, para el indicador del sidebar.
 *
 * Cuenta lo mismo que lista "Mis firmas" (pages/MySignatures.tsx, loadData):
 * las solicitudes de firma más los documentos que tiene asignados, sin contar
 * dos veces un documento que ya llega por una solicitud. Además descuenta los
 * documentos firmados sin señal que siguen en el equipo esperando enviarse: la
 * pantalla ya los saca de la lista, y el servidor aún no se entera.
 *
 * Devuelve `null` si no se pudo consultar (sin señal): quien llama conserva el
 * último número en vez de mostrar un 0 que no es cierto.
 */
export async function contarFirmasPendientes(personaId: string): Promise<number | null> {
    const [pend, docs] = await Promise.all([
        signatureRequestsApi.getPendingByWorker(personaId).catch(() => null),
        documentsApi.list({ pendienteDe: personaId }).catch(() => null),
    ]);
    if (!pend?.success && !docs?.success) return null;

    const solicitudes = pend?.success ? pend.data?.pendientes ?? [] : [];
    const yaSolicitados = new Set(solicitudes.map((r) => r.referenciaId).filter(Boolean));

    let tenantId: string | null = null;
    try { tenantId = localStorage.getItem('tenant_id'); } catch { /* sin almacenamiento */ }
    const firmadosSinSenal = new Set(
        leerCola(tenantId)
            .filter((f) => f.workerId === personaId && f.type === 'documento')
            .map((f) => f.targetId),
    );

    const documentos = docs?.success
        ? (docs.data?.documents ?? []).filter((d) => !yaSolicitados.has(d.documentId) && !firmadosSinSenal.has(d.documentId))
        : [];

    return solicitudes.length + documentos.length;
}

/** Evento para que el sidebar recuente al instante (tras firmar o sincronizar). */
export const EVENTO_FIRMAS_CAMBIARON = 'firmasCambiaron';

export const avisarFirmasCambiaron = () => {
    window.dispatchEvent(new CustomEvent(EVENTO_FIRMAS_CAMBIARON));
};
