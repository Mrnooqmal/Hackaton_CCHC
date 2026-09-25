import { useState } from 'react';
import { LuCheck, LuCog, LuCopy, LuFactory, LuFileText, LuFlaskConical, LuMapPin, LuShieldAlert, LuUsers } from 'react-icons/lu';
import { UMBRAL_CPHS, UMBRAL_DELEGADO_MIN } from '../../utils/estructuraPreventiva';

type CampoCondicion = 'faenaCompartida' | 'tieneMaquinaria' | 'agentesFQB';

export interface ObraResumenProps {
    /** Código que puso quien creó la obra; sin código se muestra el ID interno. */
    codigo: string;
    esIdInterno: boolean;
    mandante?: string | null;
    registradaEn?: string | null;
    direccion?: string | null;
    comuna?: string | null;
    region?: string | null;
    personasAsignadas: number;
    dotacionDeclarada?: number | null;
    dotacionObservacion?: string | null;
    faenaCompartida?: boolean | null;
    tieneMaquinaria?: boolean | null;
    agentesFQB?: boolean | null;
    onDeclarar: (campo: CampoCondicion, valor: boolean) => Promise<void> | void;
    incidentesAbiertos: number;
    /** Personas de la obra, por cuadrillas (fija la obra activa antes de ir). */
    onVerEquipo: () => void;
    onVerIncidentes: () => void;
    /** Repositorio de documentos de esta obra. */
    onVerDocumentos: () => void;
}

const fechaCorta = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/**
 * Tramos de dotación que el DS 44 mira en el ÁMBITO OBRA.
 *
 * El Departamento de Prevención (más de 100) es solo de la entidad empleadora
 * (`estructuraPreventiva.ts`), así que acá no se dibuja: ponerlo haría creer que
 * una faena grande tiene que constituir uno propio.
 */
const TRAMOS = [
    { desde: 1, hasta: UMBRAL_DELEGADO_MIN - 1, rango: `1–${UMBRAL_DELEGADO_MIN - 1}`, organo: 'Sin órgano obligatorio' },
    { desde: UMBRAL_DELEGADO_MIN, hasta: UMBRAL_CPHS, rango: `${UMBRAL_DELEGADO_MIN}–${UMBRAL_CPHS}`, organo: 'Delegado de SST' },
    // El tope es solo para dibujar el marcador; el tramo sigue abierto.
    { desde: UMBRAL_CPHS + 1, hasta: 100, rango: `Más de ${UMBRAL_CPHS}`, organo: 'Comité Paritario' },
];

function posicionEnTramo(n: number) {
    const i = TRAMOS.findIndex((t) => n <= t.hasta) === -1 ? TRAMOS.length - 1 : TRAMOS.findIndex((t) => n <= t.hasta);
    const t = TRAMOS[i];
    const pct = Math.min(Math.max((Math.min(n, t.hasta) - t.desde) / Math.max(t.hasta - t.desde, 1), 0), 1) * 100;
    return { indice: i, pct };
}

const CONDICIONES: Array<{ campo: CampoCondicion; titulo: string; icono: React.ReactNode }> = [
    { campo: 'faenaCompartida', titulo: 'Faena compartida con otras empresas', icono: <LuFactory size={20} strokeWidth={1.8} /> },
    { campo: 'tieneMaquinaria', titulo: 'Máquinas o equipos motrices', icono: <LuCog size={20} strokeWidth={1.8} /> },
    { campo: 'agentesFQB', titulo: 'Agentes físicos, químicos o biológicos', icono: <LuFlaskConical size={20} strokeWidth={1.8} /> },
];

