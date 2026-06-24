import { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui';
import { documentsApi, uploadsApi } from '../api/client';
import PinInput from './PinInput';
import { FiArrowLeft, FiCheck, FiFileText, FiArrowRight, FiExternalLink } from 'react-icons/fi';

interface FirmaAsistidaModalProps {
    isOpen: boolean;
    onClose: () => void;
    obraId: string;
    workers: any[];
    asistidoPor: string;
    initialWorkerId?: string;
    initialTipo?: string;
    onSigned?: () => void;
}

type Step = 'document' | 'signing';

const workerInitials = (w: any) =>
    `${(w.nombre || '')[0] ?? ''}${(w.apellido || '')[0] ?? (w.nombre || '')[1] ?? ''}`.toUpperCase();

export default function FirmaAsistidaModal({
    isOpen, onClose, obraId, workers, asistidoPor, initialWorkerId, initialTipo, onSigned,
}: FirmaAsistidaModalProps) {
    const [step, setStep] = useState<Step>('document');
    const [selectedWorker, setSelectedWorker] = useState<any | null>(null);
    const [docs, setDocs] = useState<any[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(false);
    const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
    const [pin, setPin] = useState('');
    const [declared, setDeclared] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [okMsg, setOkMsg] = useState<string | null>(null);
    const [viewing, setViewing] = useState(false);
    const [pinKey, setPinKey] = useState(0);

    const selectedDoc = docs.find((d) => d.documentId === selectedDocId);
    const dedupedDocs = useMemo(
        () => Array.from(new Map(docs.map((d) => [d.tipo, d])).values()),
        [docs]
    );

    const reset = () => {
        setStep('document');
        setSelectedWorker(null);
        setDocs([]);
        setSelectedDocId(null);
        setPin('');
        setDeclared(false);
        setError(null);
        setOkMsg(null);
        setPinKey((k) => k + 1);
    };

    useEffect(() => {
        if (!isOpen) reset();
    }, [isOpen]);

    const loadDocs = async (w: any, preferTipo?: string) => {
        setSelectedWorker(w);
        setError(null);
        setOkMsg(null);
        setLoadingDocs(true);
        try {
            const res = await documentsApi.list({ obraId } as any);
            const all = res.success && res.data ? res.data.documents || [] : [];
            const pendientes = all.filter((d: any) =>
                (d.asignaciones || []).some((a: any) => a.personaId === w.personaId && a.estado === 'pendiente')
            );
            setDocs(pendientes);
            if (preferTipo) {
                const match = pendientes.find((d: any) => d.tipo === preferTipo);
                if (match) {
                    setSelectedDocId(match.documentId);
                    setStep('signing');
                }
            }
        } catch {
            setError('No se pudieron cargar los documentos.');
        } finally {
            setLoadingDocs(false);
        }
    };

    useEffect(() => {
        if (isOpen && initialWorkerId && !selectedWorker) {
            const w = (workers || []).find((x) => x.personaId === initialWorkerId);
            if (w) loadDocs(w, initialTipo);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialWorkerId, initialTipo]);

    const handleSelectDoc = (docId: string) => {
        setSelectedDocId(docId);
        setStep('signing');
        setError(null);
        setPin('');
        setDeclared(false);
        setPinKey((k) => k + 1);
    };

    const handleBack = () => {
        setStep('document');
        setSelectedDocId(null);
        setError(null);
        setPin('');
        setDeclared(false);
        setPinKey((k) => k + 1);
    };

    const handleSign = async () => {
        if (!selectedWorker || !selectedDocId) return;
        if (!pin || pin.length < 4) {
            setError('El trabajador debe ingresar su PIN de 4 dígitos.');
            return;
        }
        if (!declared) {
            setError('El trabajador debe confirmar que leyó el documento.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const res = await documentsApi.signAssisted(selectedDocId, {
                firmanteId: selectedWorker.personaId,
                asistidoPor,
                metodo: 'PIN',
                pin,
            });
            if (!res.success || !res.data) {
                setError(res.error || 'PIN incorrecto o no se pudo firmar.');
                return;
            }
            setOkMsg('Documento firmado correctamente.');
            onSigned?.();
            // Reload and return to document list
            await loadDocs(selectedWorker);
            setStep('document');
        } catch {
            setError('Error de conexión al firmar. Inténtalo de nuevo.');
        } finally {
            setSubmitting(false);
        }
    };

    const verDocumento = async () => {
        const fileKey = selectedDoc?.s3Key || selectedDoc?.archivoUrl;
        if (!fileKey) { setError('Este documento no tiene archivo adjunto.'); return; }
        setViewing(true);
        setError(null);
        try {
            const res = await uploadsApi.getDownloadUrl(fileKey);
            if (res.success && res.data?.downloadUrl) window.open(res.data.downloadUrl, '_blank');
            else setError('No se pudo abrir el documento.');
        } catch {
            setError('No se pudo abrir el documento.');
        } finally {
            setViewing(false);
        }
    };

    const workerFullName = selectedWorker
        ? `${selectedWorker.nombre} ${selectedWorker.apellido || ''}`.trim()
        : '';

    const modalTitle = step === 'signing' ? 'Confirmar firma' : 'Documentos pendientes';
    const modalSubtitle = step === 'signing'
        ? selectedDoc?.titulo || 'Documento seleccionado'
        : selectedWorker
            ? `${workerFullName} · ${workerInitials(selectedWorker)}`
            : 'Cargando…';

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={modalTitle}
            subtitle={modalSubtitle}
            size="sm"
            preventClose={submitting}
            footer={
                <div style={{ display: 'flex', gap: 'var(--space-2)', width: '100%' }}>
                    {step === 'signing' ? (
                        <>
                            <button
                                className="btn btn-secondary"
                                style={{ flex: 1 }}
                                onClick={handleBack}
                                disabled={submitting}
                            >
                                <FiArrowLeft size={14} /> Volver
                            </button>
                            <button
                                className="btn btn-primary"
                                style={{ flex: 2 }}
                                onClick={handleSign}
                                disabled={submitting || pin.length < 4 || !declared}
                            >
                                {submitting
                                    ? <><div className="fa-spinner" /> Firmando…</>
                                    : <><FiCheck size={15} /> Confirmar firma</>
                                }
                            </button>
                        </>
                    ) : (
                        <button className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={onClose}>
                            Cerrar
                        </button>
                    )}
                </div>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                {/* ── Error banner ── */}
                {error && (
                    <div className="fa-banner fa-banner--error">{error}</div>
                )}

                {/* ── Success banner ── */}
                {okMsg && step === 'document' && (
                    <div className="fa-banner fa-banner--ok">{okMsg}</div>
                )}

                {/* ══ STEP: document list ══════════════════════════════════ */}
                {step === 'document' && selectedWorker && (
                    <>
                        {/* Worker identity strip */}
                        <div className="fa-worker">
                            <div className="fa-worker-avatar">{workerInitials(selectedWorker)}</div>
                            <div className="fa-worker-info">
                                <span className="fa-worker-name">{workerFullName}</span>
                                <span className="fa-worker-meta">
                                    {selectedWorker.rut}
                                    {!loadingDocs && ` · ${dedupedDocs.length} pendiente${dedupedDocs.length !== 1 ? 's' : ''}`}
                                </span>
                            </div>
                        </div>

                        {loadingDocs ? (
                            <div className="fa-loading">
                                <div className="fa-spinner" />
                                <span>Cargando documentos…</span>
                            </div>
                        ) : dedupedDocs.length === 0 ? (
                            <div className="fa-empty">
                                <FiCheck size={22} className="fa-empty-icon" />
                                <span>Sin documentos pendientes de firma.</span>
                            </div>
                        ) : (
                            <div className="fa-doc-list">
                                {dedupedDocs.map((d) => (
                                    <button
                                        key={d.documentId}
                                        type="button"
                                        className="fa-doc-row"
                                        onClick={() => handleSelectDoc(d.documentId)}
                                    >
                                        <span className="fa-doc-icon">
                                            <FiFileText size={15} />
                                        </span>
                                        <span className="fa-doc-body">
                                            <span className="fa-doc-title">{d.titulo}</span>
                                            <span className="fa-doc-type">{d.tipoDescripcion || d.tipo}</span>
                                        </span>
                                        <span className="fa-doc-cta">
                                            Firmar <FiArrowRight size={12} />
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* ══ STEP: signing ════════════════════════════════════════ */}
                {step === 'signing' && selectedWorker && (
                    <>
                        {/* Document context */}
                        {selectedDoc && (
                            <div className="fa-doc-context">
                                <FiFileText size={14} className="fa-doc-context-icon" />
                                <div className="fa-doc-context-body">
                                    <span className="fa-doc-context-title">{selectedDoc.titulo}</span>
                                    <span className="fa-doc-context-type">{selectedDoc.tipoDescripcion || selectedDoc.tipo}</span>
                                </div>
                                <button
                                    type="button"
                                    className="fa-doc-context-link"
                                    onClick={verDocumento}
                                    disabled={viewing}
                                    title="Abrir documento"
                                >
                                    <FiExternalLink size={13} />
                                    {viewing ? 'Abriendo…' : 'Ver'}
                                </button>
                            </div>
                        )}

                        {/* PIN input — same component as MySignatures */}
                        <PinInput
                            key={pinKey}
                            onComplete={(completedPin) => { setPin(completedPin); setError(null); }}
                            mode="verify"
                            title={`${selectedWorker.nombre} ingresa su PIN`}
                            subtitle="El trabajador introduce su clave personal de firma"
                            error={error ?? undefined}
                            disabled={submitting}
                        />

                        {/* Declare checkbox — same pattern as msig-declare-check */}
                        <label className="fa-declare-check">
                            <input
                                type="checkbox"
                                checked={declared}
                                onChange={(e) => setDeclared(e.target.checked)}
                                disabled={submitting}
                            />
                            <span>El trabajador declara haber leído conscientemente este documento antes de firmarlo</span>
                        </label>
                    </>
                )}
            </div>

            <style>{`
                /* ── Banners ─────────────────────────────────────────────── */
                .fa-banner {
                    padding: 8px 12px; border-radius: var(--radius-md);
                    font-size: var(--text-sm); font-weight: 500; line-height: 1.5;
                }
                .fa-banner--error {
                    background: color-mix(in srgb, var(--danger-500) 10%, transparent);
                    border: 1px solid color-mix(in srgb, var(--danger-500) 30%, transparent);
                    color: var(--danger-500);
                }
                .fa-banner--ok {
                    background: color-mix(in srgb, var(--success-500, #10b981) 10%, transparent);
                    border: 1px solid color-mix(in srgb, var(--success-500, #10b981) 30%, transparent);
                    color: var(--success-600, #059669);
                }
                [data-theme="dark"] .fa-banner--ok { color: var(--success-400, #34d399); }
                @media (prefers-color-scheme: dark) { .fa-banner--ok { color: var(--success-400, #34d399); } }

                /* ── Worker strip ────────────────────────────────────────── */
                .fa-worker {
                    display: flex; align-items: center; gap: var(--space-3);
                    padding: var(--space-3) var(--space-4);
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                }
                .fa-worker-avatar {
                    width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 700; font-size: var(--text-sm); text-transform: uppercase;
                    background: rgba(0,110,220,0.12); color: var(--accent-text, #4d9fff);
                    border: 1.5px solid rgba(0,110,220,0.2);
                }
                .fa-worker-info { display: flex; flex-direction: column; min-width: 0; }
                .fa-worker-name {
                    font-weight: 600; font-size: var(--text-sm);
                    color: var(--text-primary); white-space: nowrap;
                    overflow: hidden; text-overflow: ellipsis;
                }
                .fa-worker-meta { font-size: var(--text-xs); color: var(--text-muted); margin-top: 1px; }

                /* ── Loading / empty ─────────────────────────────────────── */
                .fa-loading {
                    display: flex; align-items: center; justify-content: center;
                    gap: var(--space-2); padding: var(--space-5);
                    font-size: var(--text-sm); color: var(--text-muted);
                }
                .fa-empty {
                    display: flex; flex-direction: column; align-items: center;
                    gap: var(--space-2); padding: var(--space-6);
                    font-size: var(--text-sm); color: var(--text-muted); text-align: center;
                }
                .fa-empty-icon { color: var(--success-500, #10b981); opacity: 0.7; }

                /* ── Document list ───────────────────────────────────────── */
                .fa-doc-list { display: flex; flex-direction: column; gap: var(--space-2); }

                .fa-doc-row {
                    display: flex; align-items: center; gap: var(--space-3);
                    width: 100%; text-align: left;
                    padding: var(--space-3) var(--space-4);
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-left: 3px solid var(--warning-400, #fbbf24);
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    transition: background 0.13s, transform 0.13s, box-shadow 0.13s;
                }
                .fa-doc-row:hover {
                    background: var(--surface-hover);
                    transform: translateY(-1px);
                    box-shadow: 0 3px 10px -2px rgba(0,0,0,0.12);
                }
                .fa-doc-row:focus-visible {
                    outline: 2px solid var(--accent); outline-offset: 2px;
                }

                .fa-doc-icon {
                    display: flex; align-items: center; justify-content: center;
                    width: 32px; height: 32px; flex-shrink: 0;
                    border-radius: var(--radius-md);
                    background: var(--surface-card);
                    border: 1px solid var(--surface-border);
                    color: var(--warning-500, #f59e0b);
                }

                .fa-doc-body {
                    display: flex; flex-direction: column; flex: 1; min-width: 0;
                }
                .fa-doc-title {
                    font-size: var(--text-sm); font-weight: 600;
                    color: var(--text-primary);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .fa-doc-type {
                    font-size: var(--text-xs); color: var(--text-secondary); margin-top: 1px;
                }

                .fa-doc-cta {
                    display: inline-flex; align-items: center; gap: 4px;
                    flex-shrink: 0; font-size: var(--text-xs); font-weight: 600;
                    color: var(--accent-text, var(--primary-600));
                    white-space: nowrap;
                }

                /* ── Document context (signing step) ─────────────────────── */
                .fa-doc-context {
                    display: flex; align-items: center; gap: var(--space-2);
                    padding: var(--space-2) var(--space-3);
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                }
                .fa-doc-context-icon { color: var(--text-muted); flex-shrink: 0; }
                .fa-doc-context-body {
                    display: flex; flex-direction: column; flex: 1; min-width: 0;
                }
                .fa-doc-context-title {
                    font-size: var(--text-sm); font-weight: 600; color: var(--text-primary);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .fa-doc-context-type { font-size: var(--text-xs); color: var(--text-muted); }
                .fa-doc-context-link {
                    display: inline-flex; align-items: center; gap: 4px;
                    flex-shrink: 0; font-size: var(--text-xs); font-weight: 500;
                    color: var(--accent-text, var(--primary-600));
                    background: none; border: none; cursor: pointer; padding: 2px 6px;
                    border-radius: var(--radius-sm);
                    transition: background 0.1s;
                }
                .fa-doc-context-link:hover { background: var(--accent-tint); }
                .fa-doc-context-link:disabled { opacity: 0.5; cursor: default; }

                /* ── Declare checkbox — identical to msig-declare-check ───── */
                .fa-declare-check {
                    display: flex; align-items: flex-start; gap: var(--space-3);
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
                .fa-declare-check:has(input:checked) {
                    border-color: var(--primary-400);
                    background: var(--accent-tint);
                    color: var(--text-primary);
                }
                .fa-declare-check input[type="checkbox"] {
                    flex-shrink: 0; width: 16px; height: 16px; margin-top: 1px;
                    accent-color: var(--primary-500); cursor: pointer;
                }

                /* ── Spinner ─────────────────────────────────────────────── */
                .fa-spinner {
                    width: 16px; height: 16px; border-radius: 50%;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-top-color: #fff;
                    animation: fa-spin 0.7s linear infinite; display: inline-block;
                }
                @keyframes fa-spin { to { transform: rotate(360deg); } }
            `}</style>
        </Modal>
    );
}
