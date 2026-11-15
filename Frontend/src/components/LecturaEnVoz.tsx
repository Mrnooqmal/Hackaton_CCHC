import { useEffect, useRef, useState } from 'react';
import { FiPlay, FiPause, FiLoader, FiRefreshCw, FiX } from 'react-icons/fi';
import { uploadsApi } from '../api/uploads.api';
import { useLecturaActiva } from './lecturaActiva';

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
 *
 * El reproductor es propio y no el <audio controls> del navegador: aquel se
 * veía distinto en cada navegador y desentonaba con el sistema. Tiene la misma
 * forma en todos los estados (antes de pedirlo, preparando, sonando), así que
 * la pantalla no salta al pasar de uno a otro. La lectura de un documento
 * puede durar una hora: por eso trae saltos de 15 s, velocidad y una barra
 * que se puede arrastrar.
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

const VELOCIDADES = [1, 1.25, 1.5, 2, 0.75];
const velocidadTexto = (v: number) => `${String(v).replace('.', ',')}×`;

// Onda decorativa (no es la amplitud real): marca el avance de la lectura.
// La cantidad de barras sigue al ancho disponible (una cada ~5 px): con un
// número fijo, en el visor ancho cada barra se estiraba hasta verse en bloques.
const PASO_BARRA_PX = 5;
const altura = (i: number) => {
    const v = Math.abs(Math.sin(i * 0.61) * 0.55 + Math.sin(i * 1.73 + 1.2) * 0.3 + Math.sin(i * 0.17 + 0.4) * 0.35);
    return Math.round(22 + Math.min(1, v) * 78);
};

const reloj = (seg: number) => {
    const s = Math.max(0, Math.floor(seg || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const x = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};

/** Flecha circular con "15" adentro. */
function IconoSalto({ adelante }: { adelante?: boolean }) {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {adelante ? (
                <>
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </>
            ) : (
                <>
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </>
            )}
            <text x={adelante ? 11 : 13} y="15.4" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">15</text>
        </svg>
    );
}

interface LecturaEnVozProps {
    fileKey: string;
    /** Versión para ir dentro de una tarjeta de documento (sin margen propio). */
    compacto?: boolean;
    /**
     * `barra`: una sola fila, para el pie del visor de documentos. Aparece al
     * tocar "Escuchar" y se cierra con su X (`onCerrar`).
     */
    variante?: 'tarjeta' | 'barra';
    /** Pide el audio al montarse (el gesto fue el botón que lo abrió). */
    autoIniciar?: boolean;
    onCerrar?: () => void;
}

export default function LecturaEnVoz({ fileKey, compacto = false, variante = 'tarjeta', autoIniciar = false, onCerrar }: LecturaEnVozProps) {
    const [estado, setEstado] = useState<Estado>({ tipo: 'inicial' });
    const [sonando, setSonando] = useState(false);
    const [pos, setPos] = useState(0);
    const [dur, setDur] = useState(0);
    const [vel, setVel] = useState(0);
    const vigente = useRef(true);
    const audioRef = useRef<HTMLAudioElement>(null);
    const ondaRef = useRef<HTMLDivElement>(null);
    const [barras, setBarras] = useState(40);
    const iniciado = useRef(false);
    const activa = useLecturaActiva();

    useEffect(() => {
        const el = ondaRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([e]) => {
            const n = Math.round(e.contentRect.width / PASO_BARRA_PX);
            if (n > 0) setBarras(Math.min(160, Math.max(12, n)));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Al cerrar el visor o cambiar de documento se deja de preguntar.
    useEffect(() => {
        vigente.current = true;
        return () => { vigente.current = false; };
    }, [fileKey]);

    // Al desmontarse, el modal deja de mostrarlo como lectura en curso.
    useEffect(() => {
        const audio = audioRef.current;
        return () => { if (audio && activa) activa.soltar(audio); };
    }, [activa, estado.tipo]);

    useEffect(() => {
        if (audioRef.current) audioRef.current.playbackRate = VELOCIDADES[vel];
    }, [vel, estado.tipo]);

    const escuchar = async () => {
        activa?.alRevisar();
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

    // Montada por un botón "Escuchar": parte sola (una vez, aun en StrictMode).
    useEffect(() => {
        if (autoIniciar && !iniciado.current) { iniciado.current = true; void escuchar(); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoIniciar]);

    const listo = estado.tipo === 'listo';
    const preparando = estado.tipo === 'preparando';

    const playPausa = () => {
        if (estado.tipo === 'inicial' || estado.tipo === 'error') { void escuchar(); return; }
        const audio = audioRef.current;
        if (!listo || !audio) return;
        // Si el navegador bloquea el play (sin gesto), queda en pausa y se reintenta con el botón.
        if (audio.paused) audio.play().catch(() => setSonando(false));
        else audio.pause();
    };

    const saltar = (seg: number) => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.currentTime = Math.min(Math.max(0, audio.currentTime + seg), dur || audio.duration || 0);
        setPos(audio.currentTime);
    };

    const titulo = {
        inicial: 'Escuchar documento',
        preparando: 'Preparando audio…',
        listo: 'Lectura en voz alta',
        no_disponible: 'Lectura no disponible',
        error: 'No se pudo preparar el audio',
    }[estado.tipo];

    const detalle =
        estado.tipo === 'inicial' ? 'Te lo leemos en voz alta, de principio a fin'
            : estado.tipo === 'preparando' ? 'La primera vez puede tardar hasta un minuto'
                : estado.tipo === 'listo' ? `${reloj(pos)} / ${dur ? reloj(dur) : '–:––'}`
                    : estado.tipo === 'no_disponible' ? estado.motivo
                        : estado.mensaje;

    const avance = dur ? pos / dur : 0;

    return (
        <div
            className={`lectura${compacto ? ' lectura--compacta' : ''}${variante === 'barra' ? ' lectura--barra' : ''}`}
            data-estado={estado.tipo}
            role="group"
            aria-label="Lectura en voz alta del documento"
        >
            <div className="lectura-fila">
                <button
                    type="button"
                    className="lectura-play"
                    onClick={playPausa}
                    disabled={preparando || estado.tipo === 'no_disponible'}
                    aria-label={sonando ? 'Pausar lectura' : estado.tipo === 'error' ? 'Reintentar lectura' : 'Escuchar documento'}
                >
                    {preparando ? <FiLoader className="lectura-girando" size={20} />
                        : sonando ? <FiPause size={19} fill="currentColor" />
                            : estado.tipo === 'error' ? <FiRefreshCw size={18} />
                                : <FiPlay size={19} fill="currentColor" style={{ marginLeft: 2 }} />}
                </button>
                <div className="lectura-texto">
                    <span className="lectura-titulo">{titulo}</span>
                    <span
                        className={`lectura-detalle${listo ? ' lectura-detalle--tiempo' : ''}`}
                        role={estado.tipo === 'error' ? 'alert' : undefined}
                    >
                        {detalle}
                    </span>
                </div>
                <button
                    type="button"
                    className="lectura-vel"
                    onClick={() => setVel((v) => (v + 1) % VELOCIDADES.length)}
                    disabled={!listo}
                    aria-label={`Velocidad de lectura: ${velocidadTexto(VELOCIDADES[vel])}`}
                >
                    {velocidadTexto(VELOCIDADES[vel])}
                </button>
                {onCerrar && (
                    <button type="button" className="lectura-cerrar" onClick={onCerrar} aria-label="Cerrar la lectura en voz alta">
                        <FiX size={18} />
                    </button>
                )}
            </div>

            <div className="lectura-onda-fila">
                <button type="button" className="lectura-salto" onClick={() => saltar(-15)} disabled={!listo} aria-label="Retroceder 15 segundos">
                    <IconoSalto />
                </button>
                <div className="lectura-onda" ref={ondaRef}>
                    {Array.from({ length: barras }, (_, i) => (
                        <span key={i} style={{ height: `${altura(i)}%` }} className={listo && i / barras < avance ? 'is-oida' : undefined} />
                    ))}
                    <input
                        type="range"
                        min={0}
                        max={Math.max(1, Math.floor(dur))}
                        step={1}
                        value={Math.floor(pos)}
                        disabled={!listo || !dur}
                        onChange={(e) => {
                            const v = Number(e.target.value);
                            if (audioRef.current) audioRef.current.currentTime = v;
                            setPos(v);
                        }}
                        aria-label="Posición en la lectura"
                        aria-valuetext={`${reloj(pos)} de ${reloj(dur)}`}
                    />
                </div>
                <button type="button" className="lectura-salto" onClick={() => saltar(15)} disabled={!listo} aria-label="Adelantar 15 segundos">
                    <IconoSalto adelante />
                </button>
            </div>

            {estado.tipo === 'listo' && (
                // La URL vence a los 15 minutos: si falla al volver a darle play,
                // se pide de nuevo (el audio ya está hecho, sale al tiro).
                <audio
                    ref={audioRef}
                    src={estado.audioUrl}
                    autoPlay
                    preload="auto"
                    onPlay={(e) => { setSonando(true); activa?.registrar(e.currentTarget); }}
                    onPause={() => setSonando(false)}
                    onEnded={() => setSonando(false)}
                    onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
                    onLoadedMetadata={(e) => {
                        e.currentTarget.playbackRate = VELOCIDADES[vel];
                        setDur(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0);
                    }}
                    onError={() => { setSonando(false); setEstado({ tipo: 'inicial' }); }}
                />
            )}
        </div>
    );
}
