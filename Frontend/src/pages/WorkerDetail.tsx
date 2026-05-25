import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import {
    LuChevronLeft,
    LuUser,
    LuMail,
    LuIdCard,
    LuTrendingUp,
    LuFileText,
    LuCircleCheck,
    LuCircleAlert,
    LuDownload,
    LuClock,
    LuBriefcase,
    LuShield,
    LuUsers,
    LuCircleMinus,
    LuBuilding2 as LuBuild
} from 'react-icons/lu';
import {
    workersApi,
    documentsApi,
    uploadsApi,
    signaturesApi,
    signatureRequestsApi,
    type Worker as ApiWorker,
    type DigitalSignature,
    REQUEST_TYPES
} from '../api/client';
import { useObraContext } from '../context/ObraContext';
import { DS44_ONBOARDING_ITEMS } from '../utils/ds44';

interface WorkerStats {
    totalFirmas: number;
    firmasUltimos30Dias: number;
    documentosFirmados: number;
    actividadesAsistidas: number;
}

// Extender la interfaz Worker para incluir rol (que viene del backend para usuarios legacy)
interface WorkerWithRole extends ApiWorker {
    rol?: 'admin' | 'prevencionista' | 'trabajador';
    obraIds?: string[];
}

const getSigIcon = (sig: DigitalSignature) => {
    const type = (sig as any).requestTipo || sig.tipoFirma;
    switch (type) {
        case 'enrolamiento': return <LuShield size={12} />;
        case 'documento': return <LuFileText size={12} />;
        case 'actividad':
        case 'capacitacion':
        case 'CHARLA_5MIN':
        case 'INDUCCION':
            return <LuUsers size={12} />;
        case 'ENTREGA_EPP':
            return <LuShield size={12} />;
        default:
            return <LuFileText size={12} />;
    }
};