export default function ObraResumen(props: ObraResumenProps) {
    const {
        codigo, esIdInterno, mandante, registradaEn, direccion, comuna, region,
        personasAsignadas, dotacionDeclarada, dotacionObservacion, onDeclarar,
        incidentesAbiertos, onVerEquipo, onVerIncidentes, onVerDocumentos,
    } = props;
    const [copiado, setCopiado] = useState(false);
    const [guardando, setGuardando] = useState<CampoCondicion | null>(null);

    const declarada = typeof dotacionDeclarada === 'number' && dotacionDeclarada > 0 ? dotacionDeclarada : null;
    const dotacion = declarada ?? personasAsignadas;
    const tramo = posicionEnTramo(Math.max(dotacion, 1));
    const zona = [comuna, region].filter(Boolean).join(' · ');
    const urlMapa = direccion
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([direccion, comuna, region].filter(Boolean).join(', '))}`
        : null;

    const copiar = () => {
        navigator.clipboard.writeText(codigo);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1500);
    };

    const declarar = async (campo: CampoCondicion, valor: boolean) => {
        setGuardando(campo);
        try { await onDeclarar(campo, valor); } finally { setGuardando(null); }
    };

    return (
        <div className="ob-resumen">
            {/* Identificación como el letrero de la entrada de la faena. */}
            <section className="ob-letrero ob-span-5" aria-label="Identificación">
                <div className="ob-letrero__franja" />
                <div className="ob-letrero__cuerpo">
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                            <span className="ob-letrero__rotulo">{esIdInterno ? 'ID interno de la obra' : 'Código de obra'}</span>
                            <span className="ob-letrero__codigo">{codigo}</span>
                        </div>
                        <button type="button" className="ob-letrero__copiar" onClick={copiar} aria-label="Copiar código de la obra">
                            {copiado ? <LuCheck size={14} /> : <LuCopy size={14} />} {copiado ? 'Copiado' : 'Copiar'}
                        </button>
                    </div>
                    <div className="ob-letrero__pie">
                        <div className="ob-letrero__dato">
                            <span className="ob-letrero__rotulo">Mandante</span>
                            <span className="ob-letrero__valor">{mandante || '—'}</span>
                        </div>
                        <div className="ob-letrero__dato">
                            <span className="ob-letrero__rotulo">Registrada</span>
                            <span className="ob-letrero__valor">{fechaCorta(registradaEn)}</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* Ubicación sobre un plano esquemático: no es un mapa real, y lo dice. */}
            <section className="ob-plano ob-span-7" aria-label="Ubicación">
                <svg viewBox="0 0 680 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                    <g className="ob-plano__manzana">
                        <rect x="20" y="18" width="150" height="70" rx="6" /><rect x="200" y="18" width="120" height="70" rx="6" />
                        <rect x="350" y="18" width="170" height="70" rx="6" /><rect x="550" y="18" width="120" height="70" rx="6" />
                        <rect x="20" y="118" width="150" height="120" rx="6" /><rect x="200" y="118" width="120" height="50" rx="6" />
                        <rect x="200" y="188" width="120" height="50" rx="6" /><rect x="550" y="118" width="120" height="120" rx="6" />
                    </g>
                    <rect className="ob-plano__obra" x="350" y="118" width="170" height="120" rx="6" strokeWidth="2" strokeDasharray="6 5" />
                    <g className="ob-plano__calle" strokeWidth="14" strokeLinecap="round">
                        <path d="M0 103H680" /><path d="M185 0V260" /><path d="M335 0V260" /><path d="M535 0V260" />
                    </g>
                    <circle className="ob-plano__pin" cx="435" cy="170" r="26" opacity="0.14" />
                    <path className="ob-plano__pin" d="M435 186c-10-12-16-21-16-29a16 16 0 0 1 32 0c0 8-6 17-16 29Z" />
                    <circle cx="435" cy="157" r="6" fill="#ffffff" />
                </svg>
                <span className="ob-plano__marca">Plano referencial</span>
                <div className="ob-plano__ficha">
                    <span className="ob-rotulo">Ubicación</span>
                    <span className="ob-plano__direccion">{direccion || 'Sin dirección registrada'}</span>
                    {zona && <span className="ob-plano__zona">{zona}</span>}
                    {urlMapa && (
                        <a href={urlMapa} target="_blank" rel="noreferrer"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', fontWeight: 500, textDecoration: 'none' }}>
                            <LuMapPin size={14} /> Abrir en el mapa
                        </a>
                    )}
                </div>
            </section>

            {/* Dotación: la cifra junto con lo que implica en el DS 44. */}
            <section className="ob-panel ob-span-7" aria-label="Dotación">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="ob-rotulo">Dotación</span>
                    <span className="ob-dotacion__cifra">
                        <span className="ob-dotacion__n">{dotacion}</span>
                        <span className="ob-dotacion__unidad">{declarada ? 'personas declaradas' : 'personas asignadas'}</span>
                    </span>
                </div>
                <div className="ob-tramos">
                    <div className="ob-tramos__barra" aria-hidden="true">
                        {TRAMOS.map((t, i) => (
                            <span key={t.rango} className={`ob-tramos__seg${i === tramo.indice ? ' ob-tramos__seg--actual' : ''}`}>
                                {i === tramo.indice && <span className="ob-tramos__marca" style={{ left: `${tramo.pct}%` }} />}
                            </span>
                        ))}
                    </div>
                    <div className="ob-tramos__rotulos">
                        {TRAMOS.map((t, i) => (
                            <span key={t.rango} className={`ob-tramos__rotulo${i === tramo.indice ? ' ob-tramos__rotulo--actual' : ''}`}>
                                <strong>{t.rango}{i === tramo.indice ? ' · esta obra' : ''}</strong>{t.organo}
                            </span>
                        ))}
                    </div>
                </div>
                <div className="ob-nota">
                    {declarada ? (
                        <><strong>Dotación declarada:</strong> {declarada} personas{dotacionObservacion ? `. ${dotacionObservacion}` : ''}. Hay {personasAsignadas} asignadas en la plataforma.</>
                    ) : (
                        <><strong>Dotación declarada:</strong> no declarada. Se usa la de personas asignadas.</>
                    )}
                </div>
                <div className="ob-accesos">
                    <button type="button" className="ob-btn" onClick={onVerEquipo}>
                        <LuUsers size={15} /> Equipo · {personasAsignadas} activos
                    </button>
                    <button type="button" className="ob-btn" onClick={onVerIncidentes}>
                        <LuShieldAlert size={15} /> Incidentes{incidentesAbiertos > 0 ? ` · ${incidentesAbiertos} abiertos` : ''}
                    </button>
                    <button type="button" className="ob-btn" onClick={onVerDocumentos}>
                        <LuFileText size={15} /> Documentos de la obra
                    </button>
                </div>
            </section>

            {/* Condiciones de la faena: deciden qué requisitos del DS 44 aplican. */}
            <section className="ob-panel ob-span-5" aria-label="Condiciones de la faena" style={{ gap: 6 }}>
                <span className="ob-rotulo">Condiciones de la faena</span>
                <p style={{ margin: '0 0 8px', fontSize: '0.8125rem', lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                    Definen qué requisitos del DS 44 aplican a esta obra.
                </p>
                {CONDICIONES.map((c) => {
                    const v = props[c.campo];
                    const pendiente = v === undefined || v === null;
                    return (
                        <div key={c.campo} className="ob-condicion">
                            <span className="ob-condicion__icono">{c.icono}</span>
                            <span className="ob-condicion__texto">
                                <span className="ob-condicion__titulo">{c.titulo}</span>
                                <span className={`ob-condicion__estado${pendiente ? ' ob-condicion__estado--pendiente' : ''}`}>
                                    {pendiente ? 'Pendiente de declarar' : v ? 'Declarado: sí' : 'Declarado: no'}
                                </span>
                            </span>
                            <span className="ob-interruptor" role="group" aria-label={c.titulo}>
                                <button type="button" aria-pressed={v === true} disabled={guardando !== null} onClick={() => declarar(c.campo, true)}>Sí</button>
                                <button type="button" aria-pressed={v === false} disabled={guardando !== null} onClick={() => declarar(c.campo, false)}>No</button>
                            </span>
                        </div>
                    );
                })}
            </section>
        </div>
    );
}
