import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { FiFileText, FiCalendar, FiClipboard, FiArrowRight, FiPlus } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../permissions';

interface ContentCard {
    icon: React.ReactNode;
    titulo: string;
    desc: string;
    href: string;
    permission?: string;
}

// Las tres casillas comparten el color primario del tenant (uniformidad de
// marca); el ícono es la única señal que las distingue entre sí.
export default function Contenido() {
    const navigate = useNavigate();
    const { hasPermission } = useAuth();

    const CARDS: ContentCard[] = [
        {
            icon: <FiFileText size={24} />,
            titulo: 'Documentos',
            desc: 'Repositorio de documentos base, cumplimiento DS44 y registros asignados a cada persona de la obra.',
            href: '/documents-repository',
            permission: PERMISSIONS.REPOSITORIO_VER,
        },
        {
            icon: <FiCalendar size={24} />,
            titulo: 'Actividades',
            desc: 'Capacitaciones, charlas de 5 minutos y eventos formativos, con asistencia y firma de los participantes.',
            href: '/activities',
            permission: PERMISSIONS.ACTIVIDADES_VER,
        },
        {
            icon: <FiClipboard size={24} />,
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
                title="Contenido"
                description="Documentos, actividades y encuestas de la obra en un solo lugar. Elige qué quieres revisar o gestionar."
                actions={
                    <button className="btn btn-primary" onClick={() => navigate('/crear')}>
                        <FiPlus /> Crear
                    </button>
                }
            />

            <div className="contenido-grid">
                {cards.map((card) => (
                    <button
                        key={card.titulo}
                        className="contenido-card"
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
                /* auto-fit (no auto-fill): las columnas vacías colapsan a 0 y las
                   3 casillas reparten el ancho disponible entre ellas. Con
                   auto-fill quedaban fijas en su mínimo y quedaba espacio muerto
                   cada vez que el viewport (p. ej. al hacer zoom out) alcanzaba
                   para una columna extra. */
                .contenido-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
                    gap: var(--space-5);
                }
                .contenido-card {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-4);
                    padding: var(--space-6) var(--space-5) var(--space-4);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-xl);
                    background: var(--surface-card);
                    cursor: pointer;
                    text-align: left;
                    transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
                    position: relative;
                    overflow: hidden;
                }
                /* Filete institucional azul→rojo: reservado como remate de marca
                   (mismo recurso que el borde inferior del header y el footer),
                   se revela sólo al interactuar para no saturar la grilla. */
                .contenido-card::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 3px;
                    background: var(--cchc-accent-line);
                    transform: scaleX(0);
                    transform-origin: left;
                    transition: transform 0.25s ease;
                }
                .contenido-card:hover,
                .contenido-card:focus-visible {
                    border-color: var(--primary-500);
                    box-shadow: var(--shadow-glow-primary);
                    transform: translateY(-2px);
                }
                .contenido-card:hover::before,
                .contenido-card:focus-visible::before { transform: scaleX(1); }
                .contenido-card-icon {
                    width: 56px; height: 56px;
                    border-radius: 50%;
                    background: var(--gradient-primary);
                    color: #fff;
                    display: flex; align-items: center; justify-content: center;
                    flex-shrink: 0;
                    box-shadow: 0 6px 16px -4px var(--cchc-blue-tint-strong);
                    transition: transform 0.2s ease;
                }
                .contenido-card:hover .contenido-card-icon { transform: scale(1.06); }
                .contenido-card-body { flex: 1; }
                .contenido-card-title {
                    font-size: var(--text-lg);
                    font-weight: 700;
                    letter-spacing: -0.01em;
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
                    padding-top: var(--space-3);
                    border-top: 1px solid var(--surface-border);
                    margin-top: auto;
                }
                .contenido-card-cta {
                    font-size: var(--text-sm);
                    font-weight: 600;
                    color: var(--primary-500);
                }
                .contenido-card-arrow {
                    color: var(--primary-500);
                    transition: transform 0.2s ease;
                }
                .contenido-card:hover .contenido-card-arrow,
                .contenido-card:focus-visible .contenido-card-arrow { transform: translateX(3px); }

                @media (max-width: 480px) {
                    .contenido-grid { grid-template-columns: 1fr; }
                }
            `}</style>
        </div>
    );
}
