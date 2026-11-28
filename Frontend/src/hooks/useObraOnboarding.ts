import { useCallback, useEffect, useMemo, useState } from 'react';
import { activitiesApi, documentsApi, mensajeDeError, signatureRequestsApi, surveysApi } from '../api/client';
import { adjuntarArchivo } from '../utils/adjuntarArchivo';
import { CATEGORIA_EVIDENCIA_DS44 } from '../api/uploads.api';
import { useCargoCatalog } from './useCargoCatalog';
import { computeOnboardingSummary, type OnboardingSummary } from '../utils/onboardingObra';
import { DS44_ONBOARDING_ITEMS } from '../utils/ds44';

/**
 * Seguimiento de onboarding DS 44 de una obra, listo para pintar el checklist.
 *
 * Carga las cuatro fuentes que acreditan un ítem del kit —documentos del día,
 * documentos de empresa, solicitudes de firma y actividades/encuestas
 * vinculadas— y las combina con `computeOnboardingSummary`. Quien lo usa aporta
 * la lista de personas de la obra, que ya tiene cargada para pintar el equipo:
 * volver a pedirla aquí duplicaría la llamada más pesada de la pantalla.
 */
export function useObraOnboarding(obraId: string | null | undefined, trabajadores: any[], obra: any | null) {
    const { cargos: cargoCatalog } = useCargoCatalog();
    const [documentosPrevencion, setDocumentosPrevencion] = useState<any[]>([]);
    const [signatureRequests, setSignatureRequests] = useState<any[]>([]);
    const [actividades, setActividades] = useState<any[]>([]);
    const [encuestas, setEncuestas] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploadingDoc, setUploadingDoc] = useState<string | null>(null); // `${workerId}:${tipo}`
    const [errorSubida, setErrorSubida] = useState<{ workerId: string; mensaje: string } | null>(null);

    const tenantId = obra?.tenantId || localStorage.getItem('tenant_id') || '';

    const reload = useCallback(async () => {
        if (!obraId) return;
        setLoading(true);
        try {
            const [docsPrevRes, docsEmpresaRes, activitiesRes, sigRes, surveysRes] = await Promise.all([
                documentsApi.list({ obraId, clasificacion: 'diario' } as any),
                // Documentos de empresa (RI/Política) a nivel tenant: cuentan en TODAS
                // las obras porque toda persona debe cumplirlos.
                documentsApi.list({ clasificacion: 'empresa' } as any),
                activitiesApi.list(),
                signatureRequestsApi.list({ tenantId, obraId }),
                surveysApi.list(),
            ]);

            const ds44Types = new Set<string>(DS44_ONBOARDING_ITEMS.map((i) => i.tipo));
            const candidatos = [
                ...(docsPrevRes.success && docsPrevRes.data ? docsPrevRes.data.documents || [] : [])
                    .filter((d: any) => d.clasificacion === 'diario' || (!ds44Types.has(d.tipo) && d.clasificacion !== 'obra' && d.clasificacion !== 'trabajador')),
                ...(docsEmpresaRes.success && docsEmpresaRes.data ? docsEmpresaRes.data.documents || [] : []),
            ];
            // Dedup por documentId (NO por tipo): cada persona tiene su propio documento
            // del mismo tipo; deduplicar por tipo perdía a todas las personas menos una.
            const seen = new Set<string>();
            const unique: any[] = [];
            for (const doc of candidatos) {
                if (!seen.has(doc.documentId)) { seen.add(doc.documentId); unique.push(doc); }
            }
            setDocumentosPrevencion(unique);
            setActividades((activitiesRes.success && activitiesRes.data ? activitiesRes.data.activities || [] : []).filter((a: any) => a.obraId === obraId));
            setEncuestas(surveysRes.success && surveysRes.data ? surveysRes.data.surveys || [] : []);
            setSignatureRequests(sigRes.success && sigRes.data ? sigRes.data.requests || [] : []);
        } catch (err) {
            console.error('Error cargando onboarding de obra:', err);
        } finally {
            setLoading(false);
        }
    }, [obraId, tenantId]);

    useEffect(() => { void reload(); }, [reload]);

    const summary: OnboardingSummary = useMemo(() => computeOnboardingSummary({
        trabajadores,
        documentosPrevencion,
        obraSignatureRequests: signatureRequests,
        actividades,
        encuestas,
        obraId,
        cargoCatalog,
        aplicabilidadKit: obra?.aplicabilidadKit,
    }), [trabajadores, documentosPrevencion, signatureRequests, actividades, encuestas, obraId, cargoCatalog, obra]);

    /** Onboarding indexado por personaId, que es como lo consulta la ficha. */
    const byWorkerId = useMemo(() => {
        const m = new Map<string, OnboardingSummary['byWorker'][number]>();
        summary.byWorker.forEach((w) => m.set(w.workerId, w));
        return m;
    }, [summary]);

    /**
     * Adjunta el archivo del ítem al documento de esa persona. NO marca firmado:
     * la asignación queda pendiente hasta que el trabajador firme.
     */
    const subirDocumento = useCallback(async (workerId: string, tipo: string, file: File) => {
        if (!obraId || !tenantId) return;
        setUploadingDoc(`${workerId}:${tipo}`);
        setErrorSubida(null);
        try {
            // El documento se busca antes de subir: sin dónde guardarlo, el archivo
            // quedaría huérfano en el almacenamiento.
            const docsRes = await documentsApi.list({ asignadoA: workerId } as any);
            if (!docsRes.success || !docsRes.data) {
                throw new Error(docsRes.error || 'No se pudieron cargar los documentos.');
            }
            const candidatos = (docsRes.data.documents || []).filter((d: any) =>
                d.tipo === tipo && (!d.obraId || d.obraId === obraId)
                && (d.asignaciones || []).some((a: any) => a.personaId === workerId)
            );
            const destino = candidatos.find((d: any) => d.obraId === obraId) || candidatos[0];
            if (!destino) {
                throw new Error('Esta persona no tiene un documento asignado para este ítem.');
            }
            await adjuntarArchivo({ documentId: destino.documentId, file, categoria: CATEGORIA_EVIDENCIA_DS44, tenantId });
            await reload();
        } catch (err) {
            console.error('Error subiendo doc de onboarding:', err);
            setErrorSubida({ workerId, mensaje: mensajeDeError(err, 'No se pudo subir el archivo.') });
        } finally {
            setUploadingDoc(null);
        }
    }, [obraId, tenantId, reload]);

    return { summary, byWorkerId, loading, reload, subirDocumento, uploadingDoc, errorSubida };
}
