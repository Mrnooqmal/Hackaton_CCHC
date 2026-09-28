import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PinInput from '../components/PinInput';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import {
    FiCheck,
    FiClock,
    FiFileText,
    FiCalendar,
    FiUser,
    FiAlertCircle,
    FiAlertTriangle,
    FiX,
    FiDownload,
    FiEdit3,
    FiShield,
    FiRefreshCw,
    FiFilter,
    FiChevronRight,
} from 'react-icons/fi';

import {
    signatureRequestsApi,
    signaturesApi,
    documentsApi,
    uploadsApi,
    type SignatureRequest,
    type NewSignature,
    type DocumentoAdjunto,
    REQUEST_TYPES,
} from '../api/client';

type PendingItem = SignatureRequest & {
    __kind?: 'document';
    __documentId?: string;
    __tipoLabel?: string;
};

const docToPendingItem = (doc: any): PendingItem => {
    const fileKey: string | null = doc.s3Key || doc.archivoUrl || null;
    const nombre: string = doc.archivoNombre || doc.titulo || 'Documento';
    return {
        requestId: `doc:${doc.documentId}`,
        tipo: doc.tipo,
        tipoInfo: undefined as any,
        titulo: doc.titulo || doc.tipoDescripcion || 'Documento de onboarding',
        descripcion: doc.descripcion || '',
        documentos: fileKey ? [{ nombre, url: fileKey, tipo: '', tamaño: 0 }] : [],
        tieneDocumentos: Boolean(fileKey),
        solicitanteId: doc.createdBy || 'system',
        solicitanteNombre: doc.creatorName || 'Sistema DS44',
        solicitanteRut: '',
        trabajadores: [],
        totalRequeridos: 1,
        totalFirmados: 0,
        fechaCreacion: doc.createdAt || new Date().toISOString(),
        fechaLimite: null,
        fechaCompletado: null,
        ubicacion: null,
        obraId: doc.obraId || null,
        empresaId: doc.tenantId || '',
        estado: 'pendiente',
        createdAt: doc.createdAt || '',
        updatedAt: doc.updatedAt || '',
        __kind: 'document',
        __documentId: doc.documentId,
        __tipoLabel: esDelRepresentante(doc)
            ? 'Aprobación como representante legal'
            : doc.articulo ? `Onboarding · ${doc.articulo}` : 'Onboarding',
    };
};

/** La asignación la puso el backend porque la persona es el representante legal. */
const esDelRepresentante = (doc: { tipo?: string; asignaciones?: Array<{ rol?: string }> }) =>
    requiereFirmaRepresentante(doc.tipo)
    && (doc.asignaciones || []).some((a) => a.rol === ROL_REPRESENTANTE);
import { useAuth } from '../context/AuthContext';
import { Modal, PageHeader, SearchInput, Select } from '../components/ui';
import { requiereFirmaRepresentante, ROL_REPRESENTANTE } from '../utils/firmaRepresentante';
import { MsigAvanceSkeleton, MsigCardSkeleton, MsigHistRowSkeleton } from '../components/firmas/FirmasSkeleton';

type TabType = 'pendientes' | 'historial';

const formatLocalDateTime = (timestamp: string) => {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return { date: '—', time: '—' };
    return {
        date: d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }),
        time: d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
    };
};

/** Icono neutro por tipo de solicitud: los emoji de REQUEST_TYPES quedan
 *  reservados para el rótulo de texto, nunca para la caja del ícono. */
const TIPO_ICON: Record<string, React.ReactNode> = {
    ART: <FiAlertTriangle size={17} />,
    INSPECCION: <FiAlertTriangle size={17} />,
    CHARLA_5MIN: <FiClock size={17} />,
    CAPACITACION: <FiClock size={17} />,
    CAPACITACION_SST: <FiClock size={17} />,
    INDUCCION: <FiClock size={17} />,
};
const tipoIcon = (tipo: string) => TIPO_ICON[tipo] || <FiFileText size={17} />;

/** Urgencia real a partir de fechaLimite — nunca inventada: sin fecha límite
 *  (p. ej. documentos de onboarding) no hay pastilla. "Hoy"/"Mañana" usan un
 *  neutro un poco más marcado que el resto, no un color de alerta: es una
 *  fecha próxima, no un problema. */
const urgencia = (fechaLimite: string | null): { label: string; hoy: boolean } | null => {
    if (!fechaLimite) return null;
    const dias = Math.ceil((new Date(fechaLimite).getTime() - Date.now()) / 86400000);
    if (dias <= 0) return { label: 'Hoy', hoy: true };
    if (dias === 1) return { label: 'Mañana', hoy: true };
    return { label: `${dias} días`, hoy: false };
};

