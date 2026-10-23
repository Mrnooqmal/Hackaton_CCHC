import { useRef, useState } from 'react';
import { FiImage, FiUpload, FiX } from 'react-icons/fi';
import { MAX_LOGO_BYTES, compressLogo } from '../utils/identidadEmpresa';

export interface LogosValor {
    /** Un mismo logo para modo claro y oscuro (lo normal). */
    mismo: boolean;
    claro: string | null;
    oscuro: string | null;
}

interface Props {
    valor: LogosValor;
    onChange: (v: LogosValor) => void;
    onError: (mensaje: string) => void;
}

type Modo = 'claro' | 'oscuro';

/**
 * Logo de la empresa con vista previa en los dos modos. Por defecto un solo
 * logo; al desmarcar la casilla se sube uno para cada modo (por ejemplo, un
 * logo de letras blancas solo se lee sobre fondo oscuro).
 */
export default function LogoModos({ valor, onChange, onError }: Props) {
    const inputs = { claro: useRef<HTMLInputElement>(null), oscuro: useRef<HTMLInputElement>(null) };
    const [arrastrando, setArrastrando] = useState<Modo | null>(null);
    const { mismo, claro, oscuro } = valor;

    const leer = (file: File | undefined, modo: Modo) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) { onError('El logo debe ser una imagen (PNG, JPG, SVG o WebP).'); return; }
        if (file.size > MAX_LOGO_BYTES) { onError('El logo no puede pesar más de 2 MB.'); return; }
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const img = await compressLogo(e.target?.result as string);
                onError('');
                onChange({ ...valor, [modo]: img });
            } catch { onError('No se pudo leer la imagen. Prueba con otra.'); }
        };
        reader.readAsDataURL(file);
    };

    const quitar = (modo: Modo) => onChange({ ...valor, [modo]: null });

    const mostrado = (modo: Modo) => (mismo || modo === 'claro' ? claro : oscuro);

    const slot = (modo: Modo) => {
        const img = mostrado(modo);
        const etiqueta = modo === 'claro' ? 'Modo claro' : 'Modo oscuro';
        const editable = !mismo;
        const contenido = img
            ? <img src={img} alt={`Logo en ${etiqueta.toLowerCase()}`} />
            : <span className="lm-tile-vacio">{editable ? <><FiUpload size={16} aria-hidden="true" /> Subir logo</> : <FiImage size={20} aria-hidden="true" />}</span>;
        return (
            <div className="lm-slot" key={modo}>
                <span className="lm-slot-label">{etiqueta}</span>
                {editable ? (
                    <button type="button"
                        className={`lm-tile lm-tile--${modo} ${arrastrando === modo ? 'dragging' : ''}`}
                        aria-label={img ? `Cambiar el logo de ${etiqueta.toLowerCase()}` : `Subir el logo de ${etiqueta.toLowerCase()}`}
                        onClick={() => inputs[modo].current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setArrastrando(modo); }}
                        onDragLeave={() => setArrastrando(null)}
                        onDrop={(e) => { e.preventDefault(); setArrastrando(null); leer(e.dataTransfer.files?.[0], modo); }}>
                        {contenido}
                    </button>
                ) : (
                    <div className={`lm-tile lm-tile--${modo}`}>{contenido}</div>
                )}
                {editable && img && (
                    <div className="lm-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputs[modo].current?.click()}>
                            <FiUpload size={13} /> Cambiar
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm me-texto-alerta" onClick={() => quitar(modo)}>
                            <FiX size={13} /> Quitar
                        </button>
                    </div>
                )}
                <input ref={inputs[modo]} type="file" accept="image/*" hidden
                    onChange={(e) => { leer(e.target.files?.[0], modo); e.target.value = ''; }} />
            </div>
        );
    };

    return (
        <div className="lm">
            <label className="lm-mismo">
                <input type="checkbox" className="checkbox-input custom-checkbox" checked={mismo}
                    onChange={(e) => onChange({ ...valor, mismo: e.target.checked })} />
                Usar el mismo logo para modo claro y oscuro
            </label>

            {mismo && (
                <div className="lm-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputs.claro.current?.click()}>
                        <FiUpload size={13} /> {claro ? 'Cambiar logo' : 'Subir logo'}
                    </button>
                    {claro && (
                        <button type="button" className="btn btn-ghost btn-sm me-texto-alerta" onClick={() => quitar('claro')}>
                            <FiX size={13} /> Quitar
                        </button>
                    )}
                </div>
            )}

            <div className="lm-grid">{slot('claro')}{slot('oscuro')}</div>
            <span className="lm-hint">
                {mismo
                    ? 'Así se ve en cada modo. Si tu logo no se lee en alguno, desmarca la casilla y sube uno por modo.'
                    : 'Si falta el logo de modo oscuro, se usa el de modo claro.'}
                {' '}PNG, JPG, SVG o WebP · Máx. 2 MB
            </span>
        </div>
    );
}
