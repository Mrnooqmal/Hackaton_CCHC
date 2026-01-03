import React, { useState } from 'react';
import { FiCheck, FiAlertTriangle, FiShield, FiBookOpen, FiUser, FiCalendar, FiX, FiDownload } from 'react-icons/fi';

interface MedidasControl {
    eliminacion?: string;
    sustitucion?: string;
    ingenieria?: string;
    administrativas?: string[];
    epp?: string[];
}

interface Peligro {
    id: number;
    categoria?: string;
    peligro: string;
    riesgo: string;
    actividad?: string;
    probabilidad: string;
    consecuencia: string;
    nivelRiesgo: string;
    colorRiesgo?: string;
    medidasControl?: MedidasControl | string[];
    epp?: string[];
    normativaAplicable?: string;
    responsable?: string;
    frecuenciaVerificacion?: string;
    requiereCapacitacion?: boolean;
    verificacion?: string;
}

interface PlanAccion {
    prioridad: number;
    accion: string;
    peligroRelacionado?: string;
    plazo: string;
    responsable: string;
    recursos?: string;
}

interface Capacitacion {
    tema: string;
    duracion: string;
    frecuencia?: string;
    obligatoria?: boolean;
}

interface MIPERData {
    cargo: string;
    fecha: string;
    version?: string;
    elaboradoPor?: string;
    actividades: string[];
    peligros: Peligro[];
    resumen: {
        totalPeligros: number;
        criticos: number;
        altos: number;
        medios: number;
        bajos: number;
        porcentajeCriticoAlto?: number;
    };
    planAccion?: PlanAccion[];
    capacitacionesRequeridas?: Capacitacion[];
    eppObligatorio?: string[];
    recomendacionesPrioritarias: string[];
    _fallback?: boolean;
}

interface MIPERVisualProps {
    data: MIPERData;
    onApprove?: (data: MIPERData) => void;
    onEdit?: (section: string, data: any) => void;
}

const NIVEL_COLORS: Record<string, string> = {
    'Crítico': '#ef4444',
    'Alto': '#f97316',
    'Medio': '#eab308',
    'Bajo': '#22c55e'
};

const CATEGORIA_ICONS: Record<string, string> = {
    'Mecánico': '⚙️',
    'Físico': '🔊',
    'Químico': '🧪',
    'Biológico': '🦠',
    'Ergonómico': '🧘',
    'Psicosocial': '🧠'
};

