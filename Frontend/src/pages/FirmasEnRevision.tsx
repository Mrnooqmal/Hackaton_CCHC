import { useCallback, useEffect, useState } from 'react';
import { FiCheckSquare } from 'react-icons/fi';
import { PageHeader, EmptyState, LoadingSpinner, Modal } from '../components/ui';
import { signaturesApi, type FirmaEnRevision } from '../api/client';
import { useToast } from '../context/ToastContext';

/**
 * Firmas sin conexión que esperan confirmación.
 *
 * Una firma sin conexión entra en revisión si su vale venció antes de sincronizar,
 * si la hora declarada no es creíble, o si la persona fue desvinculada antes de
 * que llegara. No cuenta
 * como cumplimiento hasta que alguien con `firmas.crear` la confirma. Rechazarla
 * no la borra: queda revocada, con el motivo.
 *
 * Para juzgar se muestran las fechas de la cadena: cuándo se emitió y venció el
 * vale, cuándo se firmó en terreno (según el reloj del equipo: dato declarado),
 * cuándo se anuló y cuándo llegó al sistema.
 */
const fecha = (iso?: string | null) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; }
};
const QUE: Record<string, string> = { activity: 'Asistencia a actividad', document: 'Documento', survey: 'Encuesta' };

export default function FirmasEnRevision() {
    const { toast } = useToast();
    const [firmas, setFirmas] = useState<FirmaEnRevision[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [rechazando, setRechazando] = useState<FirmaEnRevision | null>(null);
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        const res = await signaturesApi.enRevision();
        if (res.success && res.data) setFirmas(res.data.firmas);
        else setError(res.error || 'No se pudo cargar las firmas en revisión.');
        setCargando(false);
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    const decidir = async (f: FirmaEnRevision, decision: 'confirmada' | 'rechazada', motivoRechazo?: string) => {
        setEnviando(true);
        const res = await signaturesApi.revisar(f.signatureId, { decision, motivo: motivoRechazo });
        setEnviando(false);
        if (!res.success) { toast.error(res.error || 'No se pudo guardar la decisión.'); return; }
        toast.success(decision === 'confirmada' ? 'Firma confirmada: ya cuenta como cumplimiento.' : 'Firma rechazada: queda revocada, con el motivo.');
        setRechazando(null);
        setMotivo('');
        cargar();
    };

    return (
        <div className="page-content">
            <PageHeader
                title="Firmas en revisión"
                description="Firmas tomadas sin conexión que llegaron con el vale vencido, con una hora que no es creíble, o después de desvincular a la persona. No cuentan como cumplimiento hasta que alguien las confirme."
            />
            {cargando ? <LoadingSpinner /> : error ? (
                <p className="form-error" role="alert">{error}</p>
            ) : firmas.length === 0 ? (
                <EmptyState icon={<FiCheckSquare />} title="No hay firmas en revisión" description="Todas las firmas sin conexión llegaron a tiempo." />
            ) : (
                <ul className="firmas-revision">
                    {firmas.map((f) => (
                        <li key={f.signatureId} className="firmas-revision__item">
                            <div className="firmas-revision__cabecera">
                                <strong>{f.personaNombre || 'Persona'}</strong>
                                <span>{QUE[f.referenciaTipo || ''] || f.tipoFirma || 'Firma'}</span>
                            </div>
                            <p className="firmas-revision__motivo">{f.motivoRevision}</p>
                            <dl className="firmas-revision__fechas">
                                <dt>Firmada en terreno (según el equipo)</dt><dd>{fecha(f.offline?.firmadaSinConexionEn)}</dd>
                                {f.offline?.valeEmitidoEn && <><dt>Vale emitido / vence</dt><dd>{fecha(f.offline.valeEmitidoEn)} / {fecha(f.offline.valeExpiraEn)}</dd></>}
                                {f.offline?.valeAnuladoEn && <><dt>Vale anulado (desvinculación)</dt><dd>{fecha(f.offline.valeAnuladoEn)}</dd></>}
                                <dt>Llegó al sistema</dt><dd>{fecha(f.offline?.sincronizadaEn || f.timestamp)}</dd>
                            </dl>
                            <div className="firmas-revision__acciones">
                                <button type="button" className="btn btn-primary btn-sm" disabled={enviando} onClick={() => decidir(f, 'confirmada')}>Confirmar</button>
                                <button type="button" className="btn btn-secondary btn-sm" disabled={enviando} onClick={() => { setRechazando(f); setMotivo(''); }}>Rechazar</button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <Modal
                isOpen={Boolean(rechazando)}
                onClose={() => setRechazando(null)}
                preventClose={enviando}
                size="sm"
                title="Rechazar firma"
                subtitle={rechazando?.personaNombre}
                footer={
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setRechazando(null)} disabled={enviando}>Cancelar</button>
                        <button
                            type="button"
                            className="btn btn-danger"
                            disabled={enviando || motivo.trim().length < 5}
                            onClick={() => rechazando && decidir(rechazando, 'rechazada', motivo.trim())}
                        >
                            Rechazar
                        </button>
                    </>
                }
            >
                <label className="form-label" htmlFor="motivo-rechazo">Motivo (queda en el acta)</label>
                <textarea id="motivo-rechazo" className="form-input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </Modal>
        </div>
    );
}
