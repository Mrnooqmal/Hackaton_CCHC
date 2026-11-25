import { useState } from 'react';
import { FiUploadCloud } from 'react-icons/fi';
import type { Incident } from '../api/client';
import { useToast } from '../context/ToastContext';
import { MAX_EVIDENCIAS_POR_ENVIO, MAX_EVIDENCIAS_TOTAL } from '../utils/casos';
import { subirYAdjuntarFotos } from '../utils/subirFotos';
import { plural } from '../utils/plural';
import { MiniaturasFotos, ZonaCargaFotos } from './FotosEvidencia';

interface Props {
    incidente: Incident;
    /** Se llama después de adjuntar: lo que sigue en el caso (la foto es un papel de los hallazgos) puede haber cambiado. */
    onCambio?: () => void;
}

/**
 * Agregar fotos a un caso ya creado.
 *
 * La foto es opcional al reportar, pero un hallazgo no se puede cerrar sin al menos una:
 * sin esta pantalla, ese caso quedaba
 * sin salida. Usa las mismas rutas del formulario de reporte (`POST /incidents/upload-evidence`
 * y `POST /incidents/{id}/evidencias`), con sus reglas: lo puede hacer quien reportó el caso
 * o quien gestiona incidentes, y el servidor lo rechaza en un caso cerrado (el padre ni
 * monta esta sección en ese caso).
 *
 * La zona de carga y las miniaturas son las mismas del formulario de reporte
 * (`FotosEvidencia`), para que las dos pantallas no vuelvan a diferir. La cámara es solo
 * del formulario.
 */
export default function AgregarFotosAlCaso({ incidente, onCambio }: Props) {
    const { toast } = useToast();
    const [elegidas, setElegidas] = useState<File[]>([]);
    const [subiendo, setSubiendo] = useState(false);
    const [error, setError] = useState('');

    const yaHay = incidente.evidencias?.length ?? 0;
    const cupo = Math.max(0, MAX_EVIDENCIAS_TOTAL - yaHay);
    const limite = Math.min(cupo, MAX_EVIDENCIAS_POR_ENVIO);

    if (cupo === 0) {
        return <p className="inc-ficha-texto inc-ficha-vacio">El caso ya tiene el máximo de {MAX_EVIDENCIAS_TOTAL} fotos.</p>;
    }

    // Suma a lo ya elegido (se puede seguir agregando) hasta el tope por envío.
    const elegir = (fotos: File[], descartados: number) => {
        let aviso = '';
        if (descartados > 0) aviso = 'Solo se aceptan fotos (JPG, PNG, WebP o HEIC).';
        if (elegidas.length + fotos.length > limite) aviso = `Puedes agregar hasta ${plural(limite, 'foto', 'fotos')} por vez.`;
        setError(aviso);
        setElegidas([...elegidas, ...fotos].slice(0, limite));
    };

    const quitar = (indice: number) => {
        setError('');
        setElegidas((prev) => prev.filter((_, i) => i !== indice));
    };

    const subir = async (e: React.FormEvent) => {
        e.preventDefault();
        if (subiendo || elegidas.length === 0) return;
        setError('');
        setSubiendo(true);
        try {
            const { adjuntas, sinAdjuntar } = await subirYAdjuntarFotos(incidente.incidentId, elegidas);
            if (sinAdjuntar > 0) {
                setError(`${plural(sinAdjuntar, 'foto no se adjuntó', 'fotos no se adjuntaron')}. Vuelve a elegirlas e intenta de nuevo.`);
                toast.warning(adjuntas.length > 0 ? 'Algunas fotos se agregaron al caso' : 'No se pudo agregar las fotos');
            } else {
                toast.success(adjuntas.length === 1 ? 'Foto agregada al caso' : 'Fotos agregadas al caso');
            }
            setElegidas([]);
            if (adjuntas.length > 0) onCambio?.();
        } finally {
            setSubiendo(false);
        }
    };

    return (
        <form className="inc-papeles-form" onSubmit={subir}>
            <div style={{ display: 'flex' }}>
                <ZonaCargaFotos id="caso-fotos" onElegir={elegir} disabled={subiendo} />
            </div>
            <MiniaturasFotos archivos={elegidas} onQuitar={quitar} disabled={subiendo} />
            {error && <div className="alert alert-danger" role="alert"><div>{error}</div></div>}
            {elegidas.length > 0 && (
                <div>
                    <button type="submit" className="btn btn-primary" disabled={subiendo}>
                        <FiUploadCloud size={16} /> {subiendo ? 'Subiendo…' : `Subir ${plural(elegidas.length, 'foto', 'fotos')}`}
                    </button>
                </div>
            )}
        </form>
    );
}
