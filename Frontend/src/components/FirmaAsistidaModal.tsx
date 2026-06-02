import { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui';
import { documentsApi, uploadsApi } from '../api/client';

/**
 * Firma asistida desde el perfil del admin/supervisor/prevencionista.
 *
 * Modalidad principal: el TRABAJADOR teclea su PIN en el dispositivo del
 * asistente. Modalidad secundaria opcional: PRESENCIAL (firma registrada por el
 * tercero). El backend deja personaId del trabajador + metadata.asistidoPor.
 *
 * Seleccion: lista de trabajadores de la obra activa + filtro por nombre/RUT.
 */

interface FirmaAsistidaModalProps {
    isOpen: boolean;
    onClose: () => void;
    obraId: string;
    /** Trabajadores de la obra activa (ya cargados por el padre). */
    workers: any[];
    /** personaId del asistente (usuario logueado). */
    asistidoPor: string;
    /** Si viene, abre directamente en los documentos pendientes de ese trabajador. */
    initialWorkerId?: string;
    /** Si viene (junto con initialWorkerId), preselecciona el documento de ese tipo. */
    initialTipo?: string;
    /** Se llama tras una firma exitosa para refrescar el estado del padre. */
    onSigned?: () => void;
}

type Step = 'worker' | 'document';

export default function FirmaAsistidaModal({ isOpen, onClose, obraId, workers, asistidoPor, initialWorkerId, initialTipo, onSigned }: FirmaAsistidaModalProps) {
    const [step, setStep] = useState<Step>('worker');
    const [filtro, setFiltro] = useState('');
    const [selectedWorker, setSelectedWorker] = useState<any | null>(null);
    const [docs, setDocs] = useState<any[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(false);
    const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
    const [metodo, setMetodo] = useState<'PIN' | 'PRESENCIAL'>('PIN');
    const [pin, setPin] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [okMsg, setOkMsg] = useState<string | null>(null);
    const [viewing, setViewing] = useState(false);

    // En modo directo (se abrió desde un ítem concreto del onboarding) no se
    // muestra el listado de documentos: se va directo a firmar ese documento.
    const directMode = Boolean(initialTipo);
    const selectedDoc = docs.find((d) => d.documentId === selectedDocId);

    const reset = () => {
        setStep('worker');
        setFiltro('');
        setSelectedWorker(null);
        setDocs([]);
        setSelectedDocId(null);
        setMetodo('PIN');
        setPin('');
        setError(null);
        setOkMsg(null);
    };

    useEffect(() => {
        if (!isOpen) reset();
    }, [isOpen]);

    const filtered = useMemo(() => {
        const q = filtro.trim().toLowerCase();
        const active = (workers || []).filter((w) => w.estado !== 'inactivo' && w.rol !== 'admin');
        if (!q) return active;
        return active.filter((w) =>
            `${w.nombre || ''} ${w.apellido || ''}`.toLowerCase().includes(q) ||
            String(w.rut || '').toLowerCase().includes(q)
        );
    }, [workers, filtro]);

    const selectWorker = async (w: any, preferTipo?: string) => {
        setSelectedWorker(w);
        setStep('document');
        setError(null);
        setOkMsg(null);
        setLoadingDocs(true);
        try {
            // Documentos de la obra y filtramos los asignados a esta persona, pendientes.
            const res = await documentsApi.list({ obraId } as any);
            const all = res.success && res.data ? res.data.documents || [] : [];
            const wid = w.personaId;
            const pendientes = all.filter((d: any) =>
                (d.asignaciones || []).some((a: any) =>
                    a.personaId === wid && a.estado === 'pendiente'
                )
            );
            setDocs(pendientes);
            // Si se pidió un tipo concreto, preselecciona ese documento (firma directa).
            if (preferTipo) {
                const match = pendientes.find((d: any) => d.tipo === preferTipo);
                if (match) setSelectedDocId(match.documentId);
            }
        } catch {
            setError('No se pudieron cargar los documentos del trabajador.');
        } finally {
            setLoadingDocs(false);
        }
    };

    // Si se abre con un trabajador preseleccionado, salta directo a sus pendientes
    // (y preselecciona el documento si se indicó initialTipo).
    useEffect(() => {
        if (isOpen && initialWorkerId && !selectedWorker) {
            const w = (workers || []).find((x) => x.personaId === initialWorkerId);
            if (w) selectWorker(w, initialTipo);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialWorkerId, initialTipo]);

    const handleSign = async () => {
        if (!selectedWorker || !selectedDocId) return;
        if (metodo === 'PIN' && (!pin || pin.length < 4)) {
            setError('El trabajador debe ingresar su PIN (mínimo 4 dígitos).');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const res = await documentsApi.signAssisted(selectedDocId, {
                firmanteId: selectedWorker.personaId,
                asistidoPor,
                metodo,
                pin: metodo === 'PIN' ? pin : undefined,
            });
            if (!res.success || !res.data) {
                setError(res.error || 'No se pudo firmar. Verifica el PIN del trabajador.');
                return;
            }
            setOkMsg('Documento firmado correctamente.');
            setPin('');
            setSelectedDocId(null);
            // Refrescar la lista de pendientes del trabajador
            await selectWorker(selectedWorker);
            onSigned?.();
        } catch {
            setError('Error de conexión al firmar.');
        } finally {
            setSubmitting(false);
        }
    };

    // Abre el documento (PDF/imagen) para revisarlo antes de firmar.
    const verDocumento = async () => {
        const fileKey = selectedDoc?.s3Key || selectedDoc?.archivoUrl;
        if (!fileKey) { setError('Este documento aún no tiene archivo subido.'); return; }
        setViewing(true);
        setError(null);
        try {
            const res = await uploadsApi.getDownloadUrl(fileKey);
            if (res.success && res.data?.downloadUrl) {
                window.open(res.data.downloadUrl, '_blank');
            } else {
                setError('No se pudo abrir el documento.');
            }
        } catch {
            setError('No se pudo abrir el documento.');
        } finally {
            setViewing(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Firma asistida"
            subtitle="El trabajador firma con su PIN en este dispositivo. Queda registrado quién asiste la firma."
            size="md"
            footer={
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    {step === 'document' ? (
                        <button className="btn btn-secondary" onClick={() => { setStep('worker'); setError(null); setOkMsg(null); }}>
                            Volver
                        </button>
                    ) : <span />}
                    <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
                </div>
            }
        >
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {error && (
                    <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.82rem', color: '#b91c1c' }}>
                        {error}
                    </div>
                )}
                {okMsg && (
                    <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', fontSize: '0.82rem', color: '#065f46' }}>
                        {okMsg}
                    </div>
                )}

                {step === 'worker' && (
                    <>
                        <input
                            className="form-input"
                            placeholder="Filtrar por nombre o RUT"
                            value={filtro}
                            onChange={(e) => setFiltro(e.target.value)}
                            autoFocus
                        />
                        <div style={{ maxHeight: '340px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                            {filtered.length === 0 ? (
                                <div className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-3)' }}>
                                    No hay trabajadores que coincidan.
                                </div>
                            ) : filtered.map((w) => (
                                <button
                                    key={w.personaId}
                                    type="button"
                                    className="card"
                                    style={{ padding: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', textAlign: 'left' }}
                                    onClick={() => selectWorker(w)}
                                >
                                    <div>
                                        <div className="font-medium">{w.nombre} {w.apellido || ''}</div>
                                        <div className="text-muted" style={{ fontSize: '0.8rem' }}>{w.cargo || 'Trabajador'} · {w.rut}</div>
                                    </div>
                                    <span className="text-muted">→</span>
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {step === 'document' && selectedWorker && (
                    <>
                        <div className="card" style={{ padding: 'var(--space-3)' }}>
                            <div className="font-medium">{selectedWorker.nombre} {selectedWorker.apellido || ''}</div>
                            <div className="text-muted" style={{ fontSize: '0.8rem' }}>{selectedWorker.rut}</div>
                        </div>

                        {loadingDocs ? (
                            <div className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-3)' }}>Cargando…</div>
                        ) : docs.length === 0 ? (
                            <div className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-3)' }}>
                                Este trabajador no tiene documentos pendientes de firma.
                            </div>
                        ) : directMode ? (
                            /* Modo directo: ya viene el documento seleccionado, no se muestra el listado. */
                            selectedDoc ? (
                                <div className="card" style={{ padding: 'var(--space-3)' }}>
                                    <div className="font-medium" style={{ fontSize: '0.9rem' }}>{selectedDoc.titulo}</div>
                                    <div className="text-muted" style={{ fontSize: '0.78rem' }}>{selectedDoc.tipoDescripcion || selectedDoc.tipo}</div>
                                </div>
                            ) : (
                                <div className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-3)' }}>
                                    Este documento aún no está disponible para firmar (¿falta subirlo?).
                                </div>
                            )
                        ) : (
                            /* Selector: lista de pendientes deduplicada por tipo. */
                            <>
                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>Documentos pendientes de firma</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                    {Array.from(new Map(docs.map((d) => [d.tipo, d])).values()).map((d) => (
                                        <label
                                            key={d.documentId}
                                            className="card"
                                            style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}
                                        >
                                            <input
                                                type="radio"
                                                name="assisted-doc"
                                                checked={selectedDocId === d.documentId}
                                                onChange={() => { setSelectedDocId(d.documentId); setError(null); }}
                                            />
                                            <div>
                                                <div className="font-medium" style={{ fontSize: '0.9rem' }}>{d.titulo}</div>
                                                <div className="text-muted" style={{ fontSize: '0.78rem' }}>{d.tipoDescripcion || d.tipo}</div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </>
                        )}

                        {selectedDoc && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ alignSelf: 'flex-start' }}
                                    onClick={verDocumento}
                                    disabled={viewing}
                                >
                                    {viewing ? 'Abriendo…' : 'Ver documento'}
                                </button>

                                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                    <button
                                        type="button"
                                        className={`btn btn-sm ${metodo === 'PIN' ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setMetodo('PIN')}
                                    >
                                        PIN del trabajador
                                    </button>
                                    <button
                                        type="button"
                                        className={`btn btn-sm ${metodo === 'PRESENCIAL' ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setMetodo('PRESENCIAL')}
                                    >
                                        Firma presencial
                                    </button>
                                </div>

                                {metodo === 'PIN' ? (
                                    <div>
                                        <label className="text-muted" style={{ fontSize: '0.82rem', display: 'block', marginBottom: '4px' }}>
                                            El trabajador ingresa su PIN
                                        </label>
                                        <input
                                            type="password"
                                            inputMode="numeric"
                                            className="form-input"
                                            value={pin}
                                            onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(null); }}
                                            placeholder="••••"
                                            maxLength={8}
                                            autoComplete="off"
                                        />
                                    </div>
                                ) : (
                                    <div className="text-muted" style={{ fontSize: '0.8rem', padding: '8px 12px', borderRadius: '8px', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)' }}>
                                        Firma presencial registrada por el asistente. Queda trazada con tu identidad
                                        como responsable de la captura.
                                    </div>
                                )}

                                <button
                                    className="btn btn-primary"
                                    type="button"
                                    onClick={handleSign}
                                    disabled={submitting}
                                >
                                    {submitting ? 'Firmando…' : 'Firmar documento'}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </Modal>
    );
}
