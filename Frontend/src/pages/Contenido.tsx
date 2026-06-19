import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { FiFileText, FiCalendar, FiClipboard, FiArrowRight, FiPlus } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../permissions';

interface ContentCard {
    icon: React.ReactNode;
    accent: string;
    tint: string;
    titulo: string;
    desc: string;
    href: string;
    permission?: string;
}

export default function Contenido() {
    const navigate = useNavigate();
    const { hasPermission } = useAuth();

    const CARDS: ContentCard[] = [
        {
            icon: <FiFileText size={26} style={{ color: '#006edc' }} />,
            accent: '#006edc',
            tint: 'rgba(0,110,220,0.08)',
            titulo: 'Documentos',
            desc: 'Gestiona y solicita firma de documentos: difusiones, procedimientos y registros DS44 de la obra.',
            href: '/documents',
            permission: PERMISSIONS.DOCUMENTOS_VER,
        },
        {
            icon: <FiCalendar size={26} style={{ color: '#10b981' }} />,
            accent: '#10b981',
            tint: 'rgba(16,185,129,0.08)',
            titulo: 'Actividades',
            desc: 'Capacitaciones, charlas de 5 minutos y eventos formativos, con asistencia y firma de los participantes.',
            href: '/activities',
            permission: PERMISSIONS.ACTIVIDADES_VER,
        },
        {
            icon: <FiClipboard size={26} style={{ color: '#f59e0b' }} />,
            accent: '#f59e0b',
            tint: 'rgba(245,158,11,0.08)',
            titulo: 'Encuestas',
            desc: 'Diagnósticos, evaluaciones de riesgo y encuestas de cumplimiento normativo para tu equipo.',
            href: '/surveys',
        },
    ];

    const cards = CARDS.filter((c) => !c.permission || hasPermission(c.permission));

    return (
        <div className="page-content">
            <PageHeader
                banner
                scope={{ label: 'Gestión' }}
                title="Contenido"
                description="Documentos, actividades y encuestas de la obra en un solo lugar. Elige qué quieres revisar o gestionar."
                actions={
                    <button className="btn btn-save" onClick={() => navigate('/crear')}>
                        <FiPlus /> Crear
                    </button>
                }
            />

            <div className="contenido-grid">
                {cards.map((card) => (
                    <button
                        key={card.titulo}
                        className="contenido-card"
                        style={{ '--card-accent': card.accent, '--card-tint': card.tint } as React.CSSProperties}
                        onClick={() => navigate(card.href)}
                    >
                        <div className="contenido-card-icon">{card.icon}</div>
                        <div className="contenido-card-body">
                            <div className="contenido-card-title">{card.titulo}</div>
                            <p className="contenido-card-desc">{card.desc}</p>
                        </div>
                        <div className="contenido-card-footer">
                            <span className="contenido-card-cta">Abrir</span>
                            <FiArrowRight size={15} className="contenido-card-arrow" />
                        </div>
                    </button>
                ))}
            </div>

            <style>{`
                .contenido-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                    gap: var(--space-4);
                }
                .contenido-card {
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
                .contenido-card::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 3px;
                    background: var(--card-accent);
                    opacity: 0;
                    transition: opacity 0.15s;
                }
                .contenido-card:hover {
                    border-color: var(--card-accent);
                    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
                    transform: translateY(-1px);
                }
                .contenido-card:hover::before { opacity: 1; }
                .contenido-card-icon {
                    width: 52px; height: 52px;
                    border-radius: var(--radius-lg);
                    background: var(--card-tint);
                    display: flex; align-items: center; justify-content: center;
                    flex-shrink: 0;
                }
                .contenido-card-body { flex: 1; }
                .contenido-card-title {
                    font-size: var(--text-lg);
                    font-weight: 800;
                    color: var(--text-primary);
                    line-height: 1.2;
                    margin-bottom: var(--space-2);
                }
                .contenido-card-desc {
                    font-size: var(--text-sm);
                    color: var(--text-muted);
                    line-height: 1.55;
                    margin: 0;
                }
                .contenido-card-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding-top: var(--space-2);
                    border-top: 1px solid var(--surface-border);
                    margin-top: auto;
                }
                .contenido-card-cta {
                    font-size: var(--text-sm);
                    font-weight: 600;
                    color: var(--card-accent);
                }
                .contenido-card-arrow {
                    color: var(--card-accent);
                    transition: transform 0.15s;
                }
                .contenido-card:hover .contenido-card-arrow { transform: translateX(3px); }

                @media (max-width: 480px) {
                    .contenido-grid { grid-template-columns: 1fr; }
                }
            `}</style>
        </div>
    );
}
