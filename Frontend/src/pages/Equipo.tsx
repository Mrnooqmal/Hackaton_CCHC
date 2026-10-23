import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import '../css/equipo.css';

// `foto`: ruta del retrato (por ejemplo '/equipo/adrean.jpg', en public/).
// Mientras no exista se muestra una silueta en su lugar.
const TEAM: { name: string; linkedin: string; foto?: string }[] = [
    { name: 'Adrean David Torres Fonseca', linkedin: '#' },
    { name: 'Benjamín Fernando Sánchez Torres', linkedin: '#' },
    { name: 'Alonso Antonio Cárdenas Paz', linkedin: '#' },
    { name: 'Benjamín Ignacio Pinto Faúndez', linkedin: '#' },
];

// Retraso de entrada de cada bloque, en segundos (ver --eq-d en equipo.css)
const delay = (s: number): CSSProperties => ({ ['--eq-d' as string]: `${s}s` });

export default function Equipo() {
    const pageRef = useRef<HTMLDivElement>(null);

    // Página pública: aplica el tema guardado para verse igual que la app
    useTheme();

    // La página es una capa fija con su propio scroll
    useEffect(() => {
        const el = document.documentElement;
        el.style.overflow = 'hidden';
        return () => { el.style.overflow = ''; };
    }, []);

    // Cada bloque entra una sola vez al aparecer en pantalla
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => entries.forEach((e) => {
                if (e.isIntersecting) {
                    e.target.classList.add('is-in');
                    observer.unobserve(e.target);
                }
            }),
            { threshold: 0.12 }
        );
        pageRef.current?.querySelectorAll('.eq-in, .eq-bg--view').forEach((t) => observer.observe(t));
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={pageRef} className="eq-root">
            {/* ── Portada: la foto del equipo de fondo ── */}
            <section className="eq-hero">
                <div className="eq-bg eq-bg--hero">
                    <img
                        src="/TheCodeCookers2.jpeg"
                        alt="Los cuatro integrantes de The Code Cookers abrazados, con credenciales de la hackathon"
                        width={1024}
                        height={732}
                    />
                </div>
                <div className="eq-scrim" aria-hidden="true" />

                <div className="eq-wrap eq-hero-inner">
                    <header className="eq-top">
                        <Link to="/" className="eq-wordmark" aria-label="Build and Serve — ir a la plataforma">
                            <span className="eq-wordmark-build">Build</span>
                            <span className="eq-wordmark-amp">&amp;</span>
                            <span className="eq-wordmark-serve">Serve</span>
                        </Link>
                        <Link to="/" className="eq-back">Ir a la plataforma</Link>
                    </header>

                    <div className="eq-hero-copy">
                        <h1 className="eq-title">
                            <span className="eq-load" style={delay(0.05)}>The Code</span>
                            <span className="eq-load" style={delay(0.14)}>Cookers</span>
                        </h1>
                        <p className="eq-lead eq-load" style={delay(0.3)}>
                            Primera generación de Ingeniería Civil Informática e Innovación Tecnológica de la
                            Universidad del Desarrollo. Construimos <strong>Build &amp; Serve</strong> — y ganamos.
                        </p>
                    </div>

                    {/* Cuadro de rotulado: los datos del proyecto, como en un plano */}
                    <dl className="eq-rotulo" aria-label="Datos del proyecto">
                        <div className="eq-load" style={delay(0.5)}>
                            <dt className="eq-mono">Proyecto</dt>
                            <dd>Build &amp; Serve</dd>
                        </div>
                        <div className="eq-load" style={delay(0.57)}>
                            <dt className="eq-mono">Evento</dt>
                            <dd>Hackathon Seguridad Sin Papeleo</dd>
                        </div>
                        <div className="eq-load" style={delay(0.64)}>
                            <dt className="eq-mono">Organizan</dt>
                            <dd>CChC y CommunityOS</dd>
                        </div>
                        <div className="eq-load" style={delay(0.71)}>
                            <dt className="eq-mono">Resultado</dt>
                            <dd>1er lugar, 2025</dd>
                        </div>
                        <div className="eq-load" style={delay(0.78)}>
                            <dt className="eq-mono">Casa de estudios</dt>
                            <dd>Universidad del Desarrollo<small>ICIIT, primera generación</small></dd>
                        </div>
                    </dl>
                </div>
            </section>

            {/* ── Quiénes somos: la foto del podio de fondo ── */}
            <section className="eq-story">
                <div className="eq-bg eq-bg--view">
                    <img
                        src="/TheCodeCookers1.jpeg"
                        alt="El equipo recibe el primer lugar de la hackathon junto a representantes de la CChC"
                        width={1600}
                        height={1280}
                        loading="lazy"
                    />
                </div>
                <div className="eq-scrim" aria-hidden="true" />

                <div className="eq-wrap eq-story-inner">
                    <div className="eq-story-copy">
                        <p className="eq-mono eq-kicker eq-in">Quiénes somos</p>
                        <h2 className="eq-h2 eq-in" style={delay(0.06)}>De las aulas al podio</h2>
                        <p className="eq-p eq-in" style={delay(0.12)}>
                            Somos cuatro estudiantes de la primera generación de la carrera de Ingeniería Civil Informática e Innovación Tecnológica de la Universidad del Desarrollo. Una carrera que nació con la convicción de formar ingenieros que no solo programan, sino que innovan y generan impacto real.
                        </p>
                        <p className="eq-p eq-in" style={delay(0.18)}>
                            Cuando supimos de la Hackathon <strong>Seguridad Sin Papeleo</strong>, organizada por la Cámara Chilena de la Construcción junto a CommunityOS, no lo dudamos. Era exactamente el tipo de desafío que buscábamos: un problema real, una industria que lo necesita, y la oportunidad de demostrar lo que somos capaces de hacer.
                        </p>
                    </div>
                    <p className="eq-mono eq-story-caption">Entrega del primer lugar</p>
                </div>
            </section>

            {/* ── La competencia ── */}
            <section className="eq-section eq-section--band">
                <div className="eq-wrap eq-split eq-split--reverse">
                    <div>
                        <p className="eq-mono eq-kicker eq-in">La competencia</p>
                        <h2 className="eq-h2 eq-in" style={delay(0.06)}>Seguridad Sin Papeleo</h2>
                        <p className="eq-p eq-in" style={delay(0.12)}>
                            La hackathon convocó a equipos de todo Chile a resolver uno de los dolores más persistentes de la industria de la construcción: la gestión documental en materia de seguridad. Formularios en papel, firmas presenciales, registros dispersos — un problema con impacto directo en la seguridad de miles de trabajadores.
                        </p>
                        <p className="eq-p eq-in" style={delay(0.18)}>
                            Nuestra respuesta fue <strong>Build &amp; Serve</strong>: una plataforma que digitaliza y centraliza la gestión de documentos, firmas electrónicas y cumplimiento normativo en obras de construcción. El jurado nos eligió como ganadores.
                        </p>
                    </div>

                    <dl className="eq-facts">
                        <div className="eq-in">
                            <dt className="eq-mono">Problema resuelto</dt>
                            <dd>Digitalización de la gestión de seguridad en obras de construcción</dd>
                        </div>
                        <div className="eq-in" style={delay(0.08)}>
                            <dt className="eq-mono">Nuestra solución</dt>
                            <dd>Plataforma web con firmas electrónicas, gestión documental y cumplimiento DS44</dd>
                        </div>
                        <div className="eq-in" style={delay(0.16)}>
                            <dt className="eq-mono">Resultado</dt>
                            <dd>Ganadores y seleccionados para continuar el desarrollo junto a la CChC</dd>
                        </div>
                    </dl>
                </div>
            </section>

            {/* ── El equipo ── */}
            <section className="eq-section">
                <div className="eq-wrap">
                    <p className="eq-mono eq-kicker eq-in">El equipo</p>
                    <h2 className="eq-h2 eq-in" style={{ ...delay(0.06), maxWidth: 720 }}>
                        Las personas detrás de <span style={{ whiteSpace: 'nowrap' }}>Build &amp; Serve</span>
                    </h2>

                    <ul className="eq-team">
                        {TEAM.map((member, i) => (
                            <li key={member.name} className="eq-member eq-in" style={delay(i * 0.08)}>
                                <div className="eq-member-photo">
                                    {member.foto ? (
                                        <img src={member.foto} alt={`Retrato de ${member.name}`} loading="lazy" />
                                    ) : (
                                        <svg className="eq-member-silhouette" viewBox="0 0 100 100" aria-hidden="true">
                                            <circle cx="50" cy="38" r="17" />
                                            <path d="M10 100c0-24 18-40 40-40s40 16 40 40z" />
                                        </svg>
                                    )}
                                </div>
                                <div className="eq-member-meta">
                                    <h3 className="eq-member-name">{member.name}</h3>
                                    <span className="eq-mono">ICIIT · UDD</span>
                                    <a
                                        href={member.linkedin}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="eq-member-link"
                                        aria-label={`LinkedIn de ${member.name}`}
                                    >
                                        LinkedIn <span aria-hidden="true">↗</span>
                                    </a>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            </section>

            {/* ── Agradecimientos ── */}
            <section className="eq-section eq-section--band">
                <div className="eq-wrap eq-split eq-split--reverse">
                    <div>
                        <p className="eq-mono eq-kicker eq-in">Agradecimientos</p>
                        <blockquote className="eq-quote eq-in" style={delay(0.06)}>
                            “Gracias, CChC, por abrir la puerta y quedarse a construir juntos.”
                        </blockquote>
                    </div>

                    <div>
                        <p className="eq-p eq-in">
                            Ganar la hackathon fue el punto de partida, pero lo que vino después superó todas nuestras expectativas. La Cámara Chilena de la Construcción no solo reconoció nuestro trabajo — eligió confiar en nosotros y darnos la oportunidad de continuar desarrollando Build &amp; Serve en conjunto.
                        </p>
                        <p className="eq-p eq-in" style={delay(0.06)}>
                            Agradecemos profundamente todas las facilidades brindadas: el acceso a expertos de la industria, el entendimiento del dominio real de la construcción, y el compromiso genuino con una solución que impacta la seguridad de trabajadores en Chile. Este proyecto existe gracias a esa confianza.
                        </p>

                        <dl className="eq-orgs eq-in" style={delay(0.12)}>
                            <div>
                                <dt className="eq-mono">Organiza</dt>
                                <dd>Cámara Chilena de la Construcción</dd>
                            </div>
                            <div>
                                <dt className="eq-mono">Organiza</dt>
                                <dd>CommunityOS</dd>
                            </div>
                            <div>
                                <dt className="eq-mono">Casa de estudios</dt>
                                <dd>Universidad del Desarrollo</dd>
                            </div>
                        </dl>
                    </div>
                </div>
            </section>

            <footer className="eq-wrap eq-foot">
                The Code Cookers · Build &amp; Serve · Universidad del Desarrollo · 2025
            </footer>
        </div>
    );
}
