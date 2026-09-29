import { useState, type ReactNode } from 'react';
import { FiAlertCircle, FiCheck, FiEdit3, FiX } from 'react-icons/fi';
import PinInput from '../PinInput';
import { Modal } from '../ui';

/**
 * El modal de firma de "Mis firmas", compartido.
 *
 * No es solo el PIN: a la izquierda muestra QUÉ se firma (lo arma quien lo usa,
 * por `children`) para que la decisión no dependa de haber leído algo en otra
 * pantalla; a la derecha, el aviso de que no se puede deshacer, el PIN y la
 * declaración, sin la cual no se habilita "Confirmar firma".
 *
 * Nació dentro de MySignatures.tsx (rediseño de firmas, pensado para el
 * celular) y se sacó para que firmar una encuesta se vea y se comporte igual
 * que firmar un documento.
 */

export interface FichaFirmaItem {
    label: string;
    valor: ReactNode;
    full?: boolean;
}

/** Ficha de datos en dos columnas: lo que se firma, o una firma ya hecha. */
export function FichaFirma({ items }: { items: FichaFirmaItem[] }) {
    return (
        <dl className="msig-ficha">
            {items.map((it) => (
                <div key={it.label} className={it.full ? 'msig-ficha-item msig-ficha-item--full' : 'msig-ficha-item'}>
                    <dt>{it.label}</dt>
                    <dd>{it.valor}</dd>
                </div>
            ))}
        </dl>
    );
}

export interface FirmaModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Recibe el PIN de 4 dígitos ya ingresado y la declaración marcada. */
    onConfirm: (pin: string) => void | Promise<void>;
    firmando: boolean;
    error?: string;
    titulo?: string;
    subtitulo?: string;
    icono?: ReactNode;
    declaracion?: string;
    /** Reemplaza el aviso por omisión (p. ej. para decir que se firma sin red). */
    aviso?: ReactNode;
    /** Columna izquierda: qué se está firmando. */
    children: ReactNode;
}

export default function FirmaModal(props: FirmaModalProps) {
    // Montado solo mientras está abierto: cada vez que se abre parte sin PIN y
    // sin la declaración marcada, sin tener que limpiarlos a mano.
    return props.isOpen ? <FirmaModalAbierto {...props} /> : null;
}

function FirmaModalAbierto({
    onClose,
    onConfirm,
    firmando,
    error,
    titulo = 'Firmar documento',
    subtitulo,
    icono = <FiEdit3 size={22} />,
    declaracion = 'Declaro haber leído conscientemente la solicitud de firma',
    aviso,
    children,
}: FirmaModalProps) {
    const [pin, setPin] = useState('');
    const [declarado, setDeclarado] = useState(false);

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={titulo}
            subtitle={subtitulo}
            icon={icono}
            size="lg"
            preventClose={firmando}
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose} disabled={firmando}>
                        <FiX size={16} /> Cancelar
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={() => onConfirm(pin)}
                        disabled={firmando || pin.length !== 4 || !declarado}
                    >
                        {firmando
                            ? <><div className="spinner" style={{ width: '16px', height: '16px' }} /> Firmando...</>
                            : <><FiCheck size={18} /> Confirmar firma</>
                        }
                    </button>
                </>
            }
        >
            <div className="msig-modal-grid">
                <div className="msig-modal-col">{children}</div>

                <div className="msig-modal-col">
                    <div className="msig-notice">
                        <FiAlertCircle size={16} />
                        <span>
                            {aviso ?? <>Tu firma queda registrada con fecha, hora e identidad verificada. Esta acción <strong>no se puede deshacer</strong>.</>}
                        </span>
                    </div>

                    <PinInput
                        onComplete={(completo) => setPin(completo)}
                        disabled={firmando}
                        mode="verify"
                        title="Ingresa tu PIN de firma"
                        subtitle=" "
                        error={error}
                    />
                    <label className="msig-declare-check">
                        <input
                            type="checkbox"
                            checked={declarado}
                            onChange={(e) => setDeclarado(e.target.checked)}
                            disabled={firmando}
                        />
                        <span>{declaracion}</span>
                    </label>
                </div>
            </div>
        </Modal>
    );
}
