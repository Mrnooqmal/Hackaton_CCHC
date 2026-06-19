import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiCheckCircle, FiArrowRight, FiShield, FiFileText, FiEdit3 } from 'react-icons/fi';
import { signatureRequestsApi, documentsApi, REQUEST_TYPES } from '../api/client';

interface MisFirmasResumenProps {
    /** personaId del usuario en sesión. */
    personaId: string;
}

/** Fila de firma pendiente lista para clickear y firmar directo. */
interface PendingRow {
    /** Identificador que reutiliza MySignatures para abrir el modal de firma.
     *  Para documentos de onboarding es `doc:<documentId>`. */
    requestId: string;
    titulo: string;
    tipoLabel: string;
    icon?: string;
}

/**
 * Resumen de avance de firmas propias del usuario en sesión. Pensado para el
 * inicio de roles no-admin: muestra el % de avance y la lista de firmas
 * pendientes. Cada pendiente es clickeable y lleva directo a firmar ese
 * documento en el Centro de Firmas (sin pasos intermedios).
 *
 * Carga sus propios datos (igual que MySignatures: solicitudes pendientes +
 * documentos de onboarding firmables + historial) para no acoplarse a los
 * loaders por rol del Dashboard.
 */
export default function MisFirmasResumen({ personaId }: MisFirmasResumenProps) {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [pendientes, setPendientes] = useState<PendingRow[]>([]);
    const [firmadas, setFirmadas] = useState(0);

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true);
            try {
                const [pendRes, docsRes, histRes] = await Promise.allSettled([
                    signatureRequestsApi.getPendingByWorker(personaId),
                    documentsApi.list({ clasificacion: 'diario', pendienteDe: personaId }),
                    signatureRequestsApi.getHistoryByWorker(personaId),
                ]);
                if (!active) return;

                const rows: PendingRow[] = [];

                // Documentos de onboarding firmables (mismo orden que MySignatures).
                if (docsRes.status === 'fulfilled' && docsRes.value.success && docsRes.value.data?.documents) {
                    docsRes.value.data.documents.forEach((doc: any) => {
                        rows.push({
                            requestId: `doc:${doc.documentId}`,
                            titulo: doc.titulo || doc.tipoDescripcion || 'Documento de onboarding',
                            tipoLabel: doc.articulo ? `Onboarding · ${doc.articulo}` : 'Onboarding',
                        });
                    });
                }

                // Solicitudes de firma pendientes.
                if (pendRes.status === 'fulfilled' && pendRes.value.success && pendRes.value.data) {
                    pendRes.value.data.pendientes.forEach((req) => {
                        rows.push({
                            requestId: req.requestId,
                            titulo: req.titulo,
                            tipoLabel: REQUEST_TYPES[req.tipo]?.label || 'Documento',
                            icon: REQUEST_TYPES[req.tipo]?.icon,
                        });
                    });
                }

                setPendientes(rows);

                if (histRes.status === 'fulfilled' && histRes.value.success && histRes.value.data) {
                    setFirmadas(histRes.value.data.totalFirmas ?? histRes.value.data.historial.length);
                }
            } catch (err) {
                console.error('Error loading firmas resumen:', err);
            } finally {
                if (active) setLoading(false);
            }
        };
        load();
        return () => { active = false; };
    }, [personaId]);

    const total = pendientes.length + firmadas;
    const progress = total > 0 ? Math.round((firmadas / total) * 100) : 100;
    const progressColor = pendientes.length === 0 ? 'var(--success-500)' : 'var(--primary-500)';

    // Lleva al Centro de Firmas con el documento ya seleccionado para firmar.
    const firmar = (requestId: string) => {
        navigate('/my-signatures', { state: { firmarRequestId: requestId } });
    };

    return (
        <div>
            <div className="dash-section-header">
                <h2 className="dash-section-title">Mis firmas</h2>
                <Link to="/my-signatures" className="btn btn-secondary btn-sm">
                    Centro de firmas <FiArrowRight />
                </Link>
            </div>

            <div className="card" style={{ padding: 'var(--space-4)', border: '1px solid var(--surface-border)' }}>
                {loading ? (
                    <div className="flex items-center gap-3 text-muted text-sm" style={{ padding: 'var(--space-2) 0' }}>
                        <div className="spinner" style={{ width: '18px', height: '18px' }} />
                        Cargando tus firmas…
                    </div>
                ) : (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)', gap: 'var(--space-3)' }}>
                            <div className="flex items-center gap-2">
                                <FiShield size={16} style={{ color: progressColor }} />
                                <span className="text-sm text-muted">Avance de firmas</span>
                            </div>
                            <span className="text-sm font-bold">{progress}%</span>
                        </div>

                        <div className="progress">
                            <div className="progress-bar" style={{ width: `${progress}%`, background: progressColor }} />
                        </div>

                        {pendientes.length === 0 ? (
                            <div className="firmas-resumen-done">
                                <FiCheckCircle size={16} style={{ color: 'var(--success-500)' }} />
                                {total > 0 ? '¡Tienes todas tus firmas al día!' : 'No tienes firmas asignadas por ahora.'}
                            </div>
                        ) : (
                            <div className="firmas-resumen-list">
                                {pendientes.map((row) => (
                                    <button
                                        key={row.requestId}
                                        type="button"
                                        className="firmas-resumen-row"
                                        onClick={() => firmar(row.requestId)}
                                        title="Firmar este documento"
                                    >
                                        <span className="firmas-resumen-row-icon">
                                            {row.icon ? <span aria-hidden>{row.icon}</span> : <FiFileText size={16} />}
                                        </span>
                                        <span className="firmas-resumen-row-body">
                                            <span className="firmas-resumen-row-title">{row.titulo}</span>
                                            <span className="firmas-resumen-row-type">{row.tipoLabel}</span>
                                        </span>
                                        <span className="firmas-resumen-row-cta">
                                            <FiEdit3 size={14} /> Firmar
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            <style>{`
                .firmas-resumen-done {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    margin-top: var(--space-4);
                    font-size: var(--text-sm);
                    color: var(--text-secondary);
                }
                .firmas-resumen-list {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-2);
                    margin-top: var(--space-4);
                }
                .firmas-resumen-row {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    width: 100%;
                    text-align: left;
                    padding: var(--space-3);
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-left: 3px solid var(--warning-400);
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
                }
                .firmas-resumen-row:hover {
                    background: var(--surface-hover);
                    transform: translateY(-1px);
                    box-shadow: var(--shadow-sm);
                }
                .firmas-resumen-row-icon {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    flex-shrink: 0;
                    font-size: 1.1rem;
                    border-radius: var(--radius-md);
                    background: var(--surface-card);
                    border: 1px solid var(--surface-border);
                    color: var(--warning-600);
                }
                .firmas-resumen-row-body {
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                    flex: 1;
                }
                .firmas-resumen-row-title {
                    font-weight: 600;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .firmas-resumen-row-type {
                    font-size: var(--text-xs);
                    color: var(--text-secondary);
                }
                .firmas-resumen-row-cta {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    flex-shrink: 0;
                    font-size: var(--text-sm);
                    font-weight: 600;
                    color: var(--primary-600);
                }
            `}</style>
        </div>
    );
}
