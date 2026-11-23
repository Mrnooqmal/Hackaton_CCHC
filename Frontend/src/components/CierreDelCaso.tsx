import { useState } from 'react';
import { FiLock, FiUnlock } from 'react-icons/fi';
import { incidentsApi, type Incident } from '../api/client';
import { useToast } from '../context/ToastContext';
// Los topes son los que aplica el servidor: viven en `utils/casos`, espejo de lib/casos.js.
import { MAX_COMENTARIO_CIERRE, MAX_MOTIVO_REAPERTURA } from '../utils/casos';

interface Props {
    incidente: Incident;
    cerrado: boolean;
    /** Se llama cuando el servidor cerró o reabrió el caso, para que la pantalla recargue. */
    onCambio: () => void;
}

/**
 * Cierre del caso (fase 3): el comentario de cierre y el botón "Cerrar caso".
 * Se monta solo para quien tiene `incidentes.calificar_accidente` (el padre
 * decide; el servidor lo exige igual).
 *
 * El servidor cierra solo si el caso está clasificado, con sus papeles completos
 * (en un accidente, el plan de medidas correctivas). Si falta algo responde con la lista, en frases ya escritas para
 * quien la lee, y esta pantalla la muestra tal cual: el criterio de "completo"
 * vive en un solo lugar (`lib/casos.js`) y no se repite acá.
 *
 * Un caso cerrado no admite cambios. Si hay que corregirlo, se reabre con un
 * motivo, que queda registrado junto con el cierre que se deshizo.
 */
export default function CierreDelCaso({ incidente, cerrado, onCambio }: Props) {
    const { toast } = useToast();
    const [texto, setTexto] = useState('');
    const [trabajando, setTrabajando] = useState(false);
    const [error, setError] = useState('');
    const [pendientes, setPendientes] = useState<string[]>([]);
    const [reabriendo, setReabriendo] = useState(false);

    const cerrar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (trabajando) return;
        if (!texto.trim()) { setError('Escribe el comentario de cierre.'); setPendientes([]); return; }
        setError('');
        setPendientes([]);
        setTrabajando(true);
        try {
            const res = await incidentsApi.cerrarCaso(incidente.incidentId, texto.trim());
            if (!res.success) {
                setPendientes(res.pendientes ?? []);
                setError(res.pendientes?.length ? 'Todavía no se puede cerrar el caso. Falta lo siguiente:' : (res.error || 'No se pudo cerrar el caso.'));
                return;
            }
            toast.success('Caso cerrado');
            setTexto('');
            onCambio();
        } catch {
            setError('Error de conexión al cerrar el caso. Intenta de nuevo.');
        } finally {
            setTrabajando(false);
        }
    };

    const reabrir = async (e: React.FormEvent) => {
        e.preventDefault();
        if (trabajando) return;
        if (!texto.trim()) { setError('Escribe el motivo para reabrir el caso.'); return; }
        setError('');
        setTrabajando(true);
        try {
            const res = await incidentsApi.reabrirCaso(incidente.incidentId, texto.trim());
            if (!res.success) { setError(res.error || 'No se pudo reabrir el caso.'); return; }
            toast.success('Caso reabierto');
            setTexto('');
            setReabriendo(false);
            onCambio();
        } catch {
            setError('Error de conexión al reabrir el caso. Intenta de nuevo.');
        } finally {
            setTrabajando(false);
        }
    };

    if (cerrado) {
        const comentario = incidente.cierre?.comentario || incidente.gobernanza?.comentarioCierre;
        return (
            <section className="inc-ficha-card" aria-label="Cierre del caso">
                <div>
                    <h2 className="inc-papeles-titulo">Caso cerrado</h2>
                    {comentario && <p className="inc-ficha-texto">Comentario de cierre: {comentario}</p>}
                    {fechaDelCierre(incidente) && <p className="inc-ficha-texto inc-papeles-ayuda">Cerrado el {fechaDelCierre(incidente)}.</p>}
                </div>
                {!reabriendo ? (
                    <div>
                        <button type="button" className="btn btn-secondary" onClick={() => { setReabriendo(true); setTexto(''); setError(''); }}>
                            <FiUnlock size={16} /> Reabrir el caso
                        </button>
                    </div>
                ) : (
                    <form className="inc-papeles-form" onSubmit={reabrir}>
                        <div className="form-group">
                            <label className="form-label" htmlFor="reabrir-motivo">Motivo para reabrirlo</label>
                            <textarea
                                id="reabrir-motivo"
                                className="form-input"
                                rows={3}
                                maxLength={MAX_MOTIVO_REAPERTURA}
                                value={texto}
                                disabled={trabajando}
                                onChange={(e) => setTexto(e.target.value)}
                            />
                            <p className="form-hint">El motivo queda registrado junto con el cierre anterior.</p>
                        </div>
                        {error && <div className="alert alert-danger" role="alert"><div>{error}</div></div>}
                        <div className="inc-medidas-acciones">
                            <button type="submit" className="btn btn-primary" disabled={trabajando}>{trabajando ? 'Reabriendo…' : 'Reabrir el caso'}</button>
                            <button type="button" className="btn btn-ghost" onClick={() => { setReabriendo(false); setError(''); }} disabled={trabajando}>Cancelar</button>
                        </div>
                    </form>
                )}
            </section>
        );
    }

    return (
        <section className="inc-ficha-card" aria-label="Cierre del caso">
            <div>
                <h2 className="inc-papeles-titulo">Cerrar el caso</h2>
                <p className="inc-ficha-texto inc-papeles-ayuda">
                    Se puede cerrar cuando está clasificado, con sus papeles completos. Un caso cerrado ya no admite cambios.
                </p>
            </div>
            <form className="inc-papeles-form" onSubmit={cerrar}>
                <div className="form-group">
                    <label className="form-label" htmlFor="cierre-comentario">Comentario de cierre</label>
                    <textarea
                        id="cierre-comentario"
                        className="form-input"
                        rows={3}
                        maxLength={MAX_COMENTARIO_CIERRE}
                        placeholder="Qué se hizo y cómo se verificó"
                        value={texto}
                        disabled={trabajando}
                        onChange={(e) => setTexto(e.target.value)}
                    />
                </div>
                {error && (
                    <div className="alert alert-danger" role="alert">
                        <div>
                            {error}
                            {pendientes.length > 0 && (
                                <ul className="inc-cierre-pendientes">
                                    {pendientes.map((p, i) => <li key={`${i}-${p}`}>{p}</li>)}
                                </ul>
                            )}
                        </div>
                    </div>
                )}
                <div>
                    <button type="submit" className="btn btn-primary" disabled={trabajando}>
                        <FiLock size={16} /> {trabajando ? 'Cerrando…' : 'Cerrar caso'}
                    </button>
                </div>
            </form>
        </section>
    );
}

/** Fecha del cierre en texto, si el caso la trae (los cerrados antes de la fase 3 no). */
function fechaDelCierre(incidente: Incident): string {
    const iso = incidente.cierre?.cerradoEn || incidente.gobernanza?.fechaVerificacion;
    return iso ? new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}
