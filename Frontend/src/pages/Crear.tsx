import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { FiFileText, FiUsers, FiClipboard, FiArrowRight } from 'react-icons/fi';
import { LuTriangleAlert } from 'react-icons/lu';

const CATEGORIES = [
    {
        icon: <FiFileText size={28} style={{ color: '#006edc' }} />,
        accent: '#006edc',
        tint: 'rgba(0,110,220,0.07)',
        titulo: 'Documento',
        subtitulo: 'Solicitud de firma',
        desc: 'Crea y envía un documento para que uno o varios trabajadores firmen. Queda registrado en el historial de cumplimiento.',
        href: '/documents',
        cta: 'Crear documento',
    },
    {
        icon: <FiUsers size={28} style={{ color: '#10b981' }} />,
        accent: '#10b981',
        tint: 'rgba(16,185,129,0.07)',
        titulo: 'Actividad',
        subtitulo: 'Capacitación · Charla · Evento',
        desc: 'Registra una capacitación, charla de 5 minutos u otro evento formativo. Incluye asistencia y firma de los participantes.',
        href: '/activities',
        cta: 'Crear actividad',
    },
    {
        icon: <FiClipboard size={28} style={{ color: '#f59e0b' }} />,
        accent: '#f59e0b',
        tint: 'rgba(245,158,11,0.07)',
        titulo: 'Encuesta',
        subtitulo: 'Diagnóstico · Evaluación',
        desc: 'Diseña y distribuye una encuesta de diagnóstico, evaluación de riesgos o cumplimiento normativo a tu equipo.',
        href: '/surveys',
        cta: 'Crear encuesta',
    },
    {
        icon: <LuTriangleAlert size={28} style={{ color: '#df3601' }} />,
        accent: '#df3601',
        tint: 'rgba(223,54,1,0.07)',
        titulo: 'Incidente',
        subtitulo: 'Reporte de accidente · Casi accidente',
        desc: 'Registra un incidente, accidente laboral o casi accidente. Inicia el flujo de investigación y seguimiento normativo.',
        href: '/incidents',
        cta: 'Reportar incidente',
    },
];

export default function Crear() {
    const navigate = useNavigate();

    return (
        <div className="page-content">
            <PageHeader
                banner
                title="Crear"
                description="¿Qué quieres registrar hoy? Elige el tipo de contenido para comenzar."
            />

            <div className="crear-grid">
                {CATEGORIES.map((cat) => (
                    <button
                        key={cat.titulo}
                        className="crear-card"
                        style={{ '--card-accent': cat.accent, '--card-tint': cat.tint } as React.CSSProperties}
                        onClick={() => navigate(cat.href)}
                    >
                        <div className="crear-card-icon">{cat.icon}</div>
                        <div className="crear-card-body">
                            <div className="crear-card-title">{cat.titulo}</div>
                            <div className="crear-card-sub">{cat.subtitulo}</div>
                            <p className="crear-card-desc">{cat.desc}</p>
                        </div>
                        <div className="crear-card-footer">
                            <span className="crear-card-cta">{cat.cta}</span>
                            <FiArrowRight size={15} className="crear-card-arrow" />
                        </div>
                    </button>
                ))}
            </div>

            <style>{`
                .crear-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                    gap: var(--space-4);
                }
                .crear-card {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-3);
                    padding: var(--space-5) var(--space-5) var(--space-4);
                    border: 1.5px solid var(--surface-border);
                    border-radius: var(--radius-xl);
                    background: var(--surface);
                    cursor: pointer;
                    text-align: left;
                    transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
                    position: relative;
                    overflow: hidden;
                }
                .crear-card::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 3px;
                    background: var(--card-accent);
                    opacity: 0;
                    transition: opacity 0.15s;
                }
                .crear-card:hover {
                    border-color: var(--card-accent);
                    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
                    transform: translateY(-1px);
                }
                .crear-card:hover::before { opacity: 1; }
                .crear-card-icon {
                    width: 52px; height: 52px;
                    border-radius: var(--radius-lg);
                    background: var(--card-tint);
                    display: flex; align-items: center; justify-content: center;
                    flex-shrink: 0;
                }
                .crear-card-body { flex: 1; }
                .crear-card-title {
                    font-size: var(--text-lg);
                    font-weight: 800;
                    color: var(--text-primary);
                    line-height: 1.2;
                    margin-bottom: 2px;
                }
                .crear-card-sub {
                    font-size: var(--text-xs);
                    font-weight: 600;
                    color: var(--card-accent);
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    margin-bottom: var(--space-2);
                }
                .crear-card-desc {
                    font-size: var(--text-sm);
                    color: var(--text-muted);
                    line-height: 1.55;
                    margin: 0;
                }
                .crear-card-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding-top: var(--space-2);
                    border-top: 1px solid var(--surface-border);
                    margin-top: auto;
                }
                .crear-card-cta {
                    font-size: var(--text-sm);
                    font-weight: 600;
                    color: var(--card-accent);
                }
                .crear-card-arrow {
                    color: var(--card-accent);
                    transition: transform 0.15s;
                }
                .crear-card:hover .crear-card-arrow { transform: translateX(3px); }

                @media (max-width: 480px) {
                    .crear-grid { grid-template-columns: 1fr; }
                }
            `}</style>
        </div>
    );
}
