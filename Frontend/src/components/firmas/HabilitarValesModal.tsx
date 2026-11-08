import { useEffect, useState } from 'react';
import { FiWifiOff } from 'react-icons/fi';
import { Modal } from '../ui';
import PinCasillas from '../PinCasillas';
import { useOfflineSignature } from '../../hooks/useOfflineSignature';

/**
 * Habilita la firma sin conexión de una persona en ESTE equipo, para la obra del
 * turno. Es el único momento en que el PIN entra a este flujo, y requiere red:
 * el servidor lo valida y entrega 5 vales de un solo uso, que el equipo guarda en
 * vez del PIN.
 *
 * Lo usan el aviso al entrar (la persona para sí misma) y "Preparar cuadrilla sin
 * señal" (el supervisor, con cada trabajador tecleando SU PIN en su equipo).
 */
interface Props {
    isOpen: boolean;
    onClose: () => void;
    personaId: string;
    nombre: string;
    obraId: string;
    obraNombre?: string;
    /** Se llama con la hora de vencimiento cuando quedó habilitada. */
    onListo?: (expiraEn: string) => void;
}

export default function HabilitarValesModal({ isOpen, onClose, personaId, nombre, obraId, obraNombre, onListo }: Props) {
    const { habilitarSinConexion } = useOfflineSignature();
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);

    useEffect(() => {
        if (isOpen) { setPin(''); setError(''); }
    }, [isOpen, personaId]);

    const habilitar = async (valor: string) => {
        if (valor.length !== 4 || enviando) return;
        setEnviando(true);
        setError('');
        const r = await habilitarSinConexion(personaId, valor, obraId);
        setEnviando(false);
        if (!r.success) {
            setPin('');
            setError(r.error || 'No se pudo habilitar la firma sin conexión.');
            return;
        }
        onListo?.(r.expiraEn || '');
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            preventClose={enviando}
            size="sm"
            icon={<FiWifiOff />}
            title="Habilitar firma sin conexión"
            subtitle={obraNombre ? `${nombre} · ${obraNombre}` : nombre}
            footer={
                <>
                    <button type="button" className="btn btn-secondary" onClick={onClose} disabled={enviando}>Cancelar</button>
                    <button type="button" className="btn btn-primary" onClick={() => habilitar(pin)} disabled={enviando || pin.length !== 4}>
                        {enviando ? 'Habilitando…' : 'Habilitar'}
                    </button>
                </>
            }
        >
            <p style={{ marginTop: 0 }}>
                {nombre} ingresa su PIN para poder firmar sin señal durante este turno en esta obra. El PIN no
                se guarda en el equipo: se entregan 5 firmas de un solo uso, válidas por 12 horas.
            </p>
            <PinCasillas
                id={`pin-vales-${personaId}`}
                value={pin}
                onChange={(v) => { setPin(v); setError(''); }}
                onComplete={habilitar}
                error={Boolean(error)}
                disabled={enviando}
                autoFocus
                ariaLabel={`PIN de ${nombre}`}
            />
            {error && <p className="form-error" role="alert">{error}</p>}
        </Modal>
    );
}
