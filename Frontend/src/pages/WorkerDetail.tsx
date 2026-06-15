import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    LuChevronLeft,
    LuUser,
    LuMail,
    LuIdCard,
    LuTrendingUp,
    LuFileText,
    LuActivity,
    LuCircleCheck,
    LuCircleAlert,
    LuDownload,
    LuClock,
    LuBriefcase,
    LuShield,
    LuUsers,
    LuCircleMinus,
    LuPlus,
    LuMinus,
    LuTrash2,
    LuShieldCheck,
    LuBuilding2 as LuBuild
} from 'react-icons/lu';
import {
    workersApi,
    documentsApi,
    uploadsApi,
    signaturesApi,
    signatureRequestsApi,
    personasApi,
    type Worker as ApiWorker,
    type DigitalSignature,
    REQUEST_TYPES
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../permissions';
import { useObraContext } from '../context/ObraContext';
import { Modal } from '../components/ui';
import { DS44_ONBOARDING_ITEMS, getCargoLabel } from '../utils/ds44';

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

// EPP de uso frecuente — sugerencias para el selector de items (Art. 13 DS44)
const EPP_COMUNES = [
    'Casco de seguridad',
    'Guantes de seguridad',
    'Zapatos de seguridad',
    'Lentes de seguridad',
    'Protección auditiva',
    'Mascarilla / Respirador',
    'Arnés de seguridad',
    'Chaleco reflectante',
    'Protector facial',
    'Ropa de trabajo',
];

// Item de EPP dentro del formulario de entrega
interface EppItemDraft {
    descripcion: string;
    cantidad: number;
    talla: string;
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
    const { user, hasPermission } = useAuth();
    const authTenantId = user?.tenantId || localStorage.getItem('tenant_id') || '';
    // Permisos de la ficha del trabajador
    const canValidarEpp = hasPermission(PERMISSIONS.PERSONA_EPP);
    const canExportar = hasPermission(PERMISSIONS.PERSONA_EXPORTAR);
    const canOnboarding = hasPermission(PERMISSIONS.PERSONA_ONBOARDING);
    const canVigilancia = hasPermission(PERMISSIONS.PERSONA_VIGILANCIA_SALUD);

    const [worker, setWorker] = useState<WorkerWithRole | null>(null);
    const [stats, setStats] = useState<WorkerStats | null>(null);
    const [signatures, setSignatures] = useState<DigitalSignature[]>([]);
    const [compliance, setCompliance] = useState({ completed: 0, assigned: 0 });
    const [ds44Checklist, setDs44Checklist] = useState<{ completed: number; total: number; items: Array<{ key: string; label: string; articulo?: string; kind?: string; tipo?: string; actionLabel?: string; firmaInfo?: string; status: 'ok' | 'pending' | 'na' | 'subido' }> } | null>(null);
    const [docRecordMap, setDocRecordMap] = useState<Record<string, { documentId: string; s3Key: string | null; archivoNombre: string | null }>>({});
    const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // Vigilancia de salud (Art. 67/73) — editable desde la ficha del trabajador
    const [vigForm, setVigForm] = useState({ enVigilancia: false, protocolos: '', fechaUltimoExamen: '', aptitudLaboral: '', restricciones: '' });
    const [vigEditing, setVigEditing] = useState(false);
    const [vigSaving, setVigSaving] = useState(false);
    // Historial de EPP (Art. 13) — entregas/reposiciones validadas por instancia superior
    const [eppHistorial, setEppHistorial] = useState<any[]>([]);
    const [eppModalOpen, setEppModalOpen] = useState(false);
    const [eppForm, setEppForm] = useState({ esReposicion: false, motivoReposicion: 'desgaste', capacitacionMinutos: '60', capacitacionCompletada: true });
    const [eppItems, setEppItems] = useState<EppItemDraft[]>([{ descripcion: '', cantidad: 1, talla: '' }]);
    const [eppSaving, setEppSaving] = useState(false);
    const [eppError, setEppError] = useState('');
    const [eppValidating, setEppValidating] = useState<string | null>(null);

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

    // Sincroniza el formulario de vigilancia con los datos del trabajador.
    useEffect(() => {
        const v = (worker as any)?.vigilanciaSalud;
        if (!v) return;
        setVigForm({
            enVigilancia: Boolean(v.enVigilancia),
            protocolos: Array.isArray(v.protocolos) ? v.protocolos.join(', ') : (v.protocolos || ''),
            fechaUltimoExamen: v.fechaUltimoExamen ? String(v.fechaUltimoExamen).slice(0, 10) : '',
            aptitudLaboral: v.aptitudLaboral || '',
            restricciones: Array.isArray(v.restricciones) ? v.restricciones.join(', ') : (v.restricciones || ''),
        });
    }, [worker]);

    const handleSaveVigilancia = async () => {
        if (!worker) return;
        setVigSaving(true);
        try {
            const vigilanciaSalud = {
                enVigilancia: vigForm.enVigilancia,
                protocolos: vigForm.protocolos.split(',').map((s) => s.trim()).filter(Boolean),
                fechaUltimoExamen: vigForm.fechaUltimoExamen || null,
                aptitudLaboral: vigForm.aptitudLaboral || null,
                restricciones: vigForm.restricciones.split(',').map((s) => s.trim()).filter(Boolean),
            };
            const res = await workersApi.update(worker.personaId, { vigilanciaSalud } as any);
            if (res.success) {
                setVigEditing(false);
                await loadWorkerData();
            }
        } catch (err) {
            console.error('Error guardando vigilancia de salud:', err);
        } finally {
            setVigSaving(false);
        }
    };

    const loadEppHistorial = async (personaId: string) => {
        try {
            const res = await personasApi.getHistorialEpp(authTenantId, personaId);
            if (res.success && res.data) setEppHistorial(res.data.entregas || []);
        } catch (err) {
            console.error('Error cargando historial EPP:', err);
        }
    };

    useEffect(() => {
        if (worker?.personaId) loadEppHistorial(worker.personaId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [worker?.personaId]);

    const resetEppForm = () => {
        setEppForm({ esReposicion: false, motivoReposicion: 'desgaste', capacitacionMinutos: '60', capacitacionCompletada: true });
        setEppItems([{ descripcion: '', cantidad: 1, talla: '' }]);
        setEppError('');
    };

    const addEppItem = () => setEppItems((prev) => [...prev, { descripcion: '', cantidad: 1, talla: '' }]);

    const updateEppItem = (index: number, field: keyof EppItemDraft, value: string | number) =>
        setEppItems((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));

    const removeEppItem = (index: number) =>
        setEppItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : [{ descripcion: '', cantidad: 1, talla: '' }]));

    const handleCrearEntregaEpp = async () => {
        if (!worker || !user?.personaId) return;
        const items = eppItems
            .map((it) => ({
                descripcion: it.descripcion.trim(),
                cantidad: Math.max(1, Number(it.cantidad) || 1),
                talla: it.talla.trim() || null,
            }))
            .filter((it) => it.descripcion);
        if (items.length === 0) { setEppError('Agrega al menos un ítem con su descripción.'); return; }
        setEppSaving(true);
        setEppError('');
        try {
            const res = await personasApi.crearEntregaEpp(authTenantId, worker.personaId, {
                creadorId: user.personaId,
                obraId: selectedObraId || worker.obraIds?.[0] || null,
                itemsEntregados: items,
                esReposicion: eppForm.esReposicion,
                motivoReposicion: eppForm.esReposicion ? eppForm.motivoReposicion : null,
                capacitacion: {
                    completada: eppForm.capacitacionCompletada,
                    duracionRealMinutos: Number(eppForm.capacitacionMinutos) || null,
                    relatorId: user.personaId
                }
            });
            if (!res.success) { setEppError(res.error || 'No se pudo registrar la entrega.'); return; }
            setEppModalOpen(false);
            resetEppForm();
            await loadEppHistorial(worker.personaId);
        } catch {
            setEppError('Error de conexion.');
        } finally {
            setEppSaving(false);
        }
    };

    const handleValidarEntrega = async (entregaDocumentId: string) => {
        if (!worker || !user?.personaId) return;
        setEppValidating(entregaDocumentId);
        try {
            const res = await personasApi.validarEntregaEpp(authTenantId, worker.personaId, {
                entregaDocumentId,
                validadorId: user.personaId
            });
            if (res.success) await loadEppHistorial(worker.personaId);
        } catch (err) {
            console.error('Error validando entrega EPP:', err);
        } finally {
            setEppValidating(null);
        }
    };

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
                signaturesApi.getByWorker(workerRes.data.personaId),
                signatureRequestsApi.getPendingByWorker(workerRes.data.personaId),
                signatureRequestsApi.getHistoryByWorker(workerRes.data.personaId),
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
            // Tri-estado por tipo: firmado (ok) vs subido-sin-firma (subido) vs nada (pending).
            // "ok" SOLO con firma real del trabajador; subir el archivo NO completa.
            const docSigned = new Map<string, boolean>();
            const docHasFile = new Map<string, boolean>();
            // Firma cruzada (CAPACITACION_SST): completo solo si relator + trabajador firmaron.
            const docRelatorPendiente = new Map<string, boolean>();
            const newDocRecordMap: Record<string, { documentId: string; s3Key: string | null; archivoNombre: string | null }> = {};
            docs.forEach((doc: any) => {
                const hasFile = Boolean(doc.s3Key || doc.archivoUrl);
                const relatorPendiente = Boolean(doc.requiereFirmaRelator) && doc.firmaRelator?.estado !== 'firmado';
                (doc.asignaciones || []).forEach((asig: any) => {
                    const personaId = asig.personaId;
                    if (personaId !== workerRes.data.personaId) return;
                    if (!doc.tipo) return;
                    if (asig.estado === 'firmado' || asig.fechaFirma) docSigned.set(doc.tipo, true);
                    if (hasFile) docHasFile.set(doc.tipo, true);
                    if (relatorPendiente) docRelatorPendiente.set(doc.tipo, true);
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
                    const trabajadorFirmo = docSigned.get(item.tipo) || false;
                    const relatorPendiente = docRelatorPendiente.get(item.tipo) || false;
                    const signed = (trabajadorFirmo && !relatorPendiente) || manualDone;
                    const subido = docHasFile.get(item.tipo) || trabajadorFirmo;
                    if (signed) ds44Completed += 1;
                    const status = signed ? 'ok' as const : subido ? 'subido' as const : 'pending' as const;
                    const firmaInfo = relatorPendiente && !signed
                        ? `Trabajador: ${trabajadorFirmo ? 'firmado' : 'pendiente'} | Relator: pendiente`
                        : undefined;
                    return { key: item.key, label: item.label, articulo: item.articulo, kind: item.kind, tipo: item.tipo, actionLabel: item.actionLabel, status, firmaInfo };
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
- Cargo: ${getCargoLabel(worker.cargo) || 'N/A'}
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
                    {canExportar && (
                        <div className="page-header-actions">
                            <button className="btn btn-secondary" onClick={downloadReport}>
                                <LuDownload className="mr-2" /> Exportar Reporte
                            </button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ gridTemplateRows: 'auto auto' }}>
                    {/* Columna Izquierda - Info del Trabajador */}
                    <div className="lg:col-span-1 lg:row-span-2">
                        <div className="card p-6 h-fit">
                            <div className="flex flex-col items-center text-center mb-6">
                                <div
                                    className="avatar mb-4"
                                    style={{ width: 80, height: 80, fontSize: '2rem', background: 'var(--primary-100)', color: 'var(--primary-600)', overflow: 'hidden', padding: (worker as any).fotoPerfil ? 0 : undefined }}
                                >
                                    {(worker as any).fotoPerfil
                                        ? <img src={(worker as any).fotoPerfil} alt={worker.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : worker.nombre.charAt(0)}
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
                                                                : <LuClock size={15} style={{ color: item.status === 'subido' ? '#f59e0b' : 'var(--text-muted)' }} />
                                                            }
                                                        </span>
                                                        <div style={{ minWidth: 0 }}>
                                                            <div style={{ fontSize: '0.83rem', fontWeight: item.status === 'ok' ? 400 : 500, color: item.status === 'ok' ? 'var(--text-muted)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                {item.label}
                                                            </div>
                                                            <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                                                                {(item as any).articulo}
                                                                {(item as any).firmaInfo && <span style={{ color: '#f59e0b' }}> · {(item as any).firmaInfo}</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {/* Documento sin archivo: subir (no completa, queda pendiente de firma) */}
                                                    {item.status === 'pending' && item.kind === 'document' ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                                            <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Pendiente de subir</span>
                                                            {canOnboarding && (
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
                                                            )}
                                                        </div>
                                                    ) : item.status === 'subido' ? (
                                                        /* Documento subido, falta la firma del trabajador (firma asistida desde la obra) */
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                                            <span className="badge badge-warning" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Pendiente de firma</span>
                                                            {canOnboarding && (
                                                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--surface-border)', fontSize: '0.75rem', cursor: 'pointer', background: 'var(--surface-elevated)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                                                                {uploadingDocType === item.tipo
                                                                    ? <><LuClock size={11} /> Subiendo...</>
                                                                    : <><LuDownload size={11} /> Reemplazar</>
                                                                }
                                                                <input type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }}
                                                                    disabled={!!uploadingDocType}
                                                                    onChange={(e) => { const f = e.target.files?.[0]; if (f && item.tipo) handleUploadWorkerDoc(item.tipo, f); if (e.target) e.target.value = ''; }}
                                                                />
                                                            </label>
                                                            )}
                                                        </div>
                                                    ) : item.status === 'pending' ? (
                                                        <span className="badge badge-warning" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap', flexShrink: 0 }}>Pendiente de firma</span>
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
                                        <span>{getCargoLabel(worker.cargo) || 'No asignado'}</span>
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

                    {/* Historial de EPP (Art. 13) — entregas y reposiciones validadas */}
                    <div className="lg:col-span-2">
                        <div className="card" style={{ padding: 'var(--space-4)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
                                <h3 className="font-bold m-0">
                                    Historial de EPP <span className="text-muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>(Art. 13 — entregas y reposiciones)</span>
                                </h3>
                                {canValidarEpp && (
                                    <button className="btn btn-primary btn-sm" type="button" onClick={() => { resetEppForm(); setEppModalOpen(true); }}>
                                        Nueva entrega / Reposición
                                    </button>
                                )}
                            </div>
                            {eppHistorial.length === 0 ? (
                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>Sin entregas de EPP registradas.</div>
                            ) : (
                                <div className="table-container" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Fecha</th><th>Items</th><th>Reposición</th><th>Validado por</th><th>Capacitación uso</th><th>Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {eppHistorial.map((e: any) => {
                                                const validado = e.validacion?.estado === 'validado';
                                                return (
                                                    <tr key={e.documentId}>
                                                        <td className="text-sm">{e.fecha ? new Date(e.fecha).toLocaleDateString('es-CL') : '-'}</td>
                                                        <td className="text-sm">{(e.itemsEntregados || []).map((i: any) => `${i.descripcion} x${i.cantidad}${i.talla ? ` (${i.talla})` : ''}`).join(', ') || '-'}</td>
                                                        <td className="text-sm">{e.esReposicion ? (e.motivoReposicion || 'Sí') : 'No'}</td>
                                                        <td className="text-sm">{e.validacion?.validadoPor?.nombre || '-'}</td>
                                                        <td className="text-sm">{e.capacitacionUso?.completada ? `${e.capacitacionUso.duracionRealMinutos || 60} min` : 'Pendiente'}</td>
                                                        <td>
                                                            {e.firmadoPorTrabajador
                                                                ? <span className="badge badge-success">Firmado</span>
                                                                : validado
                                                                    ? <span className="badge badge-info">Validado, falta firma</span>
                                                                    : (
                                                                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                                            <span className="badge badge-warning">Pendiente validación</span>
                                                                            {canValidarEpp && (
                                                                                <button className="btn btn-secondary btn-sm" type="button"
                                                                                    disabled={eppValidating === e.documentId}
                                                                                    onClick={() => handleValidarEntrega(e.documentId)}>
                                                                                    {eppValidating === e.documentId ? '...' : 'Validar entrega'}
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Vigilancia de Salud (Art. 67/73) */}
                    <div className="lg:col-span-2">
                        <div className="card" style={{ padding: 'var(--space-4)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                                <h3 className="font-bold flex items-center gap-2 m-0">
                                    <LuActivity className="text-primary-500" />
                                    Vigilancia de Salud <span className="text-muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>(Art. 67/73)</span>
                                </h3>
                                {canVigilancia && (!vigEditing ? (
                                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => setVigEditing(true)}>Editar</button>
                                ) : (
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setVigEditing(false); }}>Cancelar</button>
                                        <button className="btn btn-primary btn-sm" type="button" disabled={vigSaving} onClick={handleSaveVigilancia}>{vigSaving ? 'Guardando…' : 'Guardar'}</button>
                                    </div>
                                ))}
                            </div>

                            {!vigEditing ? (
                                <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '6px 12px', fontSize: '0.88rem' }}>
                                    <div className="text-muted">En vigilancia</div>
                                    <div>
                                        <span className={`badge ${vigForm.enVigilancia ? 'badge-warning' : 'badge-secondary'}`}>{vigForm.enVigilancia ? 'Sí' : 'No'}</span>
                                    </div>
                                    <div className="text-muted">Protocolos</div><div>{vigForm.protocolos || '—'}</div>
                                    <div className="text-muted">Último examen</div><div>{vigForm.fechaUltimoExamen || '—'}</div>
                                    <div className="text-muted">Aptitud laboral</div><div>{vigForm.aptitudLaboral || '—'}</div>
                                    <div className="text-muted">Restricciones</div><div>{vigForm.restricciones || '—'}</div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <input type="checkbox" checked={vigForm.enVigilancia} onChange={(e) => setVigForm({ ...vigForm, enVigilancia: e.target.checked })} />
                                        <span>En programa de vigilancia de la salud</span>
                                    </label>
                                    <div className="form-group"><label className="form-label">Protocolos</label><input type="text" className="form-input" placeholder="Ej: PLANESI, Ruido, Sílice" value={vigForm.protocolos} onChange={(e) => setVigForm({ ...vigForm, protocolos: e.target.value })} /><span className="form-hint">Separar con coma</span></div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="form-group"><label className="form-label">Último examen</label><input type="date" className="form-input" value={vigForm.fechaUltimoExamen} onChange={(e) => setVigForm({ ...vigForm, fechaUltimoExamen: e.target.value })} /></div>
                                        <div className="form-group"><label className="form-label">Aptitud laboral</label><input type="text" className="form-input" placeholder="apto / apto con restricciones / no apto" value={vigForm.aptitudLaboral} onChange={(e) => setVigForm({ ...vigForm, aptitudLaboral: e.target.value })} /></div>
                                    </div>
                                    <div className="form-group"><label className="form-label">Restricciones</label><input type="text" className="form-input" placeholder="Ej: No trabajo en altura" value={vigForm.restricciones} onChange={(e) => setVigForm({ ...vigForm, restricciones: e.target.value })} /><span className="form-hint">Separar con coma</span></div>
                                </div>
                            )}
                        </div>
                    </div>

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

            {/* Modal: nueva entrega / reposicion de EPP (solo instancia superior) */}
            <Modal
                isOpen={eppModalOpen}
                onClose={() => { setEppModalOpen(false); resetEppForm(); }}
                title="Nueva entrega / Reposición de EPP"
                subtitle="Art. 13 DS44 — La entrega queda pendiente de validación y de firma del trabajador"
                size="lg"
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
                        <button className="btn btn-secondary" onClick={() => { setEppModalOpen(false); resetEppForm(); }}>Cancelar</button>
                        <button className="btn btn-primary" onClick={handleCrearEntregaEpp} disabled={eppSaving}>
                            {eppSaving ? 'Guardando…' : 'Registrar entrega'}
                        </button>
                    </div>
                }
            >
                <div className="epp-modal">
                    {eppError && (
                        <div className="epp-alert" role="alert">
                            <LuCircleAlert size={15} />
                            <span>{eppError}</span>
                        </div>
                    )}

                    {/* ── Items entregados ── */}
                    <section className="epp-section">
                        <div className="epp-section-head">
                            <div className="epp-section-title">
                                <LuShieldCheck size={15} className="text-primary-500" />
                                <span>Elementos entregados</span>
                            </div>
                            <span className="epp-count">{eppItems.filter(i => i.descripcion.trim()).length} ítem(s)</span>
                        </div>

                        <datalist id="epp-comunes">
                            {EPP_COMUNES.map((n) => <option key={n} value={n} />)}
                        </datalist>

                        <div className="epp-items">
                            {eppItems.map((item, index) => (
                                <div className="epp-item-card" key={index}>
                                    <div className="epp-item-card-header">
                                        <span className="epp-item-badge">Ítem {index + 1}</span>
                                        <button
                                            type="button"
                                            className="epp-remove"
                                            onClick={() => removeEppItem(index)}
                                            title="Quitar ítem"
                                            aria-label="Quitar ítem"
                                        >
                                            <LuTrash2 size={14} />
                                        </button>
                                    </div>
                                    <div className="epp-item-desc">
                                        <label className="epp-mini-label">Elemento de protección personal</label>
                                        <input
                                            className="form-input"
                                            list="epp-comunes"
                                            placeholder="Ej. Casco de seguridad"
                                            value={item.descripcion}
                                            onChange={(e) => updateEppItem(index, 'descripcion', e.target.value)}
                                            autoFocus={index === 0 && !item.descripcion}
                                        />
                                    </div>
                                    <div className="epp-item-meta">
                                        <div className="epp-item-qty">
                                            <label className="epp-mini-label">Cantidad</label>
                                            <div className="epp-stepper">
                                                <button
                                                    type="button"
                                                    className="epp-step-btn"
                                                    onClick={() => updateEppItem(index, 'cantidad', Math.max(1, (Number(item.cantidad) || 1) - 1))}
                                                    aria-label="Disminuir cantidad"
                                                >
                                                    <LuMinus size={13} />
                                                </button>
                                                <input
                                                    className="epp-step-input"
                                                    type="number"
                                                    min={1}
                                                    value={item.cantidad}
                                                    onChange={(e) => updateEppItem(index, 'cantidad', Math.max(1, Number(e.target.value) || 1))}
                                                />
                                                <button
                                                    type="button"
                                                    className="epp-step-btn"
                                                    onClick={() => updateEppItem(index, 'cantidad', (Number(item.cantidad) || 1) + 1)}
                                                    aria-label="Aumentar cantidad"
                                                >
                                                    <LuPlus size={13} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="epp-item-size">
                                            <label className="epp-mini-label">Talla <span className="epp-opt">(opcional)</span></label>
                                            <input
                                                className="form-input"
                                                placeholder="M, 42…"
                                                value={item.talla}
                                                onChange={(e) => updateEppItem(index, 'talla', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <button type="button" className="epp-add-btn" onClick={addEppItem}>
                            <LuPlus size={15} /> Agregar ítem
                        </button>
                    </section>

                    {/* ── Reposición ── */}
                    <section className="epp-section">
                        <label className="epp-toggle">
                            <input type="checkbox" checked={eppForm.esReposicion} onChange={(e) => setEppForm({ ...eppForm, esReposicion: e.target.checked })} />
                            <span className="epp-toggle-text">
                                <span className="epp-toggle-title">Es una reposición</span>
                                <span className="epp-toggle-desc">Reemplazo de un EPP ya entregado</span>
                            </span>
                        </label>
                        {eppForm.esReposicion && (
                            <div className="form-group epp-sub-field">
                                <label className="form-label">Motivo de reposición</label>
                                <select className="form-input form-select" value={eppForm.motivoReposicion} onChange={(e) => setEppForm({ ...eppForm, motivoReposicion: e.target.value })}>
                                    <option value="desgaste">Desgaste</option>
                                    <option value="perdida">Pérdida</option>
                                    <option value="accidente">Accidente</option>
                                    <option value="cambio_talla">Cambio de talla</option>
                                    <option value="otro">Otro</option>
                                </select>
                            </div>
                        )}
                    </section>

                    {/* ── Capacitación de uso ── */}
                    <section className="epp-section">
                        <label className="epp-toggle">
                            <input type="checkbox" checked={eppForm.capacitacionCompletada} onChange={(e) => setEppForm({ ...eppForm, capacitacionCompletada: e.target.checked })} />
                            <span className="epp-toggle-text">
                                <span className="epp-toggle-title">Capacitación de uso realizada</span>
                                <span className="epp-toggle-desc">Art. 13 — instrucción sobre el uso correcto del EPP</span>
                            </span>
                        </label>
                        {eppForm.capacitacionCompletada && (
                            <div className="form-group epp-sub-field">
                                <label className="form-label">Duración de la capacitación (minutos)</label>
                                <input type="number" className="form-input" min={0} value={eppForm.capacitacionMinutos} onChange={(e) => setEppForm({ ...eppForm, capacitacionMinutos: e.target.value })} />
                                <span className="form-hint">Mínimo recomendado: 60 minutos.</span>
                            </div>
                        )}
                    </section>
                </div>

                <style>{`
                    /* ── EPP modal wrapper ── */
                    .epp-modal {
                        display: flex;
                        flex-direction: column;
                        gap: var(--space-4);
                    }
                    /* ── Alert ── */
                    .epp-modal .epp-alert {
                        display: flex; align-items: center; gap: 8px;
                        padding: 10px 14px; border-radius: var(--radius-md);
                        background: rgba(239, 68, 68, 0.08);
                        border: 1px solid rgba(239, 68, 68, 0.25);
                        color: var(--danger-600, #b91c1c); font-size: 0.82rem;
                    }
                    /* ── Section card ── */
                    .epp-section {
                        background: var(--surface-elevated);
                        border: 1px solid var(--surface-border);
                        border-radius: var(--radius-lg);
                        padding: var(--space-5);
                    }
                    .epp-section-head {
                        display: flex; align-items: center; justify-content: space-between;
                        margin-bottom: var(--space-4);
                    }
                    .epp-section-title {
                        display: flex; align-items: center; gap: 8px;
                        font-weight: 600; font-size: 0.9rem; color: var(--text-primary);
                    }
                    .epp-count {
                        font-size: 0.72rem; font-weight: 600;
                        color: var(--text-muted);
                        background: var(--surface-border);
                        padding: 2px 8px; border-radius: var(--radius-full);
                    }
                    /* ── Item list ── */
                    .epp-items { display: flex; flex-direction: column; gap: 10px; }
                    /* ── Item card ── */
                    .epp-item-card {
                        background: var(--surface-card);
                        border: 1px solid var(--surface-border);
                        border-radius: var(--radius-md);
                        padding: 14px 16px;
                        display: flex;
                        flex-direction: column;
                        gap: 12px;
                        transition: border-color 0.15s;
                    }
                    .epp-item-card:focus-within {
                        border-color: var(--primary-400);
                    }
                    .epp-item-card-header {
                        display: flex; align-items: center; justify-content: space-between;
                    }
                    .epp-item-badge {
                        font-size: 0.68rem; font-weight: 700;
                        text-transform: uppercase; letter-spacing: 0.06em;
                        color: var(--text-muted);
                    }
                    .epp-item-desc { width: 100%; }
                    /* ── Item meta row: qty + talla ── */
                    .epp-item-meta {
                        display: grid;
                        grid-template-columns: 180px 1fr;
                        gap: 12px;
                        align-items: end;
                    }
                    /* ── Labels ── */
                    .epp-mini-label {
                        display: block; font-size: 0.7rem; font-weight: 600;
                        text-transform: uppercase; letter-spacing: 0.03em;
                        color: var(--text-muted); margin-bottom: 4px;
                    }
                    .epp-opt { font-weight: 400; text-transform: none; letter-spacing: 0; }
                    /* ── Quantity stepper ── */
                    .epp-stepper {
                        display: flex; align-items: center;
                        border: 1px solid var(--surface-border);
                        border-radius: var(--radius-md);
                        background: var(--surface-card);
                        overflow: hidden; height: 38px;
                    }
                    .epp-step-btn {
                        display: flex; align-items: center; justify-content: center;
                        width: 36px; height: 100%; border: none; cursor: pointer; flex-shrink: 0;
                        background: var(--surface-elevated); color: var(--text-primary);
                        transition: background 0.15s;
                    }
                    .epp-step-btn:hover { background: var(--surface-hover); color: var(--primary-500); }
                    .epp-step-input {
                        flex: 1; min-width: 0; text-align: center; border: none; outline: none;
                        background: transparent; color: var(--text-primary);
                        font-size: 0.9rem; font-weight: 600;
                        -moz-appearance: textfield;
                    }
                    .epp-step-input::-webkit-outer-spin-button,
                    .epp-step-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
                    /* ── Remove button ── */
                    .epp-remove {
                        display: flex; align-items: center; justify-content: center;
                        width: 30px; height: 30px; border-radius: var(--radius-md);
                        border: 1px solid var(--surface-border); background: transparent;
                        color: var(--text-muted); cursor: pointer; transition: all 0.15s; flex-shrink: 0;
                    }
                    .epp-remove:hover {
                        color: var(--danger-500, #ef4444);
                        border-color: rgba(239, 68, 68, 0.35);
                        background: rgba(239, 68, 68, 0.06);
                    }
                    /* ── Add item button ── */
                    .epp-add-btn {
                        display: flex; align-items: center; justify-content: center; gap: 6px;
                        margin-top: 10px; padding: 9px 14px; width: 100%;
                        border: 1px dashed var(--primary-400); border-radius: var(--radius-md);
                        background: transparent; color: var(--primary-500);
                        font-size: 0.83rem; font-weight: 600; cursor: pointer;
                        transition: all 0.15s;
                    }
                    .epp-add-btn:hover {
                        background: rgba(0, 110, 220, 0.06);
                        border-color: var(--primary-500);
                    }
                    /* ── Toggle (checkbox + text) ── */
                    .epp-toggle {
                        display: flex; align-items: flex-start; gap: 12px; cursor: pointer;
                    }
                    .epp-toggle input { margin-top: 2px; width: 16px; height: 16px; flex-shrink: 0; cursor: pointer; }
                    .epp-toggle-text { display: flex; flex-direction: column; gap: 3px; }
                    .epp-toggle-title { font-weight: 600; font-size: 0.88rem; color: var(--text-primary); }
                    .epp-toggle-desc { font-size: 0.76rem; color: var(--text-muted); line-height: 1.4; }
                    /* ── Sub-field (conditional) ── */
                    .epp-sub-field { margin: var(--space-4) 0 0; }
                    /* ── Responsive ── */
                    @media (max-width: 520px) {
                        .epp-item-meta { grid-template-columns: 1fr 1fr; }
                    }
                `}</style>
            </Modal>
        </>
    );
}