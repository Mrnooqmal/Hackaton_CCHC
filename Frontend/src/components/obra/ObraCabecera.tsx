import { useRef, useState } from 'react';
import { LuBuilding2, LuDownload, LuImage, LuPencil } from 'react-icons/lu';

export type PestanaObra = 'resumen' | 'ds44';

export interface ObraCabeceraProps {
    nombre: string;
    estado?: string | null;
    estadoLabel: string;
    imagenUrl: string | null;
    pestana: PestanaObra;
    onPestana: (p: PestanaObra) => void;
    onVolver: () => void;
    onEditar: () => void;
    onCambiarFoto: (file: File) => void;
    guardandoFoto?: boolean;
    /** Confirma por un momento que la foto nueva quedó guardada. */
    fotoGuardada?: boolean;
    /** Abre el reporte imprimible del FUF. Sin empresa activa no hay reporte. */
    onExportarFuf?: (() => Promise<{ ok: boolean; error?: string }>) | null;
}

/**
 * Cabecera de la obra: identidad, pestañas y acciones.
 *
 * Solo lleva lo que identifica a la obra (foto, nombre, estado). Mandante,
 * ubicación y dotación viven en el Resumen: repetirlos acá los mostraba dos
 * veces en la misma pantalla.
 */
export default function ObraCabecera({
    nombre, estado, estadoLabel, imagenUrl, pestana, onPestana,
    onVolver, onEditar, onCambiarFoto, guardandoFoto = false, fotoGuardada = false, onExportarFuf,
}: ObraCabeceraProps) {
    const inputFoto = useRef<HTMLInputElement | null>(null);
    const [exportando, setExportando] = useState(false);

    const exportar = async () => {
        if (!onExportarFuf) return;
        setExportando(true);
        const res = await onExportarFuf();
        setExportando(false);
        if (!res.ok) alert(res.error || 'No se pudo generar el reporte del FUF.');
    };

    return (
        <header className="ob-cabecera">
            <div className="ob-cabecera__identidad">
                <div className="ob-cabecera__foto">
                    {imagenUrl
                        ? <img src={imagenUrl} alt={`Foto de ${nombre}`} />
                        : <LuBuilding2 size={28} strokeWidth={1.5} aria-label="Sin foto de la obra" />}
                </div>
                <div className="ob-cabecera__texto">
                    <button type="button" className="ob-cabecera__volver" onClick={onVolver}>Obras</button>
                    <div className="ob-cabecera__titulo-fila">
                        <h1 className="ob-cabecera__titulo">{nombre}</h1>
                        <span className={`ob-estado ob-estado--${estado || 'sin-estado'}`}>{estadoLabel}</span>
                    </div>
                </div>
            </div>

            <div className="ob-cabecera__barra">
                <div className="ob-tabs" role="tablist" aria-label="Secciones de la obra">
                    <button type="button" role="tab" className="ob-tab" aria-selected={pestana === 'resumen'} onClick={() => onPestana('resumen')}>
                        Resumen
                    </button>
                    <button type="button" role="tab" className="ob-tab" aria-selected={pestana === 'ds44'} onClick={() => onPestana('ds44')}>
                        Cumplimiento DS 44
                    </button>
                </div>
                <div className="ob-acciones">
                    {onExportarFuf && (
                        <button type="button" className="ob-btn ob-btn--quieto" disabled={exportando} onClick={exportar}
                            title="Abre el reporte imprimible del FUF en una pestaña nueva">
                            <LuDownload size={15} /> {exportando ? 'Generando…' : 'Exportar FUF'}
                        </button>
                    )}
                    <input
                        ref={inputFoto}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f) onCambiarFoto(f);
                        }}
                    />
                    <button type="button" className="ob-btn ob-btn--quieto" disabled={guardandoFoto} onClick={() => inputFoto.current?.click()}>
                        <LuImage size={15} /> {guardandoFoto ? 'Subiendo…' : fotoGuardada ? 'Foto actualizada' : 'Cambiar foto'}
                    </button>
                    <button type="button" className="ob-btn" onClick={onEditar}>
                        <LuPencil size={15} /> Editar obra
                    </button>
                </div>
            </div>
        </header>
    );
}
