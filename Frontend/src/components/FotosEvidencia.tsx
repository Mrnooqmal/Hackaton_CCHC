import { useEffect, useState } from 'react';
import { FiUpload, FiX } from 'react-icons/fi';
import { MIME_FOTOS } from '../utils/casos';
import { plural } from '../utils/plural';

/**
 * Lo que se acepta como foto de un caso, dicho como lo ve la persona. Sale de `MIME_FOTOS`
 * (el servidor rechaza todo lo demás). No se promete un tope de tamaño porque las fotos
 * de un caso no tienen uno: el de 10 MB es de otras cargas de archivos, no de esta.
 */
export const AYUDA_FOTOS = 'JPG, PNG, WebP o HEIC';

interface ZonaProps {
    id: string;
    /** Recibe las fotos elegidas (ya filtradas por tipo) y cuántos archivos se descartaron; el aviso lo da quien la usa. */
    onElegir: (archivos: File[], descartados: number) => void;
    disabled?: boolean;
}

/**
 * Zona de carga de fotos: el mismo bloque del formulario de reporte y del detalle del caso.
 * El input va oculto a la vista pero accesible: el `label` lo abre con clic y, con teclado,
 * el input recibe el foco (la zona muestra el aro de foco con `:focus-within`).
 */
export function ZonaCargaFotos({ id, onElegir, disabled = false }: ZonaProps) {
    const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
        const archivos = Array.from(e.target.files ?? []);
        // Se vacía para poder volver a elegir la misma foto después de quitarla.
        e.target.value = '';
        const fotos = archivos.filter((f) => MIME_FOTOS.includes(f.type));
        onElegir(fotos, archivos.length - fotos.length);
    };

    return (
        <div className={`upload-zone inc-upload-zone${disabled ? ' inc-upload-zone--off' : ''}`} style={{ flex: 1 }}>
            <input
                type="file"
                id={id}
                className="inc-file-input"
                multiple
                accept={MIME_FOTOS.join(',')}
                disabled={disabled}
                onChange={alElegir}
            />
            <label htmlFor={id} className="upload-label">
                <FiUpload size={22} className="text-muted mb-1" />
                <p className="font-semibold" style={{ fontSize: 'var(--text-sm)' }}>Seleccionar fotos</p>
                <p className="text-xs text-muted">{AYUDA_FOTOS}</p>
            </label>
        </div>
    );
}

interface MiniaturasProps {
    archivos: File[];
    onQuitar: (indice: number) => void;
    disabled?: boolean;
}

/**
 * Miniaturas de las fotos elegidas, con su botón para quitarlas, y el conteo debajo.
 * Las URL de vista previa se liberan al quitar una foto, al vaciar la lista (al subir) y
 * al desmontar, para no dejar las fotos retenidas en memoria.
 */
export function MiniaturasFotos({ archivos, onQuitar, disabled = false }: MiniaturasProps) {
    // Vistas previas: se crean al cambiar la lista y se liberan al cambiarla de nuevo
    // (al quitar una foto o vaciarla al subir) y al desmontar.
    const [vistas, setVistas] = useState<string[]>([]);
    useEffect(() => {
        const nuevas = archivos.map((f) => URL.createObjectURL(f));
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setVistas(nuevas);
        return () => nuevas.forEach((u) => URL.revokeObjectURL(u));
    }, [archivos]);

    if (archivos.length === 0) return null;

    return (
        <div>
            <div className="inc-evidence-grid">
                {archivos.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}-${index}`} className="inc-evidence-thumb">
                        <img src={vistas.length === archivos.length ? vistas[index] : undefined} alt={file.name} />
                        <button
                            type="button"
                            className="inc-evidence-remove"
                            onClick={() => onQuitar(index)}
                            disabled={disabled}
                            aria-label={`Quitar ${file.name}`}
                        >
                            <FiX size={13} />
                        </button>
                    </div>
                ))}
            </div>
            <p className="text-sm font-semibold inc-evidence-count">
                {plural(archivos.length, 'foto seleccionada', 'fotos seleccionadas')}
            </p>
        </div>
    );
}
