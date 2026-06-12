import { useEffect, useRef } from 'react';
import {
    FiFileText, FiEdit3, FiUsers, FiBarChart2,
    FiMessageSquare, FiAlertTriangle,
    FiMapPin, FiShield, FiCheckCircle, FiLayers, FiArrowRight
} from 'react-icons/fi';

const MODULES = [
    {
        num: '01', icon: FiMapPin,         color: '#4d9fff',
        title: 'Gestión de Obras',
        desc: 'Administra todos tus proyectos desde un solo lugar. Asigna trabajadores, documenta avances y controla el cumplimiento obra por obra.',
    },
    {
        num: '02', icon: FiUsers,           color: '#34d399',
        title: 'Gestión de Trabajadores',
        desc: 'Registra, segmenta y revisa el cumplimiento individual de cada trabajador. Ficha completa con historial y estado de documentación.',
    },
    {
        num: '03', icon: FiFileText,        color: '#a78bfa',
        title: 'Repositorio de Documentos',
        desc: 'Centraliza contratos, fichas, certificados y registros. Trazabilidad completa de cada documento con sellado temporal.',
    },
    {
        num: '04', icon: FiEdit3,           color: '#fbbf24',
        title: 'Firmas Electrónicas',
        desc: 'Asigna, gestiona y registra firmas de trabajadores con validez legal. Firma desde cualquier dispositivo, sin papel.',
    },
    {
        num: '05', icon: FiShield,          color: '#f87171',
        title: 'Cumplimiento DS44',
        desc: 'Organización estructurada para el Decreto Supremo N° 44. Alertas automáticas ante vencimientos y brechas de cumplimiento.',
    },
    {
        num: '06', icon: FiBarChart2,       color: '#38bdf8',
        title: 'Estadísticas',
        desc: 'Captura automática de métricas clave. Paneles de control con indicadores en tiempo real para tomar decisiones informadas.',
    },
    {
        num: '07', icon: FiMessageSquare,   color: '#fb923c',
        title: 'Mensajería',
        desc: 'Canal de comunicación interno nativo. Conversaciones directas entre jefes de obra, prevencionistas y trabajadores.',
    },
    {
        num: '08', icon: FiAlertTriangle,   color: '#e879f9',
        title: 'Reporte de Incidentes',
        desc: 'Reporta hallazgos y accidentes al instante. Flujo de seguimiento, cierre y auditoría completamente digital.',
    },
];

const PILLARS = [
    {
        icon: FiLayers,
        title: 'Todo en una plataforma',
        body: 'Sin integraciones complejas ni herramientas dispersas. Build & Serve centraliza la operación completa de tus obras en un único sistema.',
    },
    {
        icon: FiShield,
        title: 'Cumplimiento normativo',
        body: 'Diseñado desde el primer día para el DS44. Las empresas de construcción tienen obligaciones legales — las resolvemos con tecnología.',
    },
    {
        icon: FiCheckCircle,
        title: 'Trazabilidad total',
        body: 'Cada firma, documento y registro queda sellado con hora, fecha y responsable. Auditable en cualquier momento, sin buscar papeles.',
    },
];