export default function MIPERVisual({ data, onApprove, onEdit }: MIPERVisualProps) {
    const [selectedPeligro, setSelectedPeligro] = useState<Peligro | null>(null);
    const [approvedSections, setApprovedSections] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState<'peligros' | 'plan' | 'capacitaciones'>('peligros');

    const toggleSectionApproval = (section: string) => {
        const newApproved = new Set(approvedSections);
        if (newApproved.has(section)) {
            newApproved.delete(section);
        } else {
            newApproved.add(section);
        }
        setApprovedSections(newApproved);
    };

    const allSectionsApproved = approvedSections.size >= 3;

    const renderMedidasControl = (medidas: MedidasControl | string[] | undefined) => {
        if (!medidas) return null;

        if (Array.isArray(medidas)) {
            return (
                <ul style={{ paddingLeft: 'var(--space-4)', margin: 0 }}>
                    {medidas.map((m, i) => (
                        <li key={i} style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{m}</li>
                    ))}
                </ul>
            );
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {medidas.eliminacion && medidas.eliminacion !== 'N/A' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ background: '#22c55e', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: 'var(--text-xs)', fontWeight: 600 }}>1. Eliminación</span>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{medidas.eliminacion}</span>
                    </div>
                )}
                {medidas.sustitucion && medidas.sustitucion !== 'N/A' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ background: '#3b82f6', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: 'var(--text-xs)', fontWeight: 600 }}>2. Sustitución</span>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{medidas.sustitucion}</span>
                    </div>
                )}
                {medidas.ingenieria && medidas.ingenieria !== 'N/A' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ background: '#8b5cf6', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: 'var(--text-xs)', fontWeight: 600 }}>3. Ingeniería</span>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{medidas.ingenieria}</span>
                    </div>
                )}
                {medidas.administrativas && medidas.administrativas.length > 0 && (
                    <div>
                        <span style={{ background: '#f59e0b', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: '4px', display: 'inline-block' }}>4. Administrativas</span>
                        <ul style={{ paddingLeft: 'var(--space-4)', margin: '4px 0 0 0' }}>
                            {medidas.administrativas.map((m, i) => (
                                <li key={i} style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{m}</li>
                            ))}
                        </ul>
                    </div>
                )}
                {medidas.epp && medidas.epp.length > 0 && (
                    <div>
                        <span style={{ background: '#6b7280', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: '4px', display: 'inline-block' }}>5. EPP</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                            {medidas.epp.map((epp, i) => (
                                <span key={i} style={{ background: 'var(--surface-overlay)', padding: '2px 8px', borderRadius: '4px', fontSize: 'var(--text-xs)' }}>🦺 {epp}</span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const handleExportPDF = () => {
        alert('📄 Exportando PDF de Matriz IPER...\n\nEl documento incluirá:\n- Información del cargo\n- Todos los peligros identificados\n- Plan de acción\n- Capacitaciones requeridas\n- Firmas de aprobación');
    };

    return (
        <div className="miper-container" style={{ background: 'var(--surface-elevated)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
            {/* Header con gradiente profesional */}
            <div style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 50%, #2563eb 100%)', padding: 'var(--space-6)', color: 'white' }}>
                <div className="flex justify-between items-start">
                    <div style={{ flex: 1 }}>
                        {/* Badge tipo documento */}
                        <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: 'rgba(255,255,255,0.15)',
                            padding: '6px 14px',
                            borderRadius: '20px',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 600,
                            marginBottom: '12px',
                            letterSpacing: '0.5px'
                        }}>
                            <FiUser size={14} />
                            MATRIZ IPER - CARGO ESPECÍFICO
                        </div>

                        {/* Cargo prominente */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: '12px' }}>
                            <div style={{
                                width: '64px',
                                height: '64px',
                                borderRadius: '16px',
                                background: 'rgba(255,255,255,0.2)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '2rem'
                            }}>
                                👷
                            </div>
                            <div>
                                <h2 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '4px', lineHeight: 1.2 }}>
                                    {data.cargo}
                                </h2>
                                {data.actividades && data.actividades.length > 0 && (
                                    <div style={{ fontSize: 'var(--text-sm)', opacity: 0.9 }}>
                                        Actividades: {data.actividades.slice(0, 3).join(', ')}{data.actividades.length > 3 ? '...' : ''}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Metadata */}
                        <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-sm)', opacity: 0.85, flexWrap: 'wrap' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <FiCalendar size={14} /> {data.fecha}
                            </span>
                            {data.version && <span>Versión {data.version}</span>}
                            {data.elaboradoPor && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <FiUser size={14} /> {data.elaboradoPor}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2" style={{ alignItems: 'flex-end' }}>
                        <button
                            className="btn btn-sm"
                            onClick={handleExportPDF}
                            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white' }}
                        >
                            <FiDownload /> Exportar PDF
                        </button>
                        {onApprove && (
                            <button
                                className="btn btn-sm"
                                onClick={() => onApprove(data)}
                                disabled={!allSectionsApproved}
                                style={{
                                    background: allSectionsApproved ? 'white' : 'rgba(255,255,255,0.25)',
                                    color: allSectionsApproved ? '#4f46e5' : 'white',
                                    fontWeight: 600
                                }}
                            >
                                <FiCheck /> {allSectionsApproved ? 'Aprobar MIPER' : 'Revisar secciones'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Stats Cards mejoradas */}
                <div className="grid gap-3 mt-5" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                    <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-3)', textAlign: 'center', backdropFilter: 'blur(4px)' }}>
                        <div style={{ fontSize: '1.75rem', fontWeight: 800, lineHeight: 1 }}>{data.resumen.totalPeligros}</div>
                        <div style={{ fontSize: 'var(--text-xs)', opacity: 0.85, marginTop: '4px' }}>Peligros</div>
                    </div>
                    {[
                        { label: 'Críticos', count: data.resumen.criticos, color: NIVEL_COLORS['Crítico'], icon: '🔴' },
                        { label: 'Altos', count: data.resumen.altos, color: NIVEL_COLORS['Alto'], icon: '🟠' },
                        { label: 'Medios', count: data.resumen.medios, color: NIVEL_COLORS['Medio'], icon: '🟡' },
                        { label: 'Bajos', count: data.resumen.bajos, color: NIVEL_COLORS['Bajo'], icon: '🟢' }
                    ].map(item => (
                        <div key={item.label} style={{
                            background: item.color,
                            borderRadius: 'var(--radius-lg)',
                            padding: 'var(--space-3)',
                            textAlign: 'center',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                        }}>
                            <div style={{ fontSize: '1.75rem', fontWeight: 800, lineHeight: 1 }}>
                                {item.count}
                            </div>
                            <div style={{ fontSize: 'var(--text-xs)', opacity: 0.95, marginTop: '4px' }}>{item.label}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--surface-border)', background: 'var(--surface-overlay)' }}>
                <button
                    onClick={() => setActiveTab('peligros')}
                    style={{
                        flex: 1,
                        padding: 'var(--space-4)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: activeTab === 'peligros' ? 700 : 400,
                        color: activeTab === 'peligros' ? 'var(--primary-500)' : 'var(--text-secondary)',
                        borderBottom: activeTab === 'peligros' ? '2px solid var(--primary-500)' : '2px solid transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                    }}
                >
                    <FiAlertTriangle />
                    Peligros ({data.peligros.length})
                    {approvedSections.has('peligros') && <FiCheck color="var(--success-500)" />}
                </button>
                <button
                    onClick={() => setActiveTab('plan')}
                    style={{
                        flex: 1,
                        padding: 'var(--space-4)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: activeTab === 'plan' ? 700 : 400,
                        color: activeTab === 'plan' ? 'var(--primary-500)' : 'var(--text-secondary)',
                        borderBottom: activeTab === 'plan' ? '2px solid var(--primary-500)' : '2px solid transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                    }}
                >
                    <FiShield />
                    Plan de Acción
                    {approvedSections.has('plan') && <FiCheck color="var(--success-500)" />}
                </button>
                <button
                    onClick={() => setActiveTab('capacitaciones')}
                    style={{
                        flex: 1,
                        padding: 'var(--space-4)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: activeTab === 'capacitaciones' ? 700 : 400,
                        color: activeTab === 'capacitaciones' ? 'var(--primary-500)' : 'var(--text-secondary)',
                        borderBottom: activeTab === 'capacitaciones' ? '2px solid var(--primary-500)' : '2px solid transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                    }}
                >
                    <FiBookOpen />
                    Capacitaciones
                    {approvedSections.has('capacitaciones') && <FiCheck color="var(--success-500)" />}
                </button>
            </div>

            {/* Content */}
            <div style={{ padding: 'var(--space-6)' }}>
                {activeTab === 'peligros' && (
                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h3 style={{ fontWeight: 600 }}>Peligros Identificados</h3>
                            <button
                                className={`btn btn-sm ${approvedSections.has('peligros') ? 'btn-success' : 'btn-secondary'}`}
                                onClick={() => toggleSectionApproval('peligros')}
                            >
                                <FiCheck /> {approvedSections.has('peligros') ? 'Aprobado ✓' : 'Aprobar sección'}
                            </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                            {data.peligros.map((peligro) => (
                                <div
                                    key={peligro.id}
                                    style={{
                                        background: 'var(--surface-overlay)',
                                        borderRadius: 'var(--radius-lg)',
                                        padding: 'var(--space-4)',
                                        borderLeft: `4px solid ${peligro.colorRiesgo || NIVEL_COLORS[peligro.nivelRiesgo] || '#666'}`,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                    onClick={() => setSelectedPeligro(peligro)}
                                >
                                    <div className="flex justify-between items-start">
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '8px', flexWrap: 'wrap' }}>
                                                {peligro.categoria && (
                                                    <span style={{ fontSize: '1.2em' }}>{CATEGORIA_ICONS[peligro.categoria] || '⚠️'}</span>
                                                )}
                                                <span className="badge" style={{ background: peligro.colorRiesgo || NIVEL_COLORS[peligro.nivelRiesgo], color: 'white' }}>
                                                    {peligro.nivelRiesgo}
                                                </span>
                                                {peligro.categoria && (
                                                    <span className="badge" style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}>
                                                        {peligro.categoria}
                                                    </span>
                                                )}
                                                {peligro.requiereCapacitacion && (
                                                    <span className="badge" style={{ background: 'var(--info-500)', color: 'white' }}>
                                                        📚 Requiere capacitación
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginBottom: '4px' }}>{peligro.peligro}</div>
                                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{peligro.riesgo}</div>
                                            {peligro.actividad && (
                                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '8px' }}>
                                                    📍 Actividad: {peligro.actividad}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ textAlign: 'right', minWidth: '80px' }}>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Evaluación</div>
                                            <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
                                                {peligro.probabilidad} × {peligro.consecuencia}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'plan' && (
                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h3 style={{ fontWeight: 600 }}>Plan de Acción Prioritario</h3>
                            <button
                                className={`btn btn-sm ${approvedSections.has('plan') ? 'btn-success' : 'btn-secondary'}`}
                                onClick={() => toggleSectionApproval('plan')}
                            >
                                <FiCheck /> {approvedSections.has('plan') ? 'Aprobado ✓' : 'Aprobar sección'}
                            </button>
                        </div>
                        {data.planAccion && data.planAccion.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                {data.planAccion.map((accion, i) => (
                                    <div key={i} style={{ background: 'var(--surface-overlay)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
                                        <div className="flex items-start gap-3">
                                            <div style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '50%',
                                                background: accion.prioridad === 1 ? NIVEL_COLORS['Crítico'] : accion.prioridad === 2 ? NIVEL_COLORS['Alto'] : NIVEL_COLORS['Medio'],
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: 'white',
                                                fontWeight: 700,
                                                flexShrink: 0
                                            }}>
                                                {accion.prioridad}
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 600 }}>{accion.accion}</div>
                                                {accion.peligroRelacionado && (
                                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: '4px' }}>
                                                        🔗 {accion.peligroRelacionado}
                                                    </div>
                                                )}
                                                <div className="flex gap-4 mt-2" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                                                    <span>📅 {accion.plazo}</span>
                                                    <span>👤 {accion.responsable}</span>
                                                    {accion.recursos && <span>🛠️ {accion.recursos}</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>
                                No hay acciones definidas en el plan
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'capacitaciones' && (
                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h3 style={{ fontWeight: 600 }}>Capacitaciones Requeridas</h3>
                            <button
                                className={`btn btn-sm ${approvedSections.has('capacitaciones') ? 'btn-success' : 'btn-secondary'}`}
                                onClick={() => toggleSectionApproval('capacitaciones')}
                            >
                                <FiCheck /> {approvedSections.has('capacitaciones') ? 'Aprobado ✓' : 'Aprobar sección'}
                            </button>
                        </div>

                        {/* EPP Obligatorio */}
                        {data.eppObligatorio && data.eppObligatorio.length > 0 && (
                            <div style={{ marginBottom: 'var(--space-4)' }}>
                                <div style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>🦺 EPP Obligatorio</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                                    {data.eppObligatorio.map((epp, i) => (
                                        <span key={i} style={{ background: 'var(--warning-500)', color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: 'var(--text-sm)', fontWeight: 500 }}>
                                            {epp}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {data.capacitacionesRequeridas && data.capacitacionesRequeridas.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                {data.capacitacionesRequeridas.map((cap, i) => (
                                    <div key={i} style={{ background: 'var(--surface-overlay)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                                        <div style={{ fontSize: '2rem' }}>📚</div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 600 }}>{cap.tema}</div>
                                            <div className="flex gap-4 mt-1" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                                                <span>⏱️ {cap.duracion}</span>
                                                {cap.frecuencia && <span>🔄 {cap.frecuencia}</span>}
                                            </div>
                                        </div>
                                        {cap.obligatoria && (
                                            <span className="badge" style={{ background: NIVEL_COLORS['Alto'], color: 'white' }}>Obligatoria</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>
                                No hay capacitaciones definidas
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Recommendations Footer */}
            {data.recomendacionesPrioritarias && data.recomendacionesPrioritarias.length > 0 && (
                <div style={{ background: 'var(--info-500)' + '15', padding: 'var(--space-4)', borderTop: '1px solid var(--info-500)' }}>
                    <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--info-500)', marginBottom: 'var(--space-2)' }}>
                        💡 Recomendaciones Prioritarias
                    </h4>
                    <ul style={{ paddingLeft: 'var(--space-4)', margin: 0 }}>
                        {data.recomendacionesPrioritarias.map((rec, i) => (
                            <li key={i} style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: '4px' }}>{rec}</li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Peligro Detail Modal */}
            {selectedPeligro && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0,0,0,0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        backdropFilter: 'blur(4px)'
                    }}
                    onClick={() => setSelectedPeligro(null)}
                >
                    <div
                        style={{
                            background: 'var(--surface-elevated)',
                            borderRadius: 'var(--radius-xl)',
                            padding: 'var(--space-6)',
                            maxWidth: '700px',
                            width: '90%',
                            maxHeight: '85vh',
                            overflow: 'auto',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                    <span className="badge" style={{ background: selectedPeligro.colorRiesgo || NIVEL_COLORS[selectedPeligro.nivelRiesgo], color: 'white' }}>
                                        {selectedPeligro.nivelRiesgo}
                                    </span>
                                    {selectedPeligro.categoria && (
                                        <span className="badge" style={{ background: 'var(--surface-overlay)' }}>
                                            {CATEGORIA_ICONS[selectedPeligro.categoria]} {selectedPeligro.categoria}
                                        </span>
                                    )}
                                </div>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{selectedPeligro.peligro}</h3>
                            </div>
                            <button onClick={() => setSelectedPeligro(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                                <FiX size={24} />
                            </button>
                        </div>

                        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>{selectedPeligro.riesgo}</p>

                        <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                            <div style={{ background: 'var(--surface-overlay)', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)' }}>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Probabilidad</div>
                                <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{selectedPeligro.probabilidad}</div>
                            </div>
                            <div style={{ background: 'var(--surface-overlay)', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)' }}>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Consecuencia</div>
                                <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{selectedPeligro.consecuencia}</div>
                            </div>
                            <div style={{ background: 'var(--surface-overlay)', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)' }}>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Responsable</div>
                                <div style={{ fontWeight: 600 }}>{selectedPeligro.responsable || 'No definido'}</div>
                            </div>
                        </div>

                        <div style={{ marginBottom: 'var(--space-4)' }}>
                            <h4 style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Jerarquía de Controles</h4>
                            {renderMedidasControl(selectedPeligro.medidasControl)}
                        </div>

                        {selectedPeligro.normativaAplicable && (
                            <div style={{ background: 'var(--surface-overlay)', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-4)' }}>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>📜 Normativa Aplicable</div>
                                <div style={{ fontWeight: 500 }}>{selectedPeligro.normativaAplicable}</div>
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button className="btn btn-secondary flex-1" onClick={() => setSelectedPeligro(null)}>
                                Cerrar
                            </button>
                            {onEdit && (
                                <button className="btn btn-primary flex-1" onClick={() => onEdit('peligro', selectedPeligro)}>
                                    Editar Peligro
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
