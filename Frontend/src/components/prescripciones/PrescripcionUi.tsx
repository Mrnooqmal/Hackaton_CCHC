import { forwardRef, useRef, useState } from 'react';
import {
    FiAlertCircle, FiAlertTriangle, FiCheck, FiClock, FiFileText, FiRefreshCw, FiUploadCloud, FiX,
} from 'react-icons/fi';
import type { EstadoPrescripcion } from '../../api/estructura.api';

/**
 * Piezas que comparten el listado de prescripciones y sus dos formularios
 * (registrar y registrar implementación). Ver css/prescripciones.css.
 */

const ESTADO_META: Record<EstadoPrescripcion, { label: string; chip: string; icono: React.ReactNode }> = {
    Vencida: { label: 'Vencida', chip: 'pr-tinte-alerta', icono: <FiAlertTriangle size={11} /> },
    Pendiente: { label: 'Pendiente', chip: 'pr-chip--pendiente', icono: <FiClock size={11} /> },
    Implementada: { label: 'Implementada', chip: 'pr-tinte-exito', icono: <FiCheck size={11} /> },
};

export function ChipEstado({ estado }: { estado: EstadoPrescripcion }) {
    const meta = ESTADO_META[estado];
    return <span className={`pr-chip ${meta.chip}`}>{meta.icono}{meta.label}</span>;
}

/** Mensaje bajo el campo que causa el error. */
export function ErrorCampo({ id, children }: { id: string; children: React.ReactNode }) {
    return (
        <span id={id} className="pr-error">
            <FiAlertCircle size={13} aria-hidden="true" />
            {children}
        </span>
    );
}

/**
 * Resumen de errores DENTRO del formulario, bajo el encabezado. Recibe el foco
 * al fallar el envío y enlaza a cada campo. Antes el error iba a un aviso de la
 * página, detrás del panel, y el usuario no sabía qué corregir.
 */
export const ResumenErrores = forwardRef<HTMLDivElement, {
    titulo: string;
    items: { campo: string; etiqueta: string; resumen: string }[];
    general?: string | null;
    onIr: (campo: string) => void;
}>(function ResumenErrores({ titulo, items, general, onIr }, ref) {
    return (
        <div ref={ref} tabIndex={-1} role="alert" className="pr-aviso" style={{ marginBottom: 0 }}>
            <span className="pr-aviso-icono"><FiAlertCircle size={17} /></span>
            <div className="pr-aviso-cuerpo">
                <span className="pr-aviso-titulo">{titulo}</span>
                {general && <span className="pr-aviso-detalle">{general}</span>}
                {items.length > 0 && (
                    <ul className="pr-aviso-lista">
                        {items.map((it) => (
                            <li key={it.campo}>
                                <button type="button" onClick={() => onIr(it.campo)}>{it.etiqueta}</button> · {it.resumen}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
});

export type EstadoSubida = 'listo' | 'subiendo' | 'subido' | 'error';

/**
 * Campo de archivo: zona para soltar mientras no hay archivo; fila del archivo
 * con su estado cuando lo hay. Si la subida falla, el error queda en la propia
 * fila con "Reintentar", sin perder el archivo ni el resto del formulario.
 */
export function CampoArchivo({
    id, archivo, onArchivo, estado, errorSubida, invalido, descripcion, describedBy, tituloVacio = 'Arrastra el archivo o',
}: {
    id: string;
    archivo: File | null;
    onArchivo: (f: File | null) => void;
    estado: EstadoSubida;
    errorSubida?: string | null;
    invalido?: boolean;
    descripcion: string;
    describedBy?: string;
    tituloVacio?: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [sobre, setSobre] = useState(false);

    if (!archivo) {
        return (
            <label
                htmlFor={id}
                className={`pr-drop${sobre ? ' pr-drop--sobre' : ''}${invalido ? ' pr-input-error' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
                onDragLeave={() => setSobre(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setSobre(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) onArchivo(f);
                }}
            >
                <input
                    ref={inputRef} id={id} type="file" accept="application/pdf,image/*"
                    aria-invalid={invalido || undefined} aria-describedby={describedBy}
                    onChange={(e) => { onArchivo(e.target.files?.[0] || null); e.target.value = ''; }}
                />
                <span className="pr-drop-icono pr-tinte-neutro"><FiUploadCloud size={18} /></span>
                <span className="pr-drop-texto">
                    <span className="pr-drop-titulo">{tituloVacio} <span>selecciónalo</span></span>
                    <span className="pr-drop-desc">{descripcion}</span>
                </span>
            </label>
        );
    }

    const tam = archivo.size >= 1024 * 1024
        ? `${(archivo.size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
        : `${Math.max(1, Math.round(archivo.size / 1024))} KB`;
    const fallo = estado === 'error';

    return (
        // Mismo id que la zona para soltar: el resumen de errores enlaza a él.
        <div id={id} tabIndex={-1} className={`pr-archivo${fallo ? ' pr-input-error' : ''}`} aria-describedby={describedBy}>
            <span className={`pr-archivo-icono ${fallo ? 'pr-tinte-alerta' : estado === 'subido' ? 'pr-tinte-exito' : 'pr-tinte-neutro'}`}>
                {fallo ? <FiAlertTriangle size={16} /> : <FiFileText size={16} />}
            </span>
            <span className="pr-archivo-texto">
                <span className="pr-archivo-nombre" title={archivo.name}>{archivo.name}</span>
                <span className={`pr-archivo-estado${fallo ? ' pr-archivo-estado--error' : ''}`} aria-live="polite">
                    {fallo
                        ? `No se pudo subir: ${errorSubida || 'error de conexión'}`
                        : estado === 'subiendo' ? `${tam} · subiendo…`
                            : estado === 'subido' ? `${tam} · subido`
                                : `${tam} · listo para subir`}
                </span>
            </span>
            {fallo && (
                // Reintentar = volver a enviar el formulario: la subida es su
                // primer paso, y así se revalida también lo demás.
                <button type="submit" className="btn btn-secondary btn-sm">
                    <FiRefreshCw size={13} /> Reintentar
                </button>
            )}
            {estado !== 'subiendo' && (
                <button type="button" className="pr-icon-btn" aria-label="Quitar archivo" onClick={() => onArchivo(null)}>
                    <FiX size={15} />
                </button>
            )}
        </div>
    );
}

/** Prescrita → plazo → implementación, con el plazo traducido a días. */
export function Cronologia({ hitos }: {
    hitos: { etiqueta: string; valor: string; tono?: 'alerta' | 'exito' | 'abierto' | 'accent' }[];
}) {
    return (
        <ol className="pr-crono" aria-label="Línea de tiempo">
            {hitos.map((h, i) => (
                <li key={h.etiqueta}>
                    <span className="pr-crono-marca">
                        <span className={`pr-crono-punto${h.tono === 'alerta' ? ' pr-crono-punto--alerta' : h.tono === 'exito' ? ' pr-crono-punto--exito' : h.tono === 'abierto' || h.tono === 'accent' ? ' pr-crono-punto--abierto' : ''}`} />
                        {i < hitos.length - 1 && <span className="pr-crono-linea" />}
                    </span>
                    <span className="pr-crono-texto">
                        <span className="form-label">{h.etiqueta}</span>
                        <span className={`pr-crono-valor${h.tono === 'alerta' ? ' pr-crono-valor--alerta' : h.tono === 'accent' || h.tono === 'abierto' ? ' pr-crono-valor--accent' : ''}`}>{h.valor}</span>
                    </span>
                </li>
            ))}
        </ol>
    );
}