export default function About() {
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = document.documentElement;
        el.style.overflow = 'hidden';
        return () => { el.style.overflow = ''; };
    }, []);

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => entries.forEach(e => {
                if (e.isIntersecting) e.target.classList.add('ab-visible');
            }),
            { threshold: 0.1 }
        );
        rootRef.current?.querySelectorAll('[class*="ab-reveal"]').forEach(t => observer.observe(t));
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={rootRef} className="ab-root">
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,500;0,600;0,700;1,500&family=Roboto:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap');

                .ab-root {
                    position: fixed;
                    inset: 0;
                    overflow-y: auto;
                    overflow-x: hidden;
                    background: #080d18;
                    color: #dde3f0;
                    font-family: 'Roboto', sans-serif;
                    scroll-behavior: smooth;
                    z-index: 1000;
                }

                /* Blueprint grid background */
                .ab-root::before {
                    content: '';
                    position: fixed;
                    inset: 0;
                    background-image:
                        linear-gradient(rgba(0,110,220,0.055) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0,110,220,0.055) 1px, transparent 1px);
                    background-size: 48px 48px;
                    pointer-events: none;
                    z-index: 0;
                }

                /* ── Reveal animations ── */
                .ab-reveal {
                    opacity: 0;
                    transform: translateY(32px);
                    transition: opacity 0.7s cubic-bezier(.16,1,.3,1), transform 0.7s cubic-bezier(.16,1,.3,1);
                }
                .ab-reveal-left {
                    opacity: 0;
                    transform: translateX(-40px);
                    transition: opacity 0.75s cubic-bezier(.16,1,.3,1), transform 0.75s cubic-bezier(.16,1,.3,1);
                }
                .ab-reveal-right {
                    opacity: 0;
                    transform: translateX(40px);
                    transition: opacity 0.75s cubic-bezier(.16,1,.3,1), transform 0.75s cubic-bezier(.16,1,.3,1);
                }
                .ab-reveal.ab-visible,
                .ab-reveal-left.ab-visible,
                .ab-reveal-right.ab-visible { opacity: 1; transform: none; }

                .ab-d1 { transition-delay: 0.07s !important; }
                .ab-d2 { transition-delay: 0.14s !important; }
                .ab-d3 { transition-delay: 0.21s !important; }
                .ab-d4 { transition-delay: 0.28s !important; }
                .ab-d5 { transition-delay: 0.35s !important; }
                .ab-d6 { transition-delay: 0.42s !important; }
                .ab-d7 { transition-delay: 0.49s !important; }
                .ab-d8 { transition-delay: 0.56s !important; }

                /* ── NAVBAR ── */
                .ab-nav {
                    position: sticky;
                    top: 0;
                    z-index: 50;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0 clamp(24px, 6vw, 80px);
                    height: 60px;
                    background: rgba(8,13,24,0.85);
                    backdrop-filter: blur(16px);
                    border-bottom: 1px solid rgba(0,110,220,0.12);
                }

                .ab-nav-brand {
                    font-family: 'Lora', serif;
                    font-weight: 700;
                    font-size: 18px;
                    color: #fff;
                    letter-spacing: -0.02em;
                }

                .ab-nav-brand span { color: #4d9fff; }

                .ab-nav-back {
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                    font-size: 13px;
                    color: rgba(221,227,240,0.5);
                    text-decoration: none;
                    transition: color 0.2s;
                    cursor: pointer;
                    background: none;
                    border: none;
                    padding: 0;
                }
                .ab-nav-back:hover { color: #4d9fff; }

                /* ── HERO ── */
                .ab-hero {
                    position: relative;
                    z-index: 1;
                    min-height: calc(100vh - 60px);
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    padding: clamp(64px, 10vw, 120px) clamp(24px, 8vw, 120px);
                    overflow: hidden;
                }

                .ab-hero-eyebrow {
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 11px;
                    color: #4d9fff;
                    letter-spacing: 0.15em;
                    text-transform: uppercase;
                    margin-bottom: 24px;
                }

                .ab-hero-eyebrow::before {
                    content: '';
                    display: block;
                    width: 32px;
                    height: 1px;
                    background: #4d9fff;
                }

                .ab-hero-title {
                    font-family: 'Lora', serif;
                    font-size: clamp(42px, 7.5vw, 104px);
                    font-weight: 700;
                    line-height: 0.95;
                    letter-spacing: -0.04em;
                    color: #ffffff;
                    max-width: 900px;
                    margin-bottom: 32px;
                }

                .ab-hero-title .ab-red { color: #df3601; font-style: italic; }
                .ab-hero-title .ab-blue { color: #4d9fff; }

                .ab-hero-sub {
                    font-size: clamp(15px, 1.5vw, 19px);
                    line-height: 1.7;
                    color: rgba(221,227,240,0.55);
                    font-weight: 300;
                    max-width: 560px;
                    margin-bottom: 40px;
                }

                .ab-hero-stats {
                    display: flex;
                    gap: clamp(24px, 4vw, 56px);
                    flex-wrap: wrap;
                }

                .ab-stat {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .ab-stat-num {
                    font-family: 'Lora', serif;
                    font-size: clamp(28px, 4vw, 48px);
                    font-weight: 700;
                    color: #fff;
                    line-height: 1;
                    letter-spacing: -0.03em;
                }

                .ab-stat-label {
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 10.5px;
                    color: rgba(221,227,240,0.4);
                    letter-spacing: 0.1em;
                    text-transform: uppercase;
                }

                .ab-hero-bg-word {
                    position: absolute;
                    right: -40px;
                    bottom: -20px;
                    font-family: 'Lora', serif;
                    font-size: clamp(120px, 20vw, 320px);
                    font-weight: 700;
                    color: rgba(0,110,220,0.035);
                    line-height: 1;
                    user-select: none;
                    pointer-events: none;
                    letter-spacing: -0.05em;
                    white-space: nowrap;
                }

                /* ── DS44 BANNER ── */
                .ab-ds44 {
                    position: relative;
                    z-index: 1;
                    background: linear-gradient(135deg, #002952 0%, #001830 100%);
                    border-top: 1px solid rgba(0,110,220,0.2);
                    border-bottom: 1px solid rgba(0,110,220,0.2);
                    padding: clamp(48px, 6vw, 80px) clamp(24px, 8vw, 120px);
                    display: grid;
                    grid-template-columns: auto 1fr;
                    gap: clamp(32px, 5vw, 80px);
                    align-items: center;
                    overflow: hidden;
                }

                .ab-ds44::after {
                    content: 'DS44';
                    position: absolute;
                    right: clamp(24px, 4vw, 60px);
                    top: 50%;
                    transform: translateY(-50%);
                    font-family: 'Lora', serif;
                    font-size: clamp(80px, 14vw, 200px);
                    font-weight: 700;
                    color: rgba(0,110,220,0.07);
                    letter-spacing: -0.04em;
                    line-height: 1;
                    user-select: none;
                    pointer-events: none;
                }

                .ab-ds44-badge {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 4px;
                    background: rgba(0,110,220,0.15);
                    border: 1px solid rgba(0,110,220,0.35);
                    border-radius: 12px;
                    padding: 20px 28px;
                    flex-shrink: 0;
                }

                .ab-ds44-badge-label {
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 10px;
                    letter-spacing: 0.12em;
                    text-transform: uppercase;
                    color: rgba(77,159,255,0.7);
                }

                .ab-ds44-badge-num {
                    font-family: 'Lora', serif;
                    font-size: 36px;
                    font-weight: 700;
                    color: #4d9fff;
                    line-height: 1;
                }

                .ab-ds44-content {}

                .ab-ds44-title {
                    font-family: 'Lora', serif;
                    font-size: clamp(20px, 2.5vw, 30px);
                    font-weight: 600;
                    color: #fff;
                    margin-bottom: 12px;
                }

                .ab-ds44-body {
                    font-size: clamp(14px, 1.2vw, 16px);
                    line-height: 1.75;
                    color: rgba(221,227,240,0.55);
                    font-weight: 300;
                    max-width: 640px;
                }

                /* ── SECTION ── */
                .ab-section {
                    position: relative;
                    z-index: 1;
                    padding: clamp(64px, 8vw, 112px) clamp(24px, 8vw, 120px);
                }

                .ab-section-label {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 10.5px;
                    color: #4d9fff;
                    letter-spacing: 0.15em;
                    text-transform: uppercase;
                    margin-bottom: 16px;
                }

                .ab-section-label::before {
                    content: '';
                    display: block;
                    width: 24px;
                    height: 1px;
                    background: #4d9fff;
                }

                .ab-section-title {
                    font-family: 'Lora', serif;
                    font-size: clamp(28px, 4vw, 52px);
                    font-weight: 700;
                    line-height: 1.1;
                    letter-spacing: -0.025em;
                    color: #fff;
                    margin-bottom: 12px;
                }

                .ab-section-title em { font-style: italic; color: #4d9fff; }

                .ab-section-sub {
                    font-size: clamp(14px, 1.2vw, 16px);
                    line-height: 1.7;
                    color: rgba(221,227,240,0.5);
                    font-weight: 300;
                    max-width: 520px;
                    margin-bottom: 52px;
                }

                /* ── MODULES GRID ── */
                .ab-modules-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 1px;
                    background: rgba(0,110,220,0.1);
                    border: 1px solid rgba(0,110,220,0.1);
                    border-radius: 16px;
                    overflow: hidden;
                }

                .ab-module {
                    background: rgba(8,13,24,0.95);
                    padding: 28px 24px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    transition: background 0.2s;
                    cursor: default;
                    position: relative;
                    overflow: hidden;
                }

                .ab-module::after {
                    content: '';
                    position: absolute;
                    inset: 0;
                    background: var(--mod-color, #4d9fff);
                    opacity: 0;
                    transition: opacity 0.25s;
                }

                .ab-module:hover { background: rgba(12,18,32,0.98); }
                .ab-module:hover::after { opacity: 0.04; }

                .ab-module-top {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    position: relative;
                    z-index: 1;
                }

                .ab-module-num {
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 11px;
                    color: rgba(221,227,240,0.2);
                    letter-spacing: 0.06em;
                }

                .ab-module-icon {
                    width: 36px;
                    height: 36px;
                    border-radius: 9px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--mod-bg, rgba(77,159,255,0.1));
                    color: var(--mod-color, #4d9fff);
                    border: 1px solid var(--mod-border, rgba(77,159,255,0.2));
                    transition: transform 0.2s;
                }

                .ab-module:hover .ab-module-icon { transform: scale(1.1); }

                .ab-module-title {
                    font-family: 'Lora', serif;
                    font-size: 14.5px;
                    font-weight: 600;
                    color: rgba(221,227,240,0.9);
                    line-height: 1.3;
                    position: relative;
                    z-index: 1;
                }

                .ab-module-desc {
                    font-size: 12.5px;
                    line-height: 1.6;
                    color: rgba(221,227,240,0.38);
                    font-weight: 300;
                    position: relative;
                    z-index: 1;
                    transition: color 0.2s;
                }

                .ab-module:hover .ab-module-desc { color: rgba(221,227,240,0.55); }

                /* ── PILLARS ── */
                .ab-pillars {
                    background: rgba(8,13,24,0.6);
                }

                .ab-pillars-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 24px;
                }

                .ab-pillar {
                    padding: 32px 28px;
                    background: rgba(255,255,255,0.02);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: 14px;
                    transition: border-color 0.25s, background 0.25s, transform 0.25s;
                }

                .ab-pillar:hover {
                    border-color: rgba(0,110,220,0.3);
                    background: rgba(0,110,220,0.04);
                    transform: translateY(-3px);
                }

                .ab-pillar-icon {
                    width: 44px;
                    height: 44px;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(0,110,220,0.1);
                    color: #4d9fff;
                    border: 1px solid rgba(0,110,220,0.2);
                    margin-bottom: 20px;
                }

                .ab-pillar-title {
                    font-family: 'Lora', serif;
                    font-size: 18px;
                    font-weight: 600;
                    color: #fff;
                    margin-bottom: 10px;
                    line-height: 1.3;
                }

                .ab-pillar-body {
                    font-size: 14px;
                    line-height: 1.7;
                    color: rgba(221,227,240,0.48);
                    font-weight: 300;
                }

                /* ── CTA ── */
                .ab-cta {
                    position: relative;
                    z-index: 1;
                    text-align: center;
                    padding: clamp(64px, 8vw, 112px) clamp(24px, 8vw, 120px);
                    overflow: hidden;
                }

                .ab-cta::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 50%; transform: translateX(-50%);
                    width: 600px;
                    height: 1px;
                    background: linear-gradient(90deg, transparent, rgba(0,110,220,0.4), transparent);
                }

                .ab-cta-title {
                    font-family: 'Lora', serif;
                    font-size: clamp(28px, 4.5vw, 58px);
                    font-weight: 700;
                    color: #fff;
                    letter-spacing: -0.03em;
                    line-height: 1.1;
                    margin-bottom: 16px;
                }

                .ab-cta-title em { font-style: italic; color: #4d9fff; }

                .ab-cta-sub {
                    font-size: clamp(14px, 1.2vw, 17px);
                    color: rgba(221,227,240,0.45);
                    font-weight: 300;
                    margin-bottom: 40px;
                }

                .ab-cta-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    background: #006edc;
                    color: #fff;
                    font-family: 'Roboto', sans-serif;
                    font-size: 14px;
                    font-weight: 500;
                    padding: 14px 32px;
                    border-radius: 10px;
                    text-decoration: none;
                    border: none;
                    cursor: pointer;
                    transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
                    box-shadow: 0 4px 20px rgba(0,110,220,0.3);
                }

                .ab-cta-btn:hover {
                    background: #0052a3;
                    transform: translateY(-2px);
                    box-shadow: 0 8px 28px rgba(0,110,220,0.4);
                }

                /* ── FOOTER ── */
                .ab-footer {
                    border-top: 1px solid rgba(255,255,255,0.05);
                    padding: 28px clamp(24px, 8vw, 120px);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    flex-wrap: wrap;
                    gap: 12px;
                    position: relative;
                    z-index: 1;
                }

                .ab-footer-brand {
                    font-family: 'Lora', serif;
                    font-size: 15px;
                    font-weight: 600;
                    color: rgba(221,227,240,0.4);
                }

                .ab-footer-brand span { color: rgba(77,159,255,0.6); }

                .ab-footer-copy {
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 10.5px;
                    color: rgba(221,227,240,0.18);
                    letter-spacing: 0.06em;
                }

                /* ── RESPONSIVE ── */
                @media (max-width: 1024px) {
                    .ab-modules-grid { grid-template-columns: repeat(2, 1fr); }
                    .ab-pillars-grid { grid-template-columns: 1fr; }
                }

                @media (max-width: 720px) {
                    .ab-ds44 { grid-template-columns: 1fr; }
                    .ab-hero-stats { gap: 24px; }
                    .ab-modules-grid { grid-template-columns: 1fr 1fr; }
                }

                @media (max-width: 480px) {
                    .ab-modules-grid { grid-template-columns: 1fr; }
                }
            `}</style>

            {/* ── NAV ── */}
            <nav className="ab-nav">
                <div className="ab-nav-brand">Build<span>&</span>Serve</div>
                <button className="ab-nav-back" onClick={() => window.close()}>
                    ← Volver a la plataforma
                </button>
            </nav>

            {/* ── HERO ── */}
            <section className="ab-hero">
                <div className="ab-hero-bg-word" aria-hidden>BUILD</div>

                <div className="ab-hero-eyebrow ab-reveal">
                    Plataforma para la construcción
                </div>

                <h1 className="ab-hero-title ab-reveal ab-d1">
                    La obra,<br />
                    <span className="ab-blue">digitalizada.</span><br />
                    <span className="ab-red">Sin papel.</span>
                </h1>

                <p className="ab-hero-sub ab-reveal ab-d2">
                    Build &amp; Serve centraliza la gestión documental, firmas, cumplimiento normativo y comunicación de todas tus obras en una sola plataforma.
                </p>

                <div className="ab-hero-stats ab-reveal ab-d3">
                    <div className="ab-stat">
                        <span className="ab-stat-num">8</span>
                        <span className="ab-stat-label">Módulos integrados</span>
                    </div>
                    <div className="ab-stat">
                        <span className="ab-stat-num">DS44</span>
                        <span className="ab-stat-label">Cumplimiento normativo</span>
                    </div>
                    <div className="ab-stat">
                        <span className="ab-stat-num">∞</span>
                        <span className="ab-stat-label">Obras por empresa</span>
                    </div>
                </div>
            </section>

            {/* ── DS44 BANNER ── */}
            <div className="ab-ds44">
                <div className="ab-ds44-badge ab-reveal">
                    <span className="ab-ds44-badge-label">Decreto Supremo</span>
                    <span className="ab-ds44-badge-num">N°44</span>
                </div>
                <div className="ab-ds44-content ab-reveal ab-d1">
                    <h2 className="ab-ds44-title">Organizado para el cumplimiento legal</h2>
                    <p className="ab-ds44-body">
                        El Decreto Supremo N° 44 establece condiciones sanitarias mínimas para los trabajadores de la construcción. Build &amp; Serve estructura todos los documentos, registros y firmas requeridos por esta normativa, con alertas automáticas ante brechas de cumplimiento y trazabilidad completa para auditorías.
                    </p>
                </div>
            </div>

            {/* ── MÓDULOS ── */}
            <section className="ab-section">
                <div className="ab-section-label ab-reveal">Capacidades</div>
                <h2 className="ab-section-title ab-reveal ab-d1">
                    Ocho módulos.<br /><em>Una sola plataforma.</em>
                </h2>
                <p className="ab-section-sub ab-reveal ab-d2">
                    Cada módulo está diseñado para un flujo de trabajo real de la industria de la construcción. Sin funcionalidades superfluas.
                </p>

                <div className="ab-modules-grid">
                    {MODULES.map((mod, i) => {
                        const Icon = mod.icon;
                        return (
                            <div
                                key={mod.num}
                                className={`ab-module ab-reveal ab-d${Math.min(i % 4 + 1, 8)}`}
                                style={{ '--mod-color': mod.color, '--mod-bg': `${mod.color}1a`, '--mod-border': `${mod.color}38` } as any}
                            >
                                <div className="ab-module-top">
                                    <span className="ab-module-num">{mod.num}</span>
                                    <div className="ab-module-icon">
                                        <Icon size={17} />
                                    </div>
                                </div>
                                <div className="ab-module-title">{mod.title}</div>
                                <div className="ab-module-desc">{mod.desc}</div>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* ── PILLARS ── */}
            <section className="ab-section ab-pillars">
                <div className="ab-section-label ab-reveal">Por qué Build &amp; Serve</div>
                <h2 className="ab-section-title ab-reveal ab-d1">
                    Diseñado para<br /><em>la realidad de obra</em>
                </h2>

                <div className="ab-pillars-grid">
                    {PILLARS.map((p, i) => {
                        const Icon = p.icon;
                        return (
                            <div key={p.title} className={`ab-pillar ab-reveal ab-d${i + 1}`}>
                                <div className="ab-pillar-icon"><Icon size={20} /></div>
                                <div className="ab-pillar-title">{p.title}</div>
                                <div className="ab-pillar-body">{p.body}</div>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* ── CTA ── */}
            <section className="ab-cta">
                <h2 className="ab-cta-title ab-reveal">
                    ¿Tu empresa ya usa<br /><em>Build &amp; Serve?</em>
                </h2>
                <p className="ab-cta-sub ab-reveal ab-d1">
                    Accede a la plataforma y empieza a gestionar tus obras hoy.
                </p>
                <a href="/login" className="ab-cta-btn ab-reveal ab-d2">
                    Ir a la plataforma <FiArrowRight size={15} />
                </a>
            </section>

            {/* ── FOOTER ── */}
            <footer className="ab-footer">
                <div className="ab-footer-brand">Build<span>&</span>Serve</div>
                <div className="ab-footer-copy">THE CODE COOKERS · UDD · 2025</div>
            </footer>
        </div>
    );
}
