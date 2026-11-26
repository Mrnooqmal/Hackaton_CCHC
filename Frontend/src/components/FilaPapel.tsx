import { useState } from 'react';
import { FiDownload, FiLock, FiSlash } from 'react-icons/fi';
import { incidentsApi, type PapelDelCaso } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Badge } from './ui';
import { etiquetaTipoPapel, MAX_MOTIVO_ANULACION } from '../utils/casos';
import { fechaCorta, tamanoLegible } from '../utils/papeles';

interface Props {
    incidentId: string;
    papel: PapelDelCaso;
    puedeAnular: boolean;
    descargando: string | null;
    onDescargar: (papel: PapelDelCaso) => void;
    onAnulado: () => void;
    onDesactualizado: () => void;
}

export default function FilaPapel({ incidentId, papel: p, puedeAnular, descargando, onDescargar, onAnulado, onDesactualizado }: Props) {
    const { toast } = useToast();
    const [anulando, setAnulando] = useState(false);
    const [motivo, setMotivo] = useState('');
    const [error, setError] = useState('');
    const [guardando, setGuardando] = useState(false);
    const anulable = puedeAnular && !p.anulado && !p.legado && !p.firmado;
    const idMotivo = `anular-motivo-${p.papelId}`;

    const abrir = (abierto: boolean) => {
        setAnulando(abierto);
        setMotivo('');
        setError('');
    };

    const anular = async (e: React.FormEvent) => {
        e.preventDefault();
        if (guardando) return;
        if (!motivo.trim()) { setError('Escribe por qué se anula el papel.'); return; }
        setError('');
        setGuardando(true);
        try {
            const res = await incidentsApi.anularPapel(incidentId, p.papelId, motivo.trim());
            if (!res.success) {
                if (res.codigo === 'CONFLICTO') {
                    toast.error(res.error || 'El caso cambió. Revisa los papeles e intenta de nuevo.');
                    onDesactualizado();
                    return;
                }
                setError(res.error || 'No se pudo anular el papel.');
                return;
            }
            toast.success('Papel anulado');
            abrir(false);
            onAnulado();
        } catch {
            setError('Error de conexión al anular el papel. Intenta de nuevo.');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <li className={`inc-papeles-fila inc-papeles-fila--archivo${p.anulado ? ' inc-papeles-fila--anulado' : ''}`}>
            <div className="inc-papeles-nombre">
                <div>{etiquetaTipoPapel(p.tipo)}</div>
                <div className="inc-papeles-meta">
                    {p.nombreArchivo || 'Sin nombre'}{p.tamano ? ` · ${tamanoLegible(p.tamano)}` : ''}
                    {p.fechaDocumento ? ` · documento del ${fechaCorta(p.fechaDocumento)}` : ''}
                    {p.subidoEn ? ` · ${p.firmado ? 'firmado' : 'subido'} el ${new Date(p.subidoEn).toLocaleDateString('es-CL')}` : ''}
                </div>
                {p.anulado && (
                    <div className="inc-papeles-meta">
                        Anulado el {new Date(p.anulado.anuladoEn).toLocaleDateString('es-CL')}: {p.anulado.motivo}
                    </div>
                )}
            </div>
            {p.anulado && <Badge variant="warning" size="sm">Anulado</Badge>}
            {p.contieneSalud && (
                <span title="Contiene datos de salud: quién lo descarga queda registrado">
                    <Badge variant="info" size="sm"><FiLock size={11} /> Datos de salud</Badge>
                </span>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onDescargar(p)} disabled={descargando !== null}>
                <FiDownload size={14} /> {descargando === p.papelId ? 'Preparando…' : 'Descargar'}
            </button>
            {anulable && !anulando && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => abrir(true)}>
                    <FiSlash size={14} /> Anular
                </button>
            )}
            {anulable && anulando && (
                <form className="inc-papeles-anular" onSubmit={anular}>
                    <label className="form-label" htmlFor={idMotivo}>Por qué se anula</label>
                    <textarea
                        id={idMotivo}
                        className="form-input"
                        rows={2}
                        maxLength={MAX_MOTIVO_ANULACION}
                        value={motivo}
                        disabled={guardando}
                        onChange={(e) => setMotivo(e.target.value)}
                    />
                    <p className="form-hint">Deja de contar para el caso. El archivo se conserva y puedes subir el correcto.</p>
                    {error && <div className="alert alert-danger" role="alert"><div>{error}</div></div>}
                    <div className="inc-medidas-acciones">
                        <button type="submit" className="btn btn-primary btn-sm" disabled={guardando}>{guardando ? 'Anulando…' : 'Anular papel'}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => abrir(false)} disabled={guardando}>Cancelar</button>
                    </div>
                </form>
            )}
        </li>
    );
}
