import { useCallback, useEffect, useMemo, useState } from 'react';
import { activitiesApi, documentsApi, signatureRequestsApi, surveysApi, uploadsApi } from '../api/client';
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
        try {
            const uploadRes = await uploadsApi.getUploadUrl({
                archivo: file, fileName: file.name, fileType: file.type, fileSize: file.size,
                categoria: 'obras', empresaId: tenantId,
            });
            if (!uploadRes.success || !uploadRes.data) throw new Error('Sin URL de subida');
            await fetch(uploadRes.data.uploadUrl, { method: 'PUT', body: file, headers: uploadRes.data.uploadHeaders });
            const fileKey = uploadRes.data.fileKey;
            await uploadsApi.confirmUpload({ fileKey, fileName: file.name, fileType: file.type, fileSize: file.size });

            const docsRes = await documentsApi.list({ obraId, workerId } as any);
            if (docsRes.success && docsRes.data) {
                const targetDoc = (docsRes.data.documents || []).find((d: any) =>
                    d.tipo === tipo && (d.asignaciones || []).some((a: any) => a.personaId === workerId)
                );
                if (targetDoc) {
                    await documentsApi.update(targetDoc.documentId, {
                        s3Key: fileKey, archivoUrl: fileKey, archivoNombre: file.name,
                    } as any);
                }
            }
            await reload();
        } catch (err) {
            console.error('Error subiendo doc de onboarding:', err);
        } finally {
            setUploadingDoc(null);
        }
    }, [obraId, tenantId, reload]);

    return { summary, byWorkerId, loading, reload, subirDocumento, uploadingDoc };
}
