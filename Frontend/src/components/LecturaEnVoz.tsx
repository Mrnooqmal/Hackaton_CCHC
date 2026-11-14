import { useEffect, useRef, useState } from 'react';
import { FiVolume2, FiRefreshCw, FiInfo } from 'react-icons/fi';
import { uploadsApi } from '../api/uploads.api';

/**
 * "Escuchar documento": lee en voz alta el archivo (Backend/lib/lectura).
 *
 * No todos los trabajadores saben leer, y lo que firman tienen que conocerlo.
 * Por eso el botón es grande, dice lo que hace con palabras e ícono, y se
 * pone donde se firma, no solo en el repositorio.
 *
 * La primera vez el audio se prepara en segundo plano (un documento escaneado
 * puede tardar un minuto o más): se pregunta cada 3 segundos hasta que esté.
 * Las siguientes veces sale al tiro, porque el audio queda guardado.
 */

type Estado =
    | { tipo: 'inicial' }
    | { tipo: 'preparando' }
    | { tipo: 'listo'; audioUrl: string }
    | { tipo: 'no_disponible'; motivo: string }
    | { tipo: 'error'; mensaje: string };

const CADA_MS = 3000;
// ~5 minutos: un escaneado largo pasa por OCR antes de la voz.
const MAX_CONSULTAS = 100;

interface LecturaEnVozProps {
    fileKey: string;
    /** Versión angosta, para ir bajo una tarjeta de documento. */
    compacto?: boolean;
}

export default function LecturaEnVoz({ fileKey, compacto = false }: LecturaEnVozProps) {
    const [estado, setEstado] = useState<Estado>({ tipo: 'inicial' });
    const vigente = useRef(true);

    // Al cerrar el visor o cambiar de documento se deja de preguntar.
    useEffect(() => {
        vigente.current = true;
        return () => { vigente.current = false; };
    }, [fileKey]);

    const escuchar = async () => {
        setEstado({ tipo: 'preparando' });
        for (let i = 0; i < MAX_CONSULTAS; i++) {
            const r = await uploadsApi.lectura(fileKey).catch(() => null);
            if (!vigente.current) return;
            if (r?.success && r.data) {
                if (r.data.estado === 'listo') return setEstado({ tipo: 'listo', audioUrl: r.data.audioUrl });
                if (r.data.estado === 'no_disponible') return setEstado({ tipo: 'no_disponible', motivo: r.data.motivo });
            } else if (r && !r.reintentable && !r.sinRed) {
                return setEstado({ tipo: 'error', mensaje: r.error || 'No se pudo preparar la lectura del documento.' });
            }
            await new Promise((ok) => setTimeout(ok, CADA_MS));
            if (!vigente.current) return;
        }
        setEstado({ tipo: 'error', mensaje: 'El audio está tardando demasiado. Inténtalo de nuevo en unos minutos.' });
    };

    const caja: React.CSSProperties = {
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: compacto ? 'var(--space-2) 0 0' : 'var(--space-3)',
        marginBottom: compacto ? 0 : 'var(--space-3)',
        border: compacto ? 'none' : '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-md)',
    };
    const nota: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 };

    return (
        <div style={caja}>
            {estado.tipo === 'listo' ? (
                // La URL vence a los 15 minutos: si falla al volver a darle play,
                // se pide de nuevo (el audio ya está hecho, sale al tiro).
                <audio
                    controls
                    autoPlay
                    src={estado.audioUrl}
                    onError={() => setEstado({ tipo: 'inicial' })}
                    style={{ width: '100%' }}
                    aria-label="Lectura en voz alta del documento"
                />
            ) : (
                <button
                    type="button"
                    className={compacto ? 'btn btn-secondary btn-sm' : 'btn btn-secondary'}
                    onClick={escuchar}
                    disabled={estado.tipo === 'preparando' || estado.tipo === 'no_disponible'}
                    style={{ alignSelf: 'flex-start' }}
                >
                    {estado.tipo === 'preparando'
                        ? <><FiRefreshCw className="spin" /> Preparando audio…</>
                        : <><FiVolume2 /> Escuchar documento</>}
                </button>
            )}
            {estado.tipo === 'preparando' && (
                <p style={nota}>La primera vez puede tardar hasta un minuto. Puedes seguir mirando el documento.</p>
            )}
            {estado.tipo === 'no_disponible' && <p style={nota}><FiInfo /> {estado.motivo}</p>}
            {estado.tipo === 'error' && <p style={{ ...nota, color: 'var(--danger-600)' }}>{estado.mensaje}</p>}
        </div>
    );
}
