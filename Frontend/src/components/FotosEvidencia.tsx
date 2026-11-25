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

interface ZonaCargaProps {
    id: string;
    /** Recibe los archivos que la persona eligió, tal cual: filtrar por tipo es cosa de quien la usa. */
    onElegir: (archivos: File[]) => void;
    /** Tipos MIME que ofrece el selector del sistema (no reemplaza validar lo elegido). */
    accept: string[];
    /** Título de la zona, por ejemplo "Seleccionar fotos". */
    titulo: string;
    /** Lo que se acepta, dicho como lo ve la persona. */
    ayuda: string;
    multiple?: boolean;
    disabled?: boolean;
    /** Texto del título si ya hay un archivo elegido (para cambiarlo); por defecto, el mismo `titulo`. */
    tituloCambiar?: string;
}

/**
 * Zona de carga de archivos: el bloque común del formulario de reporte, de las fotos del
 * caso y de los papeles del caso.
 * El input va oculto a la vista pero accesible: el `label` lo abre con clic y, con teclado,
 * el input recibe el foco (la zona muestra el aro de foco con `:focus-within`).
 */
export function ZonaCarga({ id, onElegir, accept, titulo, ayuda, multiple = false, disabled = false, tituloCambiar }: ZonaCargaProps) {
    const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
        const archivos = Array.from(e.target.files ?? []);
        // Se vacía para poder volver a elegir el mismo archivo después de quitarlo.
        e.target.value = '';
        onElegir(archivos);
    };

    return (
        <div className={`upload-zone inc-upload-zone${disabled ? ' inc-upload-zone--off' : ''}`} style={{ flex: 1 }}>
            <input
                type="file"
                id={id}
                className="inc-file-input"
                multiple={multiple}
                accept={accept.join(',')}
                disabled={disabled}
                onChange={alElegir}
            />
            <label htmlFor={id} className="upload-label">
                <FiUpload size={22} className="text-muted mb-1" />
                <p className="font-semibold" style={{ fontSize: 'var(--text-sm)' }}>{tituloCambiar ?? titulo}</p>
                <p className="text-xs text-muted">{ayuda}</p>
            </label>
        </div>
    );
}

interface ZonaProps {
    id: string;
    /** Recibe las fotos elegidas (ya filtradas por tipo) y cuántos archivos se descartaron; el aviso lo da quien la usa. */
    onElegir: (archivos: File[], descartados: number) => void;
    disabled?: boolean;
}

/** Zona de carga de fotos: el mismo bloque del formulario de reporte y del detalle del caso. */
export function ZonaCargaFotos({ id, onElegir, disabled = false }: ZonaProps) {
    const alElegir = (archivos: File[]) => {
        const fotos = archivos.filter((f) => MIME_FOTOS.includes(f.type));
        onElegir(fotos, archivos.length - fotos.length);
    };

    return (
        <ZonaCarga
            id={id}
            onElegir={alElegir}
            accept={MIME_FOTOS}
            titulo="Seleccionar fotos"
            ayuda={AYUDA_FOTOS}
            multiple
            disabled={disabled}
        />
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