const bytesToLabel = (bytes: number) => {
    if (!bytes) return null;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Comprobante generado en el cliente: no existe un endpoint que emita un PDF
 *  de constancia, así que se arma un recibo de texto con los mismos datos que
 *  ya se muestran en el detalle — nada que el backend no haya devuelto ya. */
const descargarComprobante = (firma: NewSignature, solicitud: SignatureRequest | null) => {
    const { date, time } = formatLocalDateTime(firma.timestamp || firma.createdAt);
    const lineas = [
        'Comprobante de firma digital',
        '-----------------------------',
        `Documento: ${firma.requestTitulo || solicitud?.titulo || '—'}`,
        `Firmante: ${firma.workerNombre} (${firma.workerRut})`,
        `Fecha y hora: ${date} a las ${time}`,
        `Solicitado por: ${firma.solicitanteNombre || '—'}`,
        `Estado: ${firma.estado}`,
        `Token de verificación: ${firma.token}`,
    ];
    const blob = new Blob([lineas.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `comprobante-firma-${firma.signatureId}.txt`;
    link.click();
    URL.revokeObjectURL(url);
};

export default function MySignatures() {
    const { user } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<TabType>('pendientes');
    const [pendingRequests, setPendingRequests] = useState<PendingItem[]>([]);
    const [signatureHistory, setSignatureHistory] = useState<{ firma: NewSignature; solicitud: SignatureRequest | null }[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRequest, setSelectedRequest] = useState<PendingItem | null>(null);
    const [showSignModal, setShowSignModal] = useState(false);
    const [signing, setSigning] = useState(false);
    const [pin, setPin] = useState('');
    const [declared, setDeclared] = useState(false);
    const [error, setError] = useState('');

    // Historial: buscador + filtro por tipo + paginación. Crece con el
    // tiempo, así que no todo cabe en pantalla de una vez.
    const [historySearch, setHistorySearch] = useState('');
    const [historyTipo, setHistoryTipo] = useState('');
    const [historyVisible, setHistoryVisible] = useState(8);
    const [selectedHistorial, setSelectedHistorial] = useState<{ firma: NewSignature; solicitud: SignatureRequest | null } | null>(null);

    useEffect(() => {
        if (user?.personaId) {
            loadData();
        } else {
            setLoading(false);
        }
    }, [user?.personaId]);

    useEffect(() => {
        const target = (location.state as { firmarRequestId?: string } | null)?.firmarRequestId;
        if (!target || pendingRequests.length === 0) return;
        const item = pendingRequests.find(r => r.requestId === target);
        if (item) {
            setSelectedRequest(item);
            setPin('');
            setDeclared(false);
            setError('');
            setShowSignModal(true);
            setActiveTab('pendientes');
        }
        navigate(location.pathname, { replace: true, state: null });
    }, [pendingRequests, location.state]);

    const loadData = async () => {
        if (!user?.personaId) return;
        setLoading(true);
        try {
            const [pendingRes, historyRes, onboardingDocsRes] = await Promise.all([
                signatureRequestsApi.getPendingByWorker(user.personaId),
                signatureRequestsApi.getHistoryByWorker(user.personaId),
                // TODO lo que la persona tiene pendiente de firmar, no solo lo
                // 'diario': el Programa de Trabajo Preventivo es de obra, y el
                // representante legal no lo veía en ninguna pantalla aunque se lo
                // asignaran.
                documentsApi.list({ pendienteDe: user.personaId }),
            ]);

            const requests: PendingItem[] = (pendingRes.success && pendingRes.data)
                ? pendingRes.data.pendientes
                : [];
            // Un documento que ya llega por una solicitud de firma (la re-firma de
            // un procedimiento versionado) no se lista dos veces.
            const yaSolicitados = new Set(requests.map((r) => r.referenciaId).filter(Boolean));
            const onboardingDocs: PendingItem[] = (onboardingDocsRes.success && onboardingDocsRes.data?.documents)
                ? onboardingDocsRes.data.documents
                    .filter((d) => !yaSolicitados.has(d.documentId))
                    .map(docToPendingItem)
                : [];
            setPendingRequests([...onboardingDocs, ...requests]);

            if (historyRes.success && historyRes.data) {
                setSignatureHistory(historyRes.data.historial);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSign = async () => {
        if (!selectedRequest || !user?.personaId || pin.length !== 4) return;
        setSigning(true);
        setError('');
        try {
            const response = selectedRequest.__kind === 'document' && selectedRequest.__documentId
                ? await documentsApi.sign(selectedRequest.__documentId, {
                    personaId: user.personaId,
                    tipoFirma: 'documento',
                    pin,
                })
                : await signaturesApi.create({
                    personaId: user.personaId,
                    workerId: user.personaId,
                    pin,
                    requestId: selectedRequest.requestId,
                });

            if (response.success) {
                await loadData();
                setShowSignModal(false);
                setSelectedRequest(null);
                setPin('');
                setDeclared(false);
            } else {
                setError(response.error || 'Error al firmar');
            }
        } catch (error) {
            console.error('Error signing:', error);
            setError('Error al procesar la firma');
        } finally {
            setSigning(false);
        }
    };

    const openSignModal = (request: PendingItem) => {
        setSelectedRequest(request);
        setPin('');
        setDeclared(false);
        setError('');
        setShowSignModal(true);
    };

    const downloadDocument = async (fileKey: string, fileName: string) => {
        try {
            const response = await uploadsApi.getDownloadUrl(fileKey);
            if (response.success && response.data) {
                const link = document.createElement('a');
                link.href = response.data.downloadUrl;
                link.download = fileName;
                link.target = '_blank';
                link.click();
            }
        } catch (error) {
            console.error('Error downloading:', error);
        }
    };

    // ── Avance: misma fórmula que MisFirmasResumen (widget del Dashboard),
    // para que ambos coincidan en el mismo número.
    const firmadas = signatureHistory.length;
    const totalFirmas = firmadas + pendingRequests.length;
    const progreso = totalFirmas > 0 ? Math.round((firmadas / totalFirmas) * 100) : 100;

    const proximosVencimientos = useMemo(() => {
        return pendingRequests
            .filter((r) => r.fechaLimite)
            .sort((a, b) => new Date(a.fechaLimite!).getTime() - new Date(b.fechaLimite!).getTime())
            .slice(0, 2);
    }, [pendingRequests]);

    const tiposEnHistorial = useMemo(() => {
        const vistos = new Set<string>();
        const opciones: { value: string; label: string }[] = [];
        signatureHistory.forEach(({ firma }) => {
            if (vistos.has(firma.requestTipo)) return;
            vistos.add(firma.requestTipo);
            opciones.push({ value: firma.requestTipo, label: REQUEST_TYPES[firma.requestTipo]?.label || firma.requestTipo || 'Otro' });
        });
        return opciones;
    }, [signatureHistory]);

    const historialFiltrado = useMemo(() => {
        const q = historySearch.trim().toLowerCase();
        return signatureHistory.filter(({ firma, solicitud }) => {
            if (historyTipo && firma.requestTipo !== historyTipo) return false;
            if (!q) return true;
            const titulo = (firma.requestTitulo || solicitud?.titulo || '').toLowerCase();
            const solicitante = (firma.solicitanteNombre || '').toLowerCase();
            return titulo.includes(q) || solicitante.includes(q);
        });
    }, [signatureHistory, historySearch, historyTipo]);

    const historialVisible = historialFiltrado.slice(0, historyVisible);

    // ── Ficha reutilizable (documento a firmar / firma ya hecha) ──
    const Ficha = ({ items }: { items: { label: string; valor: React.ReactNode; full?: boolean }[] }) => (
        <dl className="msig-ficha">
            {items.map((it) => (
                <div key={it.label} className={it.full ? 'msig-ficha-item msig-ficha-item--full' : 'msig-ficha-item'}>
                    <dt>{it.label}</dt>
                    <dd>{it.valor}</dd>
                </div>
            ))}
        </dl>
    );

    const DocChips = ({ documentos }: { documentos: DocumentoAdjunto[] }) => (
        documentos.length === 0 ? null : (
            <div className="msig-docs">
                {documentos.map((doc, idx) => (
                    <button key={idx} className="msig-doc-chip" onClick={() => downloadDocument(doc.url, doc.nombre)}>
                        <FiDownload size={12} />
                        {doc.nombre}
                        {bytesToLabel(doc.tamaño) && <span className="msig-doc-chip-size">· {bytesToLabel(doc.tamaño)}</span>}
                    </button>
                ))}
            </div>
        )
    );

    // ── Vista previa real del documento (no una silueta decorativa): abre
    // el mismo DocumentPreviewModal que ya usa el Repositorio, apilado sobre
    // este modal (Modal.tsx ya soporta esa pila).
    const [previewDoc, setPreviewDoc] = useState<{ nombre: string; fileKey: string; url: string | null } | null>(null);

    const abrirVistaPrevia = async (doc: DocumentoAdjunto) => {
        setPreviewDoc({ nombre: doc.nombre, fileKey: doc.url, url: null });
        try {
            const response = await uploadsApi.getDownloadUrl(doc.url);
            if (response.success && response.data) {
                setPreviewDoc({ nombre: doc.nombre, fileKey: doc.url, url: response.data.downloadUrl });
            }
        } catch (err) {
            console.error('Error obteniendo la vista previa:', err);
        }
    };

    const DocPreviewCards = ({ documentos }: { documentos: DocumentoAdjunto[] }) => (
        documentos.length === 0 ? null : (
            <div className="msig-doc-cards">
                {documentos.map((doc, idx) => (
                    <div key={idx} className="msig-doc-card">
                        <span className="msig-doc-card-icon"><FiFileText size={15} /></span>
                        <div className="msig-doc-card-body">
                            <span className="msig-doc-card-name">{doc.nombre}</span>
                            {bytesToLabel(doc.tamaño) && <span className="msig-doc-card-size">{bytesToLabel(doc.tamaño)}</span>}
                        </div>
                        <button type="button" className="msig-doc-card-action" onClick={() => abrirVistaPrevia(doc)}>
                            Ver documento <FiChevronRight size={13} />
                        </button>
                    </div>
                ))}
            </div>
        )
    );

    if (!loading && !user?.personaId) {
        return (
            <div className="main-content">
                <div className="empty-state">
                    <div className="empty-state-icon"><FiAlertCircle size={48} style={{ color: 'var(--warning-500)' }} /></div>
                    <h3 className="empty-state-title">No tienes acceso</h3>
                    <p className="empty-state-description">Tu cuenta no está asociada a un perfil de trabajador.</p>
                </div>
            </div>
        );
    }

    return (
        <>
            {/* El encabezado no depende de los datos (título y descripción son
                fijos, y los contadores de las pestañas quedan sin badge
                mientras `pendingRequests`/`signatureHistory` están vacíos), así
                que se dibuja real desde el primer render — igual que
                Actividades y Encuestas. Solo el panel de avance y las
                tarjetas/filas de abajo, que sí dependen de la respuesta,
                se reemplazan por su esqueleto mientras `loading` es true. */}
            <div className="page-content" aria-busy={loading}>
                {/* Pendientes / Historial son dos vistas de lo mismo, no un
                    filtro: van en el encabezado, como en Actividades, el
                    repositorio de documentos y las encuestas. */}
                <PageHeader
                    banner
                    title="Mis Firmas"
                    description="Documentos pendientes de firma y registro de tu historial."
                    tabs={[
                        {
                            id: 'pendientes', label: 'Pendientes', icon: <FiClock size={15} />,
                            badge: pendingRequests.length > 0 ? pendingRequests.length : undefined,
                        },
                        {
                            id: 'historial', label: 'Historial', icon: <FiCheck size={15} />,
                            badge: signatureHistory.length > 0 ? signatureHistory.length : undefined,
                        },
                    ]}
                    activeTab={activeTab}
                    onTabChange={(id) => setActiveTab(id as TabType)}
                    tabsLabel="Vista de firmas"
                    actions={
                        <button className="btn btn-secondary" onClick={loadData} disabled={loading}>
                            <FiRefreshCw className={loading ? 'spin' : ''} /> Actualizar
                        </button>
                    }
                />

                {/* Pendientes: lista a la izquierda, panel de avance a la
                    derecha (en el mismo lugar que "Tu día" en el inicio de
                    obra) — en vez de una sola columna de tarjetas sueltas. */}
                {activeTab === 'pendientes' && (
                    <div className="msig-layout">
                        <div className="msig-list-col">
                            {loading ? (
                                <div className="msig-list">
                                    <MsigCardSkeleton i={0} />
                                    <MsigCardSkeleton i={1} />
                                </div>
                            ) : pendingRequests.length === 0 ? (
                                <div className="empty-state" style={{ padding: 'var(--space-16)' }}>
                                    <div className="empty-state-icon">
                                        <FiCheck size={40} style={{ color: 'var(--success-apagado)' }} />
                                    </div>
                                    <h3 className="empty-state-title">Todo al día</h3>
                                    <p className="empty-state-description">
                                        No tienes solicitudes pendientes de firma. Te notificaremos cuando haya nuevos documentos.
                                    </p>
                                </div>
                            ) : (
                                <div className="msig-list">
                                    {pendingRequests.map((request) => {
                                        const urg = urgencia(request.fechaLimite);
                                        return (
                                            <div key={request.requestId} className="msig-card">
                                                <div className="msig-card-main">
                                                    <div className="msig-card-icon">
                                                        {tipoIcon(request.tipo)}
                                                    </div>
                                                    <div className="msig-card-body">
                                                        <div className="msig-card-type">
                                                            {REQUEST_TYPES[request.tipo]?.label || request.__tipoLabel || 'Documento'}
                                                        </div>
                                                        <h3 className="msig-card-title">{request.titulo}</h3>
                                                        <div className="msig-card-meta">
                                                            <span className="msig-meta-item">
                                                                <FiUser size={12} />
                                                                {request.solicitanteNombre}
                                                            </span>
                                                            <span className="msig-meta-sep">·</span>
                                                            <span className="msig-meta-item">
                                                                <FiCalendar size={12} />
                                                                {new Date(request.fechaCreacion).toLocaleDateString('es-CL', {
                                                                    day: 'numeric',
                                                                    month: 'short',
                                                                    year: 'numeric',
                                                                })}
                                                            </span>
                                                        </div>
                                                        {request.descripcion && (
                                                            <p className="msig-card-desc">{request.descripcion}</p>
                                                        )}
                                                        <DocChips documentos={request.documentos} />
                                                    </div>
                                                    <div className="msig-card-action">
                                                        {urg && (
                                                            <span className={`msig-pill ${urg.hoy ? 'msig-pill--hoy' : ''}`}>{urg.label}</span>
                                                        )}
                                                        <button
                                                            className="btn btn-primary btn-sm"
                                                            onClick={() => openSignModal(request)}
                                                        >
                                                            <FiEdit3 size={14} /> Firmar
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="msig-avance-col">
                            {loading ? <MsigAvanceSkeleton /> : (
                            <section className="msig-avance-card">
                                <div className="msig-avance-head">
                                    <h2>Tu avance</h2>
                                    <span>Este mes</span>
                                </div>
                                <div className="msig-avance-bar-wrap">
                                    <div className="msig-avance-numbers">
                                        <span className="msig-avance-pct">{progreso}%</span>
                                        <span className="msig-avance-count">{firmadas} de {totalFirmas} al día</span>
                                    </div>
                                    <span className="msig-progress-track"><span className="msig-progress-fill" style={{ width: `${progreso}%` }} /></span>
                                </div>

                                <h3 className="msig-avance-sub">Próximos vencimientos</h3>
                                {proximosVencimientos.length === 0 ? (
                                    <p className="msig-avance-empty">No hay vencimientos próximos en tu obra.</p>
                                ) : (
                                    <ul className="msig-timeline">
                                        {proximosVencimientos.map((r, idx) => {
                                            const { date, time } = formatLocalDateTime(r.fechaLimite!);
                                            const esHoy = urgencia(r.fechaLimite)?.hoy;
                                            return (
                                                <li key={r.requestId} className="msig-timeline-item">
                                                    <span className="msig-timeline-rail">
                                                        <span className={`msig-timeline-dot ${esHoy ? 'msig-timeline-dot--next' : ''}`} />
                                                        {idx < proximosVencimientos.length - 1 && <span className="msig-timeline-line" />}
                                                    </span>
                                                    <span className="msig-timeline-body">
                                                        <span className="msig-timeline-title">{r.titulo}</span>
                                                        <span className="msig-timeline-when">{esHoy ? `Vence hoy a las ${time}` : `Vence el ${date}`}</span>
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}

                                <button type="button" className="msig-avance-link" onClick={() => setActiveTab('historial')}>
                                    Ver historial completo <FiChevronRight size={16} />
                                </button>
                            </section>
                            )}
                        </div>
                    </div>
                )}

                {/* Historial: buscador + filtro por tipo, filas de solo
                    lectura que abren el detalle en un modal, y paginación —
                    ya no expande inline, porque con el tiempo esta lista
                    crece bastante. */}
                {activeTab === 'historial' && (
                    <div className="msig-hist-wrap">
                        {signatureHistory.length > 0 && (
                            <div className="msig-hist-toolbar">
                                <SearchInput
                                    value={historySearch}
                                    onChange={(v) => { setHistorySearch(v); setHistoryVisible(8); }}
                                    placeholder="Buscar por nombre de documento o solicitante…"
                                    maxWidth="360px"
                                />
                                {tiposEnHistorial.length > 1 && (
                                    <Select
                                        value={historyTipo}
                                        onChange={(v) => { setHistoryTipo(v); setHistoryVisible(8); }}
                                        options={[{ value: '', label: 'Todos los tipos' }, ...tiposEnHistorial]}
                                        leadingIcon={<FiFilter size={14} />}
                                        ariaLabel="Filtrar por tipo de documento"
                                        className="msig-hist-filter"
                                    />
                                )}
                            </div>
                        )}

                        {loading ? (
                            <div className="msig-history">
                                <MsigHistRowSkeleton i={0} />
                                <MsigHistRowSkeleton i={1} />
                                <MsigHistRowSkeleton i={2} />
                            </div>
                        ) : signatureHistory.length === 0 ? (
                            <div className="empty-state" style={{ padding: 'var(--space-16)' }}>
                                <div className="empty-state-icon">
                                    <FiFileText size={40} style={{ color: 'var(--text-muted)' }} />
                                </div>
                                <h3 className="empty-state-title">Sin historial</h3>
                                <p className="empty-state-description">
                                    Aún no has firmado ningún documento. Aparecerán aquí con su información de validación.
                                </p>
                            </div>
                        ) : historialFiltrado.length === 0 ? (
                            <div className="empty-state" style={{ padding: 'var(--space-10)' }}>
                                <p className="empty-state-description">Ninguna firma coincide con la búsqueda.</p>
                            </div>
                        ) : (
                            <>
                                <div className="msig-history">
                                    {historialVisible.map(({ firma, solicitud }) => {
                                        const { date, time } = formatLocalDateTime(firma.timestamp || firma.createdAt);
                                        const titulo = firma.requestTitulo || solicitud?.titulo || REQUEST_TYPES[firma.requestTipo]?.label || 'Firma';
                                        const esValida = firma.estado === 'valida';
                                        return (
                                            <button
                                                key={firma.signatureId}
                                                type="button"
                                                className="msig-hist-row"
                                                onClick={() => setSelectedHistorial({ firma, solicitud })}
                                            >
                                                <span className="msig-hist-icon">
                                                    {tipoIcon(firma.requestTipo)}
                                                </span>
                                                <span className="msig-hist-body">
                                                    <span className="msig-hist-title">{titulo}</span>
                                                    <span className="msig-hist-meta">
                                                        <span className="msig-meta-item"><FiCalendar size={11} />{date} · {time}</span>
                                                        {firma.solicitanteNombre && (
                                                            <>
                                                                <span className="msig-meta-sep">·</span>
                                                                <span className="msig-meta-item"><FiUser size={11} />{firma.solicitanteNombre}</span>
                                                            </>
                                                        )}
                                                    </span>
                                                </span>
                                                {/* "Válida" es el estado esperado y no lleva color — solo un
                                                    check gris. La excepción real (disputada/revocada) es la
                                                    única que se resalta, para que el color marque lo distinto
                                                    y no se repita fila tras fila. */}
                                                {esValida ? (
                                                    <span className="msig-hist-status">
                                                        <FiCheck size={13} /> Válida
                                                    </span>
                                                ) : (
                                                    <span className="msig-pill msig-pill--atencion">
                                                        {firma.estado === 'disputada' ? 'Disputada' : firma.estado === 'revocada' ? 'Revocada' : firma.estado}
                                                    </span>
                                                )}
                                                <FiChevronRight size={18} className="msig-hist-chevron" />
                                            </button>
                                        );
                                    })}
                                </div>
                                {historyVisible < historialFiltrado.length && (
                                    <div className="msig-hist-pagination">
                                        <span>Mostrando {historialVisible.length} de {historialFiltrado.length} firmas</span>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHistoryVisible((n) => n + 10)}>
                                            Cargar más
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Modal de firma: ya no es solo el PIN — muestra qué se está
                firmando (documento, ficha, otras firmas) para que la
                decisión de firmar no dependa de haber leído algo en otra
                pantalla. */}
            <Modal
                isOpen={showSignModal && !!selectedRequest}
                onClose={() => setShowSignModal(false)}
                title="Firmar documento"
                subtitle={selectedRequest?.titulo}
                icon={<FiEdit3 size={22} />}
                size="lg"
                preventClose={signing}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setShowSignModal(false)} disabled={signing}>
                            <FiX size={16} /> Cancelar
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={handleSign}
                            disabled={signing || pin.length !== 4 || !declared}
                        >
                            {signing
                                ? <><div className="spinner" style={{ width: '16px', height: '16px' }} /> Firmando...</>
                                : <><FiCheck size={18} /> Confirmar firma</>
                            }
                        </button>
                    </>
                }
            >
                {selectedRequest && (
                    <div className="msig-modal-grid">
                        <div className="msig-modal-col">
                            <Ficha items={[
                                { label: 'Tipo', valor: REQUEST_TYPES[selectedRequest.tipo]?.label || selectedRequest.__tipoLabel || 'Documento' },
                                { label: 'Solicitado por', valor: selectedRequest.solicitanteNombre },
                                { label: 'Fecha límite', valor: selectedRequest.fechaLimite ? formatLocalDateTime(selectedRequest.fechaLimite).date : 'Sin fecha límite' },
                                ...(selectedRequest.ubicacion ? [{ label: 'Ubicación', valor: selectedRequest.ubicacion }] : []),
                                ...(selectedRequest.documentos.length > 0 ? [{ label: 'Documentos', valor: <DocPreviewCards documentos={selectedRequest.documentos} />, full: true }] : []),
                            ]} />
                            {selectedRequest.trabajadores.length > 1 && (() => {
                                const firmantes = selectedRequest.trabajadores.filter((t) => t.firmado);
                                return (
                                    <div className="msig-otras-firmas">
                                        <span>Otras firmas de este documento</span>
                                        <span>{firmantes.length} de {selectedRequest.trabajadores.length} completadas</span>
                                    </div>
                                );
                            })()}
                        </div>

                        <div className="msig-modal-col">
                            <div className="msig-notice">
                                <FiAlertCircle size={16} />
                                <span>Tu firma queda registrada con fecha, hora e identidad verificada. Esta acción <strong>no se puede deshacer</strong>.</span>
                            </div>

                            <PinInput
                                onComplete={(completedPin) => setPin(completedPin)}
                                disabled={signing}
                                mode="verify"
                                title="Ingresa tu PIN de firma"
                                subtitle=" "
                                error={error}
                            />
                            <label className="msig-declare-check">
                                <input
                                    type="checkbox"
                                    checked={declared}
                                    onChange={e => setDeclared(e.target.checked)}
                                    disabled={signing}
                                />
                                <span>Declaro haber leído conscientemente la solicitud de firma</span>
                            </label>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Detalle en el historial: misma estructura de modal que el de
                firmar, para que revisar una firma ya hecha se sienta la
                misma familia de pantalla. */}
            <Modal
                isOpen={!!selectedHistorial}
                onClose={() => setSelectedHistorial(null)}
                title={selectedHistorial ? (selectedHistorial.firma.requestTitulo || selectedHistorial.solicitud?.titulo || 'Firma') : ''}
                subtitle={selectedHistorial ? `Firmada el ${formatLocalDateTime(selectedHistorial.firma.timestamp || selectedHistorial.firma.createdAt).date} a las ${formatLocalDateTime(selectedHistorial.firma.timestamp || selectedHistorial.firma.createdAt).time}` : undefined}
                icon={<FiFileText size={22} />}
                size="lg"
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setSelectedHistorial(null)}>Cerrar</button>
                        <button
                            className="btn btn-primary"
                            onClick={() => selectedHistorial && descargarComprobante(selectedHistorial.firma, selectedHistorial.solicitud)}
                        >
                            <FiDownload size={16} /> Descargar comprobante
                        </button>
                    </>
                }
            >
                {selectedHistorial && (() => {
                    const { firma, solicitud } = selectedHistorial;
                    const documentos = solicitud?.documentos?.length ? solicitud.documentos : firma.documentosFirmados;
                    const esValida = firma.estado === 'valida';
                    return (
                        <div className="msig-modal-grid">
                            <div className="msig-modal-col">
                                <Ficha items={[
                                    { label: 'Tipo', valor: REQUEST_TYPES[firma.requestTipo]?.label || firma.requestTipo || 'Documento' },
                                    { label: 'Solicitado por', valor: firma.solicitanteNombre || '—' },
                                    ...(documentos?.length ? [{ label: 'Documentos', valor: <DocPreviewCards documentos={documentos} />, full: true }] : []),
                                ]} />
                                {solicitud && solicitud.trabajadores.length > 1 && (() => {
                                    const firmantes = solicitud.trabajadores.filter((t) => t.firmado);
                                    return (
                                        <div className="msig-otras-firmas">
                                            <span>Otras firmas de este documento</span>
                                            <span>{firmantes.length} de {solicitud.trabajadores.length} completadas</span>
                                        </div>
                                    );
                                })()}
                            </div>

                            <div className="msig-modal-col">
                                <div className="msig-hist-detail-status">
                                    {esValida ? <FiCheck size={15} /> : <FiAlertCircle size={15} />}
                                    {esValida ? 'Firma válida' : firma.estado === 'disputada' ? 'Firma disputada' : firma.estado}
                                </div>
                                <div className="msig-verif">
                                    <span className="msig-verif-label"><FiShield size={13} /> Token de verificación</span>
                                    <span className="msig-token">{firma.token}</span>
                                    <span className="msig-verif-sub">Validado con {firma.metodoValidacion || 'PIN'} · IP {firma.ipAddress || '—'}</span>
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </Modal>

            <DocumentPreviewModal
                isOpen={!!previewDoc}
                onClose={() => setPreviewDoc(null)}
                url={previewDoc?.url ?? null}
                fileName={previewDoc?.nombre}
                onDownload={() => previewDoc && downloadDocument(previewDoc.fileKey, previewDoc.nombre)}
            />

            <style>{`
                /* ── Layout de pendientes: lista + panel de avance ── */
                .msig-layout {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-5);
                }
                .msig-list-col { flex: 1 1 0; min-width: 0; order: 1; }
                .msig-avance-col { flex: 0 0 340px; order: 2; }
                @media (max-width: 900px) {
                    .msig-layout { flex-direction: column; }
                    .msig-avance-col { order: -1; flex-basis: auto; width: 100%; }
                }

                /* ── Lista de pendientes ── */
                .msig-list {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-3);
                }
                .msig-card {
                    background: var(--surface-card);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-xl);
                    padding: var(--space-4) var(--space-5);
                    transition: border-color 0.15s, box-shadow 0.15s;
                }
                .msig-card:hover {
                    border-color: var(--primary-300);
                    box-shadow: var(--shadow-md);
                }
                .msig-card-main {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-4);
                }
                .msig-card-icon {
                    flex-shrink: 0;
                    width: 40px;
                    height: 40px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                    color: var(--text-secondary);
                    font-size: 18px;
                }
                .msig-card-body { flex: 1; min-width: 0; }
                .msig-card-type {
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.04em;
                    text-transform: uppercase;
                    color: var(--text-muted);
                    margin-bottom: var(--space-1);
                }
                .msig-card-title {
                    font-size: var(--text-base);
                    font-weight: 600;
                    color: var(--text-primary);
                    margin: 0 0 var(--space-2);
                    line-height: 1.3;
                }
                .msig-card-meta {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: var(--space-1);
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                }
                .msig-meta-item {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                }
                .msig-meta-sep { color: var(--surface-border); }
                .msig-card-desc {
                    font-size: var(--text-sm);
                    color: var(--text-secondary);
                    margin: var(--space-2) 0 0;
                    line-height: 1.5;
                    padding: var(--space-2) var(--space-3);
                    background: var(--surface-elevated);
                    border-left: 3px solid var(--surface-border);
                    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
                }
                .msig-docs {
                    display: flex;
                    flex-wrap: wrap;
                    gap: var(--space-2);
                    margin-top: var(--space-3);
                    padding-top: var(--space-3);
                    border-top: 1px solid var(--surface-border);
                }
                .msig-ficha .msig-docs { margin-top: var(--space-1); padding-top: 0; border-top: none; }
                .msig-doc-chip {
                    display: inline-flex;
                    align-items: center;
                    gap: var(--space-1);
                    padding: 4px 10px;
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    font-size: var(--text-xs);
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: background 0.15s, color 0.15s;
                }
                .msig-doc-chip:hover {
                    background: var(--surface-hover);
                    color: var(--text-primary);
                }
                .msig-doc-chip-size { color: var(--text-muted); }

                /* Tarjeta de documento en los modales de detalle: más peso que
                   el chip de descarga de la lista, con acción explícita para
                   abrir la vista previa real (DocumentPreviewModal), no una
                   silueta decorativa. */
                .msig-doc-cards { display: flex; flex-direction: column; gap: var(--space-2); }
                .msig-doc-card {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    padding: var(--space-3);
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                }
                .msig-doc-card-icon {
                    flex-shrink: 0;
                    width: 30px;
                    height: 30px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface-hover);
                    border-radius: var(--radius-sm);
                    color: var(--text-secondary);
                }
                .msig-doc-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
                .msig-doc-card-name {
                    font-size: var(--text-sm);
                    font-weight: 600;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .msig-doc-card-size { font-size: 11px; color: var(--text-muted); }
                .msig-doc-card-action {
                    flex-shrink: 0;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 0;
                    background: none;
                    border: none;
                    font-size: 12.5px;
                    font-weight: 600;
                    color: var(--accent-text);
                    cursor: pointer;
                    font-family: inherit;
                }
                .msig-card-action {
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    gap: var(--space-2);
                }

                /* Pastilla neutra reutilizable: "Hoy"/"Mañana" usan un tono un
                   poco más marcado que el resto (nunca color de alerta); la
                   excepción real (disputada/revocada) usa ámbar, la única
                   vez que este flujo usa un color con significado. */
                .msig-pill {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 3px 9px;
                    border-radius: var(--radius-full);
                    font-size: 11px;
                    font-weight: 600;
                    background: var(--surface-hover);
                    color: var(--text-secondary);
                }
                .msig-pill--hoy { background: var(--surface-active, var(--surface-hover)); color: var(--text-primary); }
                .msig-pill--atencion { background: rgba(234, 179, 8, 0.16); color: var(--warning-500); }

                /* ── Panel "Tu avance" ── */
                .msig-avance-card {
                    display: flex;
                    flex-direction: column;
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-xl);
                    overflow: hidden;
                }
                .msig-avance-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: var(--space-4) var(--space-5);
                    border-bottom: 1px solid var(--surface-border);
                }
                .msig-avance-head h2 { margin: 0; font-size: var(--text-base); font-weight: 700; }
                .msig-avance-head span { font-size: var(--text-xs); color: var(--text-secondary); }
                .msig-avance-bar-wrap { padding: var(--space-5) var(--space-5) 0; display: flex; flex-direction: column; gap: var(--space-2); }
                .msig-avance-numbers { display: flex; align-items: baseline; justify-content: space-between; }
                .msig-avance-pct { font-size: 1.75rem; font-weight: 700; color: var(--text-primary); }
                .msig-avance-count { font-size: var(--text-xs); color: var(--text-secondary); }
                .msig-progress-track { display: block; width: 100%; height: 6px; border-radius: 999px; background: var(--surface-hover); }
                .msig-progress-fill { display: block; height: 6px; border-radius: 999px; background: var(--accent); transition: width 0.3s ease; }
                .msig-avance-sub {
                    margin: var(--space-5) var(--space-5) 0;
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--text-muted);
                }
                .msig-avance-empty { margin: var(--space-2) var(--space-5) var(--space-5); font-size: var(--text-sm); color: var(--text-secondary); }
                .msig-timeline { margin: 0; padding: var(--space-3) var(--space-5) var(--space-2); list-style: none; display: flex; flex-direction: column; }
                .msig-timeline-item { display: flex; gap: var(--space-3); }
                .msig-timeline-rail { display: flex; flex-direction: column; align-items: center; width: 10px; flex-shrink: 0; padding-top: 5px; }
                .msig-timeline-dot { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--text-muted); box-sizing: border-box; }
                .msig-timeline-dot--next { border: none; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-tint); }
                .msig-timeline-line { flex-grow: 1; width: 1px; margin-top: 5px; background: var(--surface-border); }
                .msig-timeline-body { display: flex; flex-direction: column; gap: 3px; padding-bottom: var(--space-4); min-width: 0; }
                .msig-timeline-title { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
                .msig-timeline-when { font-size: var(--text-xs); color: var(--text-secondary); }
                .msig-avance-link {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: var(--space-2);
                    padding: var(--space-4) var(--space-5);
                    border-top: 1px solid var(--surface-border);
                    background: none;
                    border-left: none;
                    border-right: none;
                    border-bottom: none;
                    font-size: var(--text-sm);
                    font-weight: 500;
                    color: var(--accent-text);
                    cursor: pointer;
                    font-family: inherit;
                }

                /* ── Historial ── */
                .msig-hist-wrap { display: flex; flex-direction: column; gap: var(--space-4); }
                .msig-hist-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
                .msig-hist-filter { min-width: 180px; }
                .msig-history {
                    display: flex;
                    flex-direction: column;
                    gap: 0;
                    background: var(--surface-card);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-xl);
                    overflow: hidden;
                }
                .msig-hist-row {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    width: 100%;
                    padding: var(--space-3) var(--space-4);
                    background: none;
                    border: none;
                    border-bottom: 1px solid var(--surface-border);
                    text-align: left;
                    cursor: pointer;
                    font-family: inherit;
                    transition: background 0.12s;
                }
                .msig-hist-row:last-child { border-bottom: none; }
                .msig-hist-row:hover { background: var(--surface-hover); }
                .msig-hist-icon {
                    flex-shrink: 0;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    color: var(--text-secondary);
                    font-size: 15px;
                }
                .msig-hist-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
                .msig-hist-title {
                    font-size: var(--text-sm);
                    font-weight: 500;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .msig-hist-meta {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: var(--space-1);
                    font-size: 11px;
                    color: var(--text-muted);
                }
                .msig-hist-status {
                    flex-shrink: 0;
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    font-size: var(--text-xs);
                    color: var(--text-secondary);
                }
                .msig-hist-chevron { flex-shrink: 0; color: var(--text-muted); }
                .msig-hist-pagination {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: var(--space-3);
                    padding: var(--space-2) var(--space-1);
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                }

                /* ── Modales de detalle (firmar / historial) ── */
                .msig-modal-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: var(--space-6);
                }
                @media (max-width: 640px) {
                    .msig-modal-grid { grid-template-columns: 1fr; }
                }
                .msig-modal-col { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
                .msig-ficha {
                    margin: 0;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: var(--space-3) var(--space-4);
                    padding: var(--space-4);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                }
                .msig-ficha-item { min-width: 0; }
                .msig-ficha-item--full { grid-column: 1 / -1; }
                .msig-ficha-item dt {
                    font-size: 10.5px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    color: var(--text-muted);
                    margin-bottom: 3px;
                }
                .msig-ficha-item dd { margin: 0; font-size: var(--text-sm); color: var(--text-primary); word-break: break-word; }
                .msig-otras-firmas {
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                }
                .msig-otras-firmas span:last-child { color: var(--text-secondary); }
                .msig-notice {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-2);
                    padding: var(--space-3);
                    border-radius: var(--radius-md);
                    font-size: var(--text-xs);
                    line-height: 1.5;
                    background: rgba(234, 179, 8, 0.1);
                    border: 1px solid rgba(234, 179, 8, 0.3);
                    color: var(--warning-500);
                }
                .msig-notice svg { flex-shrink: 0; margin-top: 1px; }
                .msig-hist-detail-status {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    align-self: flex-start;
                    font-size: var(--text-sm);
                    font-weight: 600;
                    color: var(--text-primary);
                }
                .msig-verif {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-2);
                    padding: var(--space-3) var(--space-4);
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                }
                .msig-verif-label {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 10.5px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    color: var(--text-muted);
                }
                .msig-token { font-family: var(--font-mono); font-size: var(--text-sm); letter-spacing: 0.02em; color: var(--text-secondary); word-break: break-all; }
                .msig-verif-sub { font-size: 10.5px; color: var(--text-muted); }

                .msig-declare-check {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-3);
                    padding: var(--space-3) var(--space-4);
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                    cursor: pointer;
                    transition: border-color 0.15s;
                    font-size: var(--text-sm);
                    color: var(--text-secondary);
                    line-height: 1.4;
                    user-select: none;
                }
                .msig-declare-check:has(input:checked) {
                    border-color: var(--primary-400);
                    background: var(--accent-tint);
                    color: var(--text-primary);
                }
                .msig-declare-check input[type="checkbox"] {
                    flex-shrink: 0;
                    width: 16px;
                    height: 16px;
                    margin-top: 1px;
                    accent-color: var(--primary-500);
                    cursor: pointer;
                }

                /* ── Mobile ── */
                @media (max-width: 640px) {
                    .msig-card-main { flex-wrap: wrap; }
                    .msig-card-action { flex-direction: column; align-items: stretch; width: 100%; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--surface-border); }
                    .msig-card-action .msig-pill { align-self: flex-start; }
                    .msig-card-action .btn { width: 100%; justify-content: center; }
                    .msig-hist-toolbar { flex-direction: column; align-items: stretch; }
                    .msig-hist-toolbar .ui-search-input { max-width: none !important; }
                }
            `}</style>
        </>
    );
}
