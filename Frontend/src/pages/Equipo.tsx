import { useEffect, useRef } from 'react';

const TEAM = [
    { name: 'Alonso Cárdenas', initials: 'AC', linkedin: '#' },
    { name: 'Adrean Torres',   initials: 'AT', linkedin: '#' },
    { name: 'Benjamín Sánchez',initials: 'BS', linkedin: '#' },
    { name: 'Benjamín Pinto',  initials: 'BP', linkedin: '#' },
];

const TINTS = [
    { bg: 'rgba(0,110,220,0.18)',  fg: '#60a5fa', ring: 'rgba(96,165,250,0.35)' },
    { bg: 'rgba(6,182,212,0.18)',  fg: '#22d3ee', ring: 'rgba(34,211,238,0.35)' },
    { bg: 'rgba(245,158,11,0.18)', fg: '#fbbf24', ring: 'rgba(251,191,36,0.35)' },
    { bg: 'rgba(139,92,246,0.18)', fg: '#a78bfa', ring: 'rgba(167,139,250,0.35)' },
];

export default function Equipo() {
    const pageRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = document.documentElement;
        el.style.overflow = 'hidden';
        return () => { el.style.overflow = ''; };
    }, []);

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => entries.forEach(e => {
                if (e.isIntersecting) e.target.classList.add('eq-visible');
            }),
            { threshold: 0.12 }
        );
        const targets = pageRef.current?.querySelectorAll('[class*="eq-reveal"]') ?? [];
        targets.forEach(t => observer.observe(t));
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={pageRef} className="eq-root">
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Roboto:wght@300;400;500&display=swap');

                .eq-root {
                    position: fixed;
                    inset: 0;
                    overflow-y: auto;
                    overflow-x: hidden;
                    background: #05091a;
                    color: #e8edf8;
                    font-family: 'Roboto', sans-serif;
                    scroll-behavior: smooth;
                    z-index: 1000;
                }

                /* ── Reveal animation ── */
                .eq-reveal {
                    opacity: 0;
                    transform: translateY(36px);
                    transition: opacity 0.75s cubic-bezier(0.16,1,0.3,1),
                                transform 0.75s cubic-bezier(0.16,1,0.3,1);
                }
                .eq-reveal.eq-visible { opacity: 1; transform: translateY(0); }
                .eq-reveal-left  { opacity: 0; transform: translateX(-48px); transition: opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1); }
                .eq-reveal-left.eq-visible  { opacity: 1; transform: translateX(0); }
                .eq-reveal-right { opacity: 0; transform: translateX(48px);  transition: opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1); }
                .eq-reveal-right.eq-visible { opacity: 1; transform: translateX(0); }
                .eq-reveal-scale { opacity: 0; transform: scale(0.9); transition: opacity 0.7s ease, transform 0.7s cubic-bezier(0.16,1,0.3,1); }
                .eq-reveal-scale.eq-visible { opacity: 1; transform: scale(1); }
                .eq-d1 { transition-delay: 0.08s !important; }
                .eq-d2 { transition-delay: 0.18s !important; }
                .eq-d3 { transition-delay: 0.28s !important; }
                .eq-d4 { transition-delay: 0.38s !important; }

                /* ── HERO ── */
                .eq-hero {
                    min-height: 100vh;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    position: relative;
                    overflow: hidden;
                }

                .eq-hero-bg-text {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: 'Lora', serif;
                    font-size: clamp(80px, 18vw, 260px);
                    font-weight: 700;
                    color: rgba(0,110,220,0.04);
                    letter-spacing: -0.02em;
                    user-select: none;
                    pointer-events: none;
                    white-space: nowrap;
                    overflow: hidden;
                }

                .eq-hero-left {
                    padding: clamp(60px, 8vw, 120px) clamp(32px, 6vw, 80px);
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    position: relative;
                    z-index: 1;
                }

                .eq-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    border: 1px solid rgba(223,54,1,0.5);
                    background: rgba(223,54,1,0.1);
                    color: #ff7a50;
                    padding: 6px 16px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 500;
                    letter-spacing: 0.1em;
                    text-transform: uppercase;
                    margin-bottom: 28px;
                    width: fit-content;
                }

                .eq-badge-dot {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: #df3601;
                    animation: eq-pulse 2s infinite;
                }

                @keyframes eq-pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.5; transform: scale(1.3); }
                }

                .eq-hero-title {
                    font-family: 'Lora', serif;
                    font-size: clamp(36px, 5.5vw, 78px);
                    font-weight: 700;
                    line-height: 1.0;
                    letter-spacing: -0.03em;
                    color: #ffffff;
                    margin-bottom: 8px;
                }

                .eq-hero-title em {
                    font-style: italic;
                    color: #4d9fff;
                }

                .eq-hero-subtitle {
                    font-size: clamp(14px, 1.4vw, 18px);
                    color: rgba(232,237,248,0.55);
                    line-height: 1.65;
                    max-width: 460px;
                    margin-top: 20px;
                    font-weight: 300;
                }

                .eq-hero-divider {
                    width: 56px;
                    height: 3px;
                    background: linear-gradient(90deg, #df3601, #ff7a50);
                    margin: 28px 0;
                    border-radius: 2px;
                }

                .eq-hero-meta {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    margin-top: 8px;
                }

                .eq-hero-meta-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 13px;
                    color: rgba(232,237,248,0.45);
                    letter-spacing: 0.03em;
                }

                .eq-hero-meta-item::before {
                    content: '';
                    width: 18px;
                    height: 1px;
                    background: #4d9fff;
                    flex-shrink: 0;
                }

                .eq-hero-right {
                    position: relative;
                    overflow: hidden;
                }

                .eq-hero-img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    display: block;
                    filter: saturate(0.85) brightness(0.75);
                    transition: transform 8s ease;
                }

                .eq-hero-right:hover .eq-hero-img {
                    transform: scale(1.04);
                }

                .eq-hero-img-overlay {
                    position: absolute;
                    inset: 0;
                    background: linear-gradient(
                        to right,
                        #05091a 0%,
                        rgba(5,9,26,0.3) 40%,
                        rgba(0,41,82,0.2) 100%
                    );
                }

                .eq-hero-img-corner {
                    position: absolute;
                    bottom: 28px;
                    left: 28px;
                    background: rgba(5,9,26,0.85);
                    border: 1px solid rgba(255,255,255,0.1);
                    backdrop-filter: blur(12px);
                    padding: 12px 20px;
                    border-radius: 10px;
                    font-size: 12px;
                    color: rgba(232,237,248,0.7);
                    font-style: italic;
                    font-family: 'Lora', serif;
                }

                /* ── SECTION COMMON ── */
                .eq-section {
                    padding: clamp(64px, 8vw, 120px) clamp(32px, 8vw, 120px);
                    position: relative;
                }

                .eq-section--alt {
                    background: #080e20;
                }

                .eq-chapter-num {
                    font-family: 'Lora', serif;
                    font-size: clamp(80px, 12vw, 180px);
                    font-weight: 700;
                    color: rgba(0,110,220,0.07);
                    line-height: 1;
                    letter-spacing: -0.05em;
                    position: absolute;
                    top: 40px;
                    right: clamp(32px, 6vw, 80px);
                    user-select: none;
                    pointer-events: none;
                }

                .eq-label {
                    font-size: 11px;
                    font-weight: 500;
                    letter-spacing: 0.18em;
                    text-transform: uppercase;
                    color: #4d9fff;
                    margin-bottom: 16px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .eq-label::before {
                    content: '';
                    display: block;
                    width: 24px;
                    height: 1px;
                    background: #4d9fff;
                }

                .eq-heading {
                    font-family: 'Lora', serif;
                    font-size: clamp(28px, 4vw, 54px);
                    font-weight: 700;
                    line-height: 1.12;
                    letter-spacing: -0.025em;
                    color: #ffffff;
                    margin-bottom: 20px;
                }

                .eq-heading em {
                    font-style: italic;
                    color: #4d9fff;
                }

                .eq-body {
                    font-size: clamp(14px, 1.2vw, 16.5px);
                    line-height: 1.75;
                    color: rgba(232,237,248,0.6);
                    font-weight: 300;
                    max-width: 580px;
                }

                /* ── ORIGINS section ── */
                .eq-origins-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: clamp(32px, 5vw, 80px);
                    align-items: center;
                }

                /* ── HACKATHON section ── */
                .eq-hack-inner {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: clamp(32px, 5vw, 80px);
                    align-items: center;
                }

                .eq-photo-frame {
                    position: relative;
                    border-radius: 16px;
                    overflow: hidden;
                }

                .eq-photo-frame img {
                    width: 100%;
                    display: block;
                    filter: saturate(0.85) brightness(0.8);
                    transition: transform 0.6s ease, filter 0.6s ease;
                }

                .eq-photo-frame:hover img {
                    transform: scale(1.03);
                    filter: saturate(1) brightness(0.85);
                }

                .eq-photo-accent {
                    position: absolute;
                    top: -12px;
                    left: -12px;
                    width: 80px;
                    height: 80px;
                    border-top: 3px solid #df3601;
                    border-left: 3px solid #df3601;
                    border-radius: 4px 0 0 0;
                    pointer-events: none;
                }

                .eq-photo-accent-br {
                    position: absolute;
                    bottom: -12px;
                    right: -12px;
                    width: 80px;
                    height: 80px;
                    border-bottom: 3px solid #006edc;
                    border-right: 3px solid #006edc;
                    border-radius: 0 0 4px 0;
                    pointer-events: none;
                }

                .eq-award-pill {
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    background: rgba(223,54,1,0.12);
                    border: 1px solid rgba(223,54,1,0.35);
                    color: #ff7a50;
                    padding: 10px 20px;
                    border-radius: 10px;
                    font-size: 13px;
                    font-weight: 500;
                    margin-top: 28px;
                }

                .eq-award-trophy {
                    font-size: 20px;
                }

                /* ── TEAM section ── */
                .eq-team-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 20px;
                    margin-top: 52px;
                }

                .eq-member {
                    background: rgba(255,255,255,0.03);
                    border: 1px solid rgba(255,255,255,0.07);
                    border-radius: 16px;
                    padding: 36px 24px 28px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                    transition: border-color 0.25s, background 0.25s, transform 0.25s;
                    cursor: default;
                }

                .eq-member:hover {
                    border-color: rgba(77,159,255,0.3);
                    background: rgba(77,159,255,0.05);
                    transform: translateY(-4px);
                }

                .eq-member-avatar {
                    width: 72px;
                    height: 72px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: 'Lora', serif;
                    font-size: 22px;
                    font-weight: 600;
                    letter-spacing: -0.01em;
                    text-transform: uppercase;
                    margin-bottom: 18px;
                    border: 1.5px solid transparent;
                    transition: box-shadow 0.25s;
                }

                .eq-member:hover .eq-member-avatar {
                    box-shadow: 0 0 0 4px #05091a, 0 0 0 6px currentColor;
                }

                .eq-member-name {
                    font-family: 'Lora', serif;
                    font-size: 16px;
                    font-weight: 600;
                    color: #e8edf8;
                    margin-bottom: 6px;
                    line-height: 1.3;
                }

                .eq-member-role {
                    font-size: 11.5px;
                    color: rgba(232,237,248,0.4);
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                    margin-bottom: 20px;
                }

                .eq-linkedin {
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                    padding: 8px 18px;
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 999px;
                    font-size: 12px;
                    color: rgba(232,237,248,0.5);
                    text-decoration: none;
                    transition: border-color 0.2s, color 0.2s, background 0.2s;
                }

                .eq-linkedin:hover {
                    border-color: #0a66c2;
                    color: #60a5fa;
                    background: rgba(10,102,194,0.12);
                }

                .eq-linkedin svg {
                    width: 14px;
                    height: 14px;
                }

                /* ── THANKS section ── */
                .eq-thanks {
                    margin: clamp(32px, 4vw, 64px) clamp(32px, 8vw, 120px);
                    border-radius: 20px;
                    padding: clamp(48px, 6vw, 88px) clamp(40px, 6vw, 88px);
                    background: linear-gradient(135deg, #002952 0%, #001a3a 100%);
                    border: 1px solid rgba(0,110,220,0.25);
                    position: relative;
                    overflow: hidden;
                }

                .eq-thanks::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 3px;
                    background: linear-gradient(90deg, #df3601 0%, #006edc 50%, #df3601 100%);
                }

                .eq-thanks-bg-mark {
                    position: absolute;
                    right: -40px;
                    bottom: -60px;
                    font-size: 280px;
                    font-family: 'Lora', serif;
                    font-weight: 700;
                    color: rgba(0,110,220,0.05);
                    line-height: 1;
                    user-select: none;
                    pointer-events: none;
                }

                .eq-thanks-quote {
                    font-family: 'Lora', serif;
                    font-size: clamp(20px, 2.8vw, 34px);
                    font-weight: 500;
                    font-style: italic;
                    color: rgba(232,237,248,0.9);
                    line-height: 1.5;
                    max-width: 700px;
                    position: relative;
                    z-index: 1;
                }

                .eq-thanks-body {
                    font-size: clamp(14px, 1.2vw, 16px);
                    line-height: 1.75;
                    color: rgba(232,237,248,0.5);
                    font-weight: 300;
                    max-width: 640px;
                    margin-top: 20px;
                    position: relative;
                    z-index: 1;
                }

                .eq-thanks-orgs {
                    display: flex;
                    gap: 16px;
                    flex-wrap: wrap;
                    margin-top: 32px;
                    position: relative;
                    z-index: 1;
                }

                .eq-org-tag {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 18px;
                    border-radius: 999px;
                    border: 1px solid rgba(0,110,220,0.4);
                    background: rgba(0,110,220,0.1);
                    font-size: 13px;
                    color: #60a5fa;
                    font-weight: 500;
                }

                /* ── FOOTER ── */
                .eq-footer {
                    text-align: center;
                    padding: 40px 32px;
                    border-top: 1px solid rgba(255,255,255,0.06);
                    color: rgba(232,237,248,0.25);
                    font-size: 12px;
                    letter-spacing: 0.04em;
                }

                /* ── RESPONSIVE ── */
                @media (max-width: 900px) {
                    .eq-hero, .eq-origins-grid, .eq-hack-inner {
                        grid-template-columns: 1fr;
                    }
                    .eq-hero-right { min-height: 320px; }
                    .eq-team-grid { grid-template-columns: repeat(2, 1fr); }
                    .eq-chapter-num { display: none; }
                    .eq-thanks { margin-left: 20px; margin-right: 20px; }
                }

                @media (max-width: 540px) {
                    .eq-team-grid { grid-template-columns: 1fr 1fr; }
                    .eq-section { padding: 48px 20px; }
                }
            `}</style>

            {/* ── HERO ── */}
            <section className="eq-hero">
                <div className="eq-hero-bg-text" aria-hidden>WINNERS</div>

                <div className="eq-hero-left">
                    <div className="eq-badge eq-reveal">
                        <span className="eq-badge-dot" />
                        Ganadores — Seguridad Sin Papeleo 2025
                    </div>

                    <h1 className="eq-hero-title eq-reveal eq-d1">
                        The<br /><em>Code</em><br />Cookers
                    </h1>

                    <div className="eq-hero-divider eq-reveal eq-d2" />

                    <p className="eq-hero-subtitle eq-reveal eq-d2">
                        Primera generación de Ingeniería Civil Informática e Innovación Tecnológica de la Universidad del Desarrollo. Construimos <strong style={{color:'rgba(232,237,248,0.85)'}}>Build & Serve</strong> — y ganamos.
                    </p>

                    <div className="eq-hero-meta eq-reveal eq-d3">
                        <div className="eq-hero-meta-item">Universidad del Desarrollo</div>
                        <div className="eq-hero-meta-item">ICIIT · Primera Generación</div>
                        <div className="eq-hero-meta-item">Organizado por CChC + CommunityOS</div>
                    </div>
                </div>

                <div className="eq-hero-right eq-reveal-scale">
                    <img
                        src="/TheCodeCookers1.jpeg"
                        alt="The Code Cookers"
                        className="eq-hero-img"
                    />
                    <div className="eq-hero-img-overlay" />
                    <div className="eq-hero-img-corner eq-reveal eq-d4">
                        "Construir el futuro desde las aulas"
                    </div>
                </div>
            </section>

            {/* ── ORIGINS ── */}
            <section className="eq-section eq-section--alt">
                <span className="eq-chapter-num" aria-hidden>01</span>

                <div className="eq-origins-grid">
                    <div className="eq-photo-frame eq-reveal-left">
                        <img src="/TheCodeCookers2.jpeg" alt="The Code Cookers en la hackathon" />
                        <div className="eq-photo-accent" />
                        <div className="eq-photo-accent-br" />
                    </div>

                    <div>
                        <div className="eq-label eq-reveal">Quiénes somos</div>
                        <h2 className="eq-heading eq-reveal eq-d1">
                            De las aulas<br />al <em>podio</em>
                        </h2>
                        <p className="eq-body eq-reveal eq-d2">
                            Somos cuatro estudiantes de la primera generación de la carrera de Ingeniería Civil Informática e Innovación Tecnológica de la Universidad del Desarrollo. Una carrera que nació con la convicción de formar ingenieros que no solo programan, sino que innovan y generan impacto real.
                        </p>
                        <p className="eq-body eq-reveal eq-d3" style={{ marginTop: 16 }}>
                            Cuando supimos de la Hackathon <strong style={{color:'rgba(232,237,248,0.75)'}}>Seguridad Sin Papeleo</strong>, organizada por la Cámara Chilena de la Construcción junto a CommunityOS, no lo dudamos. Era exactamente el tipo de desafío que buscábamos: un problema real, una industria que lo necesita, y la oportunidad de demostrar lo que somos capaces de hacer.
                        </p>
                    </div>
                </div>
            </section>

            {/* ── HACKATHON ── */}
            <section className="eq-section">
                <span className="eq-chapter-num" aria-hidden>02</span>

                <div className="eq-hack-inner">
                    <div>
                        <div className="eq-label eq-reveal">La competencia</div>
                        <h2 className="eq-heading eq-reveal eq-d1">
                            Seguridad<br /><em>Sin Papeleo</em>
                        </h2>
                        <p className="eq-body eq-reveal eq-d2">
                            La hackathon convocó a equipos de todo Chile a resolver uno de los dolores más persistentes de la industria de la construcción: la gestión documental en materia de seguridad. Formularios en papel, firmas presenciales, registros dispersos — un problema con impacto directo en la seguridad de miles de trabajadores.
                        </p>
                        <p className="eq-body eq-reveal eq-d3" style={{ marginTop: 16 }}>
                            Nuestra respuesta fue <strong style={{color:'rgba(232,237,248,0.75)'}}>Build & Serve</strong>: una plataforma que digitaliza y centraliza la gestión de documentos, firmas electrónicas y cumplimiento normativo en obras de construcción. El jurado nos eligió como ganadores.
                        </p>
                        <div className="eq-award-pill eq-reveal eq-d4">
                            <span className="eq-award-trophy">🏆</span>
                            <span>1er lugar · Hackathon Seguridad Sin Papeleo · 2025</span>
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div className="eq-reveal-right" style={{ background: 'rgba(0,110,220,0.08)', border: '1px solid rgba(0,110,220,0.18)', borderRadius: 14, padding: '24px 28px' }}>
                            <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4d9fff', marginBottom: 10 }}>Problema resuelto</div>
                            <div style={{ fontSize: 15, color: 'rgba(232,237,248,0.75)', lineHeight: 1.6, fontWeight: 300 }}>Digitalización de la gestión de seguridad en obras de construcción</div>
                        </div>
                        <div className="eq-reveal-right eq-d1" style={{ background: 'rgba(223,54,1,0.07)', border: '1px solid rgba(223,54,1,0.2)', borderRadius: 14, padding: '24px 28px' }}>
                            <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ff7a50', marginBottom: 10 }}>Nuestra solución</div>
                            <div style={{ fontSize: 15, color: 'rgba(232,237,248,0.75)', lineHeight: 1.6, fontWeight: 300 }}>Plataforma web con firmas electrónicas, gestión documental y cumplimiento DS44</div>
                        </div>
                        <div className="eq-reveal-right eq-d2" style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 14, padding: '24px 28px' }}>
                            <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4ade80', marginBottom: 10 }}>Resultado</div>
                            <div style={{ fontSize: 15, color: 'rgba(232,237,248,0.75)', lineHeight: 1.6, fontWeight: 300 }}>Ganadores y seleccionados para continuar el desarrollo junto a la CChC</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── TEAM ── */}
            <section className="eq-section eq-section--alt">
                <span className="eq-chapter-num" aria-hidden>03</span>

                <div className="eq-label eq-reveal">El equipo</div>
                <h2 className="eq-heading eq-reveal eq-d1">
                    Las personas<br />detrás de <em>Build & Serve</em>
                </h2>
                <p className="eq-body eq-reveal eq-d2">
                    Cuatro estudiantes. Una visión compartida. Cero compromiso en la ejecución.
                </p>

                <div className="eq-team-grid">
                    {TEAM.map((member, i) => {
                        const tint = TINTS[i % TINTS.length];
                        return (
                            <div
                                key={member.name}
                                className={`eq-member eq-reveal eq-d${i + 1}`}
                            >
                                <div
                                    className="eq-member-avatar"
                                    style={{ background: tint.bg, color: tint.fg, borderColor: tint.ring }}
                                >
                                    {member.initials}
                                </div>
                                <div className="eq-member-name">{member.name}</div>
                                <div className="eq-member-role">ICIIT · UDD</div>
                                <a
                                    href={member.linkedin}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="eq-linkedin"
                                >
                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                                    </svg>
                                    LinkedIn
                                </a>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* ── THANKS ── */}
            <section className="eq-section">
                <span className="eq-chapter-num" aria-hidden>04</span>

                <div className="eq-thanks eq-reveal">
                    <div className="eq-thanks-bg-mark" aria-hidden>♥</div>
                    <div className="eq-label" style={{ color: '#60a5fa' }}>Agradecimientos</div>
                    <p className="eq-thanks-quote">
                        "Gracias, CChC, por abrir la puerta y quedarse a construir juntos."
                    </p>
                    <p className="eq-thanks-body">
                        Ganar la hackathon fue el punto de partida, pero lo que vino después superó todas nuestras expectativas. La Cámara Chilena de la Construcción no solo reconoció nuestro trabajo — eligió confiar en nosotros y darnos la oportunidad de continuar desarrollando Build & Serve en conjunto.
                    </p>
                    <p className="eq-thanks-body" style={{ marginTop: 12 }}>
                        Agradecemos profundamente todas las facilidades brindadas: el acceso a expertos de la industria, el entendimiento del dominio real de la construcción, y el compromiso genuino con una solución que impacta la seguridad de trabajadores en Chile. Este proyecto existe gracias a esa confianza.
                    </p>
                    <div className="eq-thanks-orgs">
                        <div className="eq-org-tag">
                            <span>🏗</span> Cámara Chilena de la Construcción
                        </div>
                        <div className="eq-org-tag">
                            <span>⚡</span> CommunityOS
                        </div>
                        <div className="eq-org-tag">
                            <span>🎓</span> Universidad del Desarrollo
                        </div>
                    </div>
                </div>
            </section>

            {/* ── FOOTER ── */}
            <footer className="eq-footer">
                The Code Cookers · Build & Serve · Universidad del Desarrollo · 2025
            </footer>
        </div>
    );
}