export default function WorkerDetail() {
    const { rut } = useParams<{ rut: string }>();
    const navigate = useNavigate();
    const { selectedObraId } = useObraContext();
    const { user } = useAuth();

    const [worker, setWorker] = useState<WorkerWithRole | null>(null);
    const [stats, setStats] = useState<WorkerStats | null>(null);
    const [signatures, setSignatures] = useState<DigitalSignature[]>([]);
    const [compliance, setCompliance] = useState({ completed: 0, assigned: 0 });
    const [ds44Checklist, setDs44Checklist] = useState<{ completed: number; total: number; items: Array<{ key: string; label: string; articulo?: string; kind?: string; tipo?: string; status: 'ok' | 'pending' | 'na' }> } | null>(null);
    const [docRecordMap, setDocRecordMap] = useState<Record<string, { documentId: string; s3Key: string | null; archivoNombre: string | null }>>({});
    const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
    const [markingDone, setMarkingDone] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const getLatestOverrideObraId = (overrides?: Record<string, { items?: Record<string, { doneAt: string }>; updatedAt?: string }>) => {
        if (!overrides) return null;
        let latestId: string | null = null;
        let latestTs = 0;

        Object.entries(overrides).forEach(([obraId, entry]) => {
            let ts = 0;
            if (entry?.updatedAt) {
                const parsed = Date.parse(entry.updatedAt);
                if (!Number.isNaN(parsed)) ts = parsed;
            }
            if (ts === 0 && entry?.items) {
                Object.values(entry.items).forEach((item) => {
                    const parsed = Date.parse(item.doneAt);
                    if (!Number.isNaN(parsed) && parsed > ts) ts = parsed;
                });
            }
            if (ts > latestTs) {
                latestTs = ts;
                latestId = obraId;
            }
        });

        return latestId;
    };

    const resolveTargetObraId = (workerData: WorkerWithRole | null) => {
        if (selectedObraId) return selectedObraId;
        if (!workerData) return null;
        const overrideObraId = getLatestOverrideObraId((workerData as any).onboardingDS44);
        if (overrideObraId) return overrideObraId;
        return workerData.obraIds?.[0] || null;
    };

    useEffect(() => {
        if (rut) {
            loadWorkerData();
        }
    }, [rut, selectedObraId]);

    const loadWorkerData = async () => {
        if (!rut) return;
        setLoading(true);
        setError('');
        try {
            // OPTIMIZED: Use getByRut instead of listing all workers
            const workerRes = await workersApi.getByRut(rut);

            if (!workerRes.success || !workerRes.data) {
                setError('Trabajador no encontrado');
                setLoading(false);
                return;
            }
            setWorker(workerRes.data as WorkerWithRole);

            const targetObraId = resolveTargetObraId(workerRes.data as WorkerWithRole);
            const manualOverrides = targetObraId
                ? (workerRes.data as any).onboardingDS44?.[targetObraId]?.items || {}
                : {};
            const [signaturesRes, , historyRes, docsRes] = await Promise.all([
                signaturesApi.getByWorker(workerRes.data.workerId),
                signatureRequestsApi.getPendingByWorker(workerRes.data.workerId),
                signatureRequestsApi.getHistoryByWorker(workerRes.data.workerId),
                targetObraId ? documentsApi.list({ obraId: targetObraId } as any) : Promise.resolve({ success: false })
            ]);

            if (signaturesRes.success && signaturesRes.data) {
                const firmas = signaturesRes.data.firmas || [];
                setSignatures(firmas);

                // Calculate statistics manually
                const now = new Date();
                const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

                setStats({
                    totalFirmas: firmas.length,
                    firmasUltimos30Dias: firmas.filter(f => new Date(f.timestamp) > thirtyDaysAgo).length,
                    documentosFirmados: firmas.filter(f => (f as any).requestTipo === 'documento' || f.tipoFirma === 'documento').length,
                    actividadesAsistidas: firmas.filter(f =>
                        ['actividad', 'capacitacion', 'CHARLA_5MIN', 'INDUCCION', 'ENTREGA_EPP', 'ART', 'PROCEDIMIENTO', 'INSPECCION', 'REGLAMENTO']
                            .includes((f as any).requestTipo || f.tipoFirma || '')
                    ).length
                });
            }

            const historyItems = historyRes.success && historyRes.data
                ? (historyRes.data.historial || [])
                : [];
            const completedRequests = historyItems
                .map((item: any) => item.solicitud)
                .filter(Boolean);

            const filteredCompleted = targetObraId
                ? completedRequests.filter((req: any) => req.obraId === targetObraId)
                : completedRequests;

            const completedTypes = new Set(filteredCompleted.map((req: any) => req.tipo));

            const docs = docsRes && (docsRes as any).success && (docsRes as any).data
                ? (docsRes as any).data.documents || []
                : [];
            const docStatus = new Map<string, boolean>();
            const newDocRecordMap: Record<string, { documentId: string; s3Key: string | null; archivoNombre: string | null }> = {};
            docs.forEach((doc: any) => {
                const hasFile = Boolean(doc.s3Key || doc.archivoUrl);
                (doc.asignaciones || []).forEach((asig: any) => {
                    const personaId = asig.personaId || asig.workerId;
                    if (personaId !== workerRes.data.workerId) return;
                    if (!doc.tipo) return;
                    // Track sign status — file uploaded also counts as done
                    if (asig.estado === 'firmado' || asig.fechaFirma || hasFile) {
                        docStatus.set(doc.tipo, true);
                    } else if (!docStatus.has(doc.tipo)) {
                        docStatus.set(doc.tipo, false);
                    }
                    // Track document record for upload
                    if (!newDocRecordMap[doc.tipo]) {
                        newDocRecordMap[doc.tipo] = { documentId: doc.documentId, s3Key: doc.s3Key || null, archivoNombre: doc.archivoNombre || null };
                    }
                });
            });
            setDocRecordMap(newDocRecordMap);

            let ds44Total = 0;
            let ds44Completed = 0;
            const checklistItems = DS44_ONBOARDING_ITEMS.map((item) => {
                ds44Total += 1;
                const manualDone = Boolean((manualOverrides as any)[item.tipo]);

                if (item.kind === 'document') {
                    const signed = docStatus.get(item.tipo) || false;
                    const done = signed || manualDone;
                    if (done) ds44Completed += 1;
                    return { key: item.key, label: item.label, articulo: item.articulo, kind: item.kind, tipo: item.tipo, actionLabel: item.actionLabel, status: done ? 'ok' as const : 'pending' as const };
                }

                if (item.kind === 'signature') {
                    const signed = completedTypes.has(item.tipo) || manualDone;
                    if (signed) ds44Completed += 1;
                    return { key: item.key, label: item.label, articulo: item.articulo, kind: item.kind, tipo: item.tipo, actionLabel: item.actionLabel, status: signed ? 'ok' as const : 'pending' as const };
                }

                if (item.kind === 'actividad') {
                    const hasCap = completedTypes.has('CAPACITACION') || manualDone;
                    if (hasCap) ds44Completed += 1;
                    return { key: item.key, label: item.label, articulo: item.articulo, kind: item.kind, tipo: item.tipo, actionLabel: item.actionLabel, status: hasCap ? 'ok' as const : 'pending' as const };
                }

                return { key: item.key, label: item.label, articulo: item.articulo, kind: item.kind, tipo: item.tipo, actionLabel: item.actionLabel, status: 'pending' as const };
            });

            setDs44Checklist({ completed: ds44Completed, total: ds44Total, items: checklistItems });
            setCompliance({ completed: ds44Completed, assigned: ds44Total });

        } catch (err) {
            console.error('Error loading worker details:', err);
            setError('Error al cargar la información del trabajador');
        } finally {
            setLoading(false);
        }
    };

    const downloadReport = () => {
        if (!worker || !stats) return;

        const reportContent = `
REPORTE DE TRABAJADOR: ${worker.nombre} ${worker.apellido || ''}
RUT: ${worker.rut}
Fecha: ${new Date().toLocaleDateString('es-CL')}
--------------------------------------------------

DETALLES
- Cargo: ${worker.cargo || 'N/A'}
- Email: ${worker.email || 'N/A'}
- Estado: ${worker.habilitado ? 'Habilitado' : 'Pendiente'}

ESTADÍSTICAS
- Total Firmas: ${stats.totalFirmas}
- Firmas (30 días): ${stats.firmasUltimos30Dias}
- Documentos: ${stats.documentosFirmados}
- Actividades: ${stats.actividadesAsistidas}

HISTORIAL RECIENTE
${signatures.slice(0, 10).map(s => `- ${s.fecha} ${s.horario}: ${s.tipoFirma} (${s.estado})`).join('\n')}

Generado por PrevencionApp
        `.trim();

        const blob = new Blob([reportContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Reporte_${worker.rut}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleUploadWorkerDoc = async (tipo: string, file: File) => {
        const docRecord = docRecordMap[tipo];
        if (!docRecord || !worker) return;
        setUploadingDocType(tipo);
        try {
            const uploadRes = await uploadsApi.getUploadUrl({
                fileName: file.name, fileType: file.type, fileSize: file.size,
                categoria: 'trabajadores', empresaId: (worker as any).tenantId || (worker as any).empresaId || 'default'
            });
            if (!uploadRes.success || !uploadRes.data) throw new Error('Sin URL de subida');
            await fetch(uploadRes.data.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
            const fileKey = uploadRes.data.fileKey;
            await uploadsApi.confirmUpload({ fileKey, fileName: file.name, fileType: file.type, fileSize: file.size });
            await documentsApi.update(docRecord.documentId, { s3Key: fileKey, archivoUrl: fileKey, archivoNombre: file.name } as any);
            await loadWorkerData(); // Recargar datos
        } catch (err) {
            console.error('Error subiendo documento del trabajador:', err);
        } finally {
            setUploadingDocType(null);
        }
    };

    const handleMarkOnboardingItem = async (tipo?: string) => {
        if (!worker || !tipo) return;
        const targetObraId = resolveTargetObraId(worker);
        if (!targetObraId) {
            alert('Este trabajador no tiene una obra asociada para registrar onboarding.');
            return;
        }

        const key = `${worker.workerId}:${tipo}`;
        setMarkingDone(key);
        try {
            const now = new Date().toISOString();
            const current = (worker as any).onboardingDS44 || {};
            const obraEntry = current[targetObraId] || {};
            const items = { ...(obraEntry.items || {}) };
            items[tipo] = {
                doneAt: now,
                doneBy: user?.userId,
                source: 'manual'
            };

            const nextOnboarding = {
                ...current,
                [targetObraId]: {
                    ...obraEntry,
                    items,
                    updatedAt: now
                }
            };

            const res = await workersApi.update(worker.workerId, { onboardingDS44: nextOnboarding } as any);
            if (res.success) {
                const updated = (res.data as any)?.persona;
                setWorker((prev) => prev ? { ...prev, onboardingDS44: updated?.onboardingDS44 || nextOnboarding } : prev);
                await loadWorkerData();
            }
        } catch (err) {
            console.error('Error marcando onboarding como listo:', err);
        } finally {
            setMarkingDone(null);
        }
    };

    const compliancePercent = compliance.assigned > 0
        ? (compliance.completed / compliance.assigned) * 100
        : 0;
    const compliancePercentRounded = Math.round(compliancePercent);

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    if (error || !worker) {
        return (
            <div className="page-content">
                <div className="card text-center p-12">
                    <LuCircleAlert size={48} className="text-danger-500 mb-4 mx-auto" />
                    <h2 className="text-xl font-bold mb-2">{error || 'Trabajador no encontrado'}</h2>
                    <button className="btn btn-primary" onClick={() => navigate('/personas')}>
                        Volver al listado
                    </button>
                </div>
            </div>
        );
    }

    return (
        <>
            <Header title={`Detalle: ${worker.nombre}`} />

            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <button
                            className="btn btn-ghost btn-sm mb-2"
                            onClick={() => navigate('/personas')}
                            style={{ marginLeft: '-12px' }}
                        >
                            <LuChevronLeft className="mr-1" /> Volver a Personas
                        </button>
                        <h2 className="page-header-title">
                            <LuUser className="text-primary-500" />
                            {worker.nombre} {worker.apellido}
                        </h2>
                        <p className="page-header-description">Vista detallada de perfil, estadísticas y cumplimiento.</p>
                    </div>
                    <div className="page-header-actions">
                        <button className="btn btn-secondary" onClick={downloadReport}>
                            <LuDownload className="mr-2" /> Exportar Reporte
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ gridTemplateRows: 'auto auto' }}>
                    {/* Columna Izquierda - Info del Trabajador */}
                    <div className="lg:col-span-1 lg:row-span-2">
                        <div className="card p-6 h-fit">
                            <div className="flex flex-col items-center text-center mb-6">
                                <div
                                    className="avatar mb-4"
                                    style={{ width: 80, height: 80, fontSize: '2rem', background: 'var(--primary-100)', color: 'var(--primary-600)' }}
                                >
                                    {worker.nombre.charAt(0)}
                                </div>
                                <h3 className="text-lg font-bold mb-1">{worker.nombre} {worker.apellido}</h3>
                                <div className={`badge mt-2 mb-3 badge-${worker.habilitado ? 'success' : 'warning'}`}>
                                    {worker.habilitado ? 'Habilitado' : 'Pendiente Enrolamiento'}
                                </div>

                                {/* Compliance Progress Bar */}
                                {(
                                    <div className="compliance-bar-container">
                                        <div className="compliance-header">
                                            <span className="compliance-label">Cumplimiento</span>
                                            <span className="compliance-percentage">
                                                {compliancePercentRounded}%
                                            </span>
                                        </div>
                                        <div className="compliance-bar-track">
                                            <div
                                                className="compliance-bar-fill"
                                                style={{
                                                    width: `${Math.min(compliancePercent, 100)}%`,
                                                    background: (() => {
                                                        const pct = compliancePercent;
                                                        if (pct >= 75) return 'linear-gradient(90deg, #22c55e, #16a34a)';
                                                        if (pct >= 50) return 'linear-gradient(90deg, #eab308, #ca8a04)';
                                                        return 'linear-gradient(90deg, #ef4444, #dc2626)';
                                                    })()
                                                }}
                                            />
                                        </div>
                                        <div className="compliance-detail">
                                            {compliance.assigned > 0
                                                ? `${compliance.completed} de ${compliance.assigned} cumplimientos`
                                                : 'Sin cumplimientos asignados'}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {ds44Checklist && (() => {
                                const pct = ds44Checklist.total > 0 ? Math.round((ds44Checklist.completed / ds44Checklist.total) * 100) : 0;
                                return (
                                    <div style={{ width: '100%', textAlign: 'left', marginTop: 'var(--space-3)' }}>
                                        {/* Header con progreso */}
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                                            <div className="text-xs text-muted" style={{ fontWeight: 700, letterSpacing: '0.08em' }}>ONBOARDING DS44</div>
                                            <span className={`badge ${pct >= 80 ? 'badge-success' : pct >= 50 ? 'badge-warning' : 'badge-danger'}`}>
                                                {ds44Checklist.completed}/{ds44Checklist.total}
                                            </span>
                                        </div>
                                        {/* Fecha de ingreso a la obra */}
                                        {worker.obraIds && worker.obraIds.length > 0 && (
                                            <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <LuBuild size={12} />
                                                Obra: {worker.obraIds.length} asignación{worker.obraIds.length !== 1 ? 'es' : ''}
                                                {(worker as any).createdAt && ` · Ingreso: ${new Date((worker as any).createdAt).toLocaleDateString('es-CL')}`}
                                            </div>
                                        )}

                                        {/* Barra de progreso */}
                                        <div style={{ height: '6px', borderRadius: '999px', overflow: 'hidden', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)', marginBottom: 'var(--space-3)' }}>
                                            <div style={{ width: `${pct}%`, height: '100%', background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444', transition: 'width 300ms' }} />
                                        </div>
                                        {/* Lista de 6 ítems */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            {ds44Checklist.items.map((item) => (
                                                <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', padding: '5px 0', borderBottom: '1px solid var(--surface-border)' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                                        <span style={{ flexShrink: 0, display: 'flex' }}>
                                                            {item.status === 'ok'
                                                                ? <LuCircleCheck size={15} style={{ color: '#10b981' }} />
                                                                : item.status === 'na'
                                                                ? <LuCircleMinus size={15} style={{ color: 'var(--text-muted)' }} />
                                                                : <LuClock size={15} style={{ color: 'var(--text-muted)' }} />
                                                            }
                                                        </span>
                                                        <div style={{ minWidth: 0 }}>
                                                            <div style={{ fontSize: '0.83rem', fontWeight: item.status === 'ok' ? 400 : 500, color: item.status === 'ok' ? 'var(--text-muted)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                {item.label}
                                                            </div>
                                                            <div className="text-muted" style={{ fontSize: '0.72rem' }}>{(item as any).articulo}</div>
                                                        </div>
                                                    </div>
                                                    {item.status === 'pending' && item.kind === 'document' ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                                            <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Pendiente</span>
                                                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--surface-border)', fontSize: '0.75rem', cursor: 'pointer', background: 'var(--surface-elevated)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                                                                {uploadingDocType === item.tipo
                                                                    ? <><LuClock size={11} /> Subiendo...</>
                                                                    : <><LuDownload size={11} /> Subir</>
                                                                }
                                                                <input type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }}
                                                                    disabled={!!uploadingDocType}
                                                                    onChange={(e) => { const f = e.target.files?.[0]; if (f && item.tipo) handleUploadWorkerDoc(item.tipo, f); if (e.target) e.target.value = ''; }}
                                                                />
                                                            </label>
                                                        </div>
                                                    ) : item.status === 'pending' ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                                            <span className="badge badge-warning" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Pendiente</span>
                                                            <button
                                                                className="btn btn-secondary"
                                                                style={{ padding: '2px 10px', fontSize: '0.72rem', flexShrink: 0 }}
                                                                disabled={markingDone === `${worker.workerId}:${item.tipo}`}
                                                                onClick={() => handleMarkOnboardingItem(item.tipo)}
                                                            >
                                                                {markingDone === `${worker.workerId}:${item.tipo}` ? '...' : 'Marcar listo'}
                                                            </button>
                                                        </div>
                                                    ) : null}
                                                    {item.status === 'ok' && (
                                                        <LuCircleCheck size={14} style={{ color: '#10b981', flexShrink: 0 }} />
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}

                            <div className="worker-info-list mt-2">
                                <div className="info-item">
                                    <LuIdCard className="icon" size={18} />
                                    <div className="content">
                                        <label>RUT</label>
                                        <span>{worker.rut}</span>
                                    </div>
                                </div>
                                <div className="info-item">
                                    <LuBriefcase className="icon" size={18} />
                                    <div className="content">
                                        <label>Cargo</label>
                                        <span>{worker.cargo || 'No asignado'}</span>
                                    </div>
                                </div>
                                <div className="info-item">
                                    <LuShield className="icon" size={18} />
                                    <div className="content">
                                        <label>Rol</label>
                                        <span>{worker.rol === 'admin' ? 'Administrador' : (worker.rol === 'prevencionista' ? 'Prevencionista' : 'Trabajador')}</span>
                                    </div>
                                </div>
                                <div className="info-item">
                                    <LuMail className="icon" size={18} />
                                    <div className="content">
                                        <label>Correo</label>
                                        <span>{worker.email || 'Sin correo registrado'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Resumen de Actividad - Ahora en la primera fila, segunda columna */}
                    {stats && (
                        <div className="lg:col-span-2">
                            <div className="card p-6">
                                <h4 className="text-sm font-bold uppercase tracking-wider text-muted mb-5 flex items-center gap-2">
                                    <LuTrendingUp size={16} /> Resumen de Actividad
                                </h4>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="detail-stat-box">
                                        <div className="val">{stats.totalFirmas}</div>
                                        <div className="lab">Firmas Totales</div>
                                    </div>
                                    <div className="detail-stat-box">
                                        <div className="val">{stats.firmasUltimos30Dias}</div>
                                        <div className="lab">Últimos 30 días</div>
                                    </div>
                                    <div className="detail-stat-box">
                                        <div className="val">{stats.documentosFirmados}</div>
                                        <div className="lab">Docs. Firmados</div>
                                    </div>
                                    <div className="detail-stat-box">
                                        <div className="val">{stats.actividadesAsistidas}</div>
                                        <div className="lab">Asistencias</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Historial de Cumplimiento - Segunda fila, segunda columna */}
                    <div className="lg:col-span-2">
                        <div className="card p-0 overflow-hidden h-full">
                            <div className="p-5 border-bottom flex items-center justify-between bg-surface-elevated">
                                <h3 className="font-bold flex items-center gap-2 m-0">
                                    <LuFileText className="text-primary-500" />
                                    Historial de Cumplimiento
                                </h3>
                                <span className="badge badge-secondary">{signatures.length} Registros</span>
                            </div>

                            <div className="signatures-timeline" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                {signatures.length === 0 ? (
                                    <div className="text-center text-muted" style={{ padding: '60px 48px' }}>
                                        <LuClock size={40} className="mb-3 mx-auto opacity-20" />
                                        <p style={{ marginTop: '8px' }}>No se registran actividades o firmas aún.</p>
                                    </div>
                                ) : (
                                    <div className="table-container">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: '20%' }}>Tipo</th>
                                                    <th style={{ width: '40%' }}>Documento / Actividad</th>
                                                    <th style={{ width: '20%' }}>Fecha</th>
                                                    <th style={{ width: '20%' }}>Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {signatures.map((sig, i) => (
                                                    <tr key={i}>
                                                        <td>
                                                            <div className="flex items-center gap-2">
                                                                <div
                                                                    className="avatar avatar-sm"
                                                                    style={{
                                                                        background: sig.tipoFirma === 'enrolamiento' ? 'var(--success-100)' : 'var(--primary-100)',
                                                                        color: sig.tipoFirma === 'enrolamiento' ? 'var(--success-600)' : 'var(--primary-600)'
                                                                    }}
                                                                >
                                                                    {getSigIcon(sig)}
                                                                </div>
                                                                <span className="text-xs font-semibold">
                                                                    {REQUEST_TYPES[(sig as any).requestTipo]?.label || sig.tipoFirma?.replace('_', ' ')}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <div className="font-medium text-sm">
                                                                {(sig as any).requestTitulo || (sig.metadata as any)?.titulo || (sig.metadata as any)?.documentoNombre || 'Registro de Sistema'}
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <div className="text-sm">{sig.fecha}</div>
                                                            <div className="text-xs text-muted">{sig.horario}</div>
                                                        </td>
                                                        <td>
                                                            <span className={`badge badge-sm badge-${sig.estado === 'valida' ? 'success' : 'warning'}`}>
                                                                {sig.estado === 'valida' ? <LuCircleCheck className="mr-1" /> : null}
                                                                {sig.estado === 'valida' ? 'Válida' : sig.estado}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                .page-content {
                    padding-bottom: var(--space-6);
                }
                
                /* Compliance Progress Bar */
                .compliance-bar-container {
                    width: 100%;
                    padding: var(--space-4);
                    background: var(--surface-elevated);
                    border-radius: var(--radius-lg);
                    border: 1px solid var(--surface-border);
                    margin-top: var(--space-2);
                }
                
                .compliance-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: var(--space-2);
                }
                
                .compliance-label {
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--text-muted);
                }
                
                .compliance-percentage {
                    font-size: var(--text-lg);
                    font-weight: 800;
                    color: var(--text-primary);
                }
                
                .compliance-bar-track {
                    width: 100%;
                    height: 12px;
                    background: var(--surface-border);
                    border-radius: 6px;
                    overflow: hidden;
                    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
                }
                
                .compliance-bar-fill {
                    height: 100%;
                    border-radius: 6px;
                    transition: width 0.5s ease-out;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }
                
                .compliance-detail {
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                    text-align: center;
                    margin-top: var(--space-2);
                }
                
                .worker-info-list {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-4);
                }
                
                .info-item {
                    display: flex;
                    gap: var(--space-3);
                    align-items: flex-start;
                    padding: var(--space-1) 0;
                }
                
                .info-item .icon {
                    margin-top: 2px;
                    color: var(--text-muted);
                    flex-shrink: 0;
                }
                
                .info-item .content {
                    display: flex;
                    flex-direction: column;
                    flex: 1;
                }
                
                .info-item label {
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--text-muted);
                    font-weight: 700;
                    margin-bottom: 2px;
                }
                
                .info-item span {
                    font-size: var(--text-sm);
                    color: var(--text-primary);
                    font-weight: 500;
                    word-break: break-word;
                }
                
                .detail-stat-box {
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    padding: var(--space-4);
                    text-align: center;
                    transition: transform 0.2s, box-shadow 0.2s;
                }
                
                .detail-stat-box:hover {
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-md);
                }
                
                .detail-stat-box .val {
                    font-size: var(--text-xl);
                    font-weight: 800;
                    color: var(--primary-500);
                    line-height: 1.2;
                    margin-bottom: var(--space-1);
                }
                
                .detail-stat-box .lab {
                    font-size: 10px;
                    text-transform: uppercase;
                    color: var(--text-muted);
                    font-weight: 600;
                    letter-spacing: 0.05em;
                }
                
                .border-bottom {
                    border-bottom: 1px solid var(--surface-border);
                }
                
                .signatures-timeline {
                    position: relative;
                }
                
                .table-container {
                    overflow-x: auto;
                }
                
                .table {
                    width: 100%;
                    min-width: 600px;
                }
                
                .table th {
                    position: sticky;
                    top: 0;
                    background: var(--surface-card);
                    z-index: 1;
                    padding: var(--space-3) var(--space-4);
                    font-size: var(--text-xs);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--text-muted);
                    font-weight: 700;
                    border-bottom: 1px solid var(--surface-border);
                }
                
                .table td {
                    padding: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    vertical-align: middle;
                }
                
                .table tbody tr {
                    transition: background-color 0.2s;
                }
                
                .table tbody tr:hover {
                    background-color: var(--surface-hover);
                }
                
                /* Responsive adjustments */
                @media (max-width: 1024px) {
                    .detail-stat-box .val {
                        font-size: var(--text-lg);
                    }
                    
                    .grid.grid-cols-1.lg\\:grid-cols-3 {
                        display: flex;
                        flex-direction: column;
                        gap: var(--space-4);
                    }
                    
                    .lg\\:col-span-1,
                    .lg\\:col-span-2 {
                        width: 100%;
                    }
                }
                
                @media (max-width: 768px) {
                    .detail-stat-box {
                        padding: var(--space-3);
                    }
                    
                    .detail-stat-box .val {
                        font-size: var(--text-base);
                    }
                    
                    .detail-stat-box .lab {
                        font-size: 9px;
                    }
                    
                    .page-header {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: var(--space-3);
                    }
                    
                    .page-header-actions {
                        width: 100%;
                    }
                    
                    .page-header-actions .btn {
                        width: 100%;
                    }
                    
                    .table th,
                    .table td {
                        padding: var(--space-3) var(--space-2);
                    }
                }
                
                @media (max-width: 640px) {
                    .card {
                        padding: var(--space-4);
                    }
                    
                    .info-item {
                        flex-direction: column;
                        gap: var(--space-1);
                    }
                    
                    .info-item .icon {
                        align-self: flex-start;
                    }
                    
                    .grid.grid-cols-2.lg\\:grid-cols-4 {
                        grid-template-columns: repeat(2, 1fr);
                        gap: var(--space-3);
                    }
                }
                
                @media (max-width: 480px) {
                    .grid.grid-cols-2.lg\\:grid-cols-4 {
                        grid-template-columns: 1fr;
                    }
                    
                    .detail-stat-box {
                        padding: var(--space-3);
                    }
                }
            `}</style>
        </>
    );
}