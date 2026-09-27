import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import { activitiesApi, workersApi, type PlanItem, type Worker } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { useToast } from '../context/ToastContext';
import { FormPage, FieldSection, PageHeader, Select } from '../components/ui';
import WorkerPicker from '../components/actividades/WorkerPicker';
import { ACTIVITY_TYPES, TIPOS_TRABAJO } from '../utils/actividadCatalogos';

// Ítem del esqueleto: un tipo de actividad que se repite con una
// periodicidad y una lista de responsables (uno por día, cada uno).
interface PlanItemForm {
    tipo: string;
    periodicidad: 'diaria' | 'semanal' | 'mensual';
    tipoTrabajo: string;
    responsables: string[];
    tituloBase: string;
    horaInicio: string;
    ubicacion: string;
}

const emptyPlanItem: PlanItemForm = {
    tipo: 'CHARLA_5MIN',
    periodicidad: 'diaria',
    tipoTrabajo: '',
    responsables: [],
    tituloBase: '',
    horaInicio: '09:00',
    ubicacion: '',
};

// Rango por defecto: el mes en curso.
const rangoDelMes = (base = new Date()) => {
    const desde = new Date(base.getFullYear(), base.getMonth(), 1);
    const hasta = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { desde: iso(desde), hasta: iso(hasta) };
};

export default function ActivityPlanificar() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { selectedObraId } = useObraContext();
    const { toast } = useToast();

    const [workers, setWorkers] = useState<Worker[]>([]);
    const [rango, setRango] = useState(() => (location.state as any)?.rango || rangoDelMes());
    const [items, setItems] = useState<PlanItemForm[]>([{ ...emptyPlanItem }]);
    const [search, setSearch] = useState<Record<number, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!selectedObraId) return;
        workersApi.list({ obraId: selectedObraId }).then((res) => {
            if (res.success && res.data) setWorkers(res.data);
        }).catch(() => {});
    }, [selectedObraId]);

    const updateItem = (index: number, patch: Partial<PlanItemForm>) =>
        setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));

    const toggleResponsable = (index: number, personaId: string) =>
        setItems((prev) => prev.map((it, i) => {
            if (i !== index) return it;
            const responsables = it.responsables.includes(personaId)
                ? it.responsables.filter((id) => id !== personaId)
                : [...it.responsables, personaId];
            return { ...it, responsables };
        }));

    const quitarItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting || !selectedObraId || !user?.personaId) return;
        if (!rango.desde || !rango.hasta || rango.hasta < rango.desde) {
            setError('Indica un rango de fechas válido.');
            return;
        }
        const sinResponsables = items.findIndex((it) => it.responsables.length === 0);
        if (sinResponsables >= 0) {
            setError(`El ítem ${sinResponsables + 1} no tiene responsables asignados.`);
            return;
        }

        setError('');
        setSubmitting(true);
        try {
            const payload: PlanItem[] = items.map((it) => ({
                tipo: it.tipo,
                periodicidad: it.periodicidad,
                tipoTrabajo: it.tipoTrabajo || undefined,
                responsables: it.responsables,
                tituloBase: it.tituloBase || undefined,
                camposPrellenados: {
                    horaInicio: it.horaInicio || undefined,
                    ubicacion: it.ubicacion || undefined,
                },
            }));
            const res = await activitiesApi.plan({
                obraId: selectedObraId,
                rangoDesde: rango.desde,
                rangoHasta: rango.hasta,
                solicitanteId: user.personaId,
                items: payload,
            });
            if (res.success && res.data) {
                const { count, omitidas } = res.data;
                toast.success(`${count} actividad(es) planificada(s)${omitidas > 0 ? ` · ${omitidas} ya existían` : ''}`);
                navigate('/activities');
            } else {
                setError(res.error || 'No se pudo generar la planificación.');
            }
        } catch {
            setError('Error de conexión. Intenta nuevamente.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!selectedObraId) {
        return (
            <div className="page-content">
                <PageHeader banner title="Planificar el mes" description="Selecciona una obra para planificar sus actividades." />
            </div>
        );
    }

    const periodicidadLabel = (p: PlanItemForm['periodicidad']) =>
        p === 'diaria' ? 'Cada día hábil' : p === 'semanal' ? 'Una vez por semana' : 'Una vez al mes';

    return (
        <>
            <div className="page-content">
                <PageHeader
                    banner
                    title="Planificar el mes"
                    description="Arma el esqueleto: cada ítem genera actividades en borrador que los responsables completan día a día."
                />
            </div>

            <FormPage
                maxWidth={960}
                onSubmit={handleSubmit}
                header={<></>}
                actions={
                    <>
                        {error ? (
                            <span style={{ marginRight: 'auto', fontSize: 'var(--text-sm)', color: 'var(--danger-600)' }}>
                                {error}
                            </span>
                        ) : (
                            <span style={{ marginRight: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
                                Sábados y domingos se excluyen automáticamente.
                            </span>
                        )}
                        <button type="button" className="btn btn-secondary" onClick={() => navigate('/activities')}>
                            Cancelar
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={submitting}>
                            {submitting ? 'Generando…' : 'Generar planificación'}
                        </button>
                    </>
                }
            >
                <FieldSection title="Rango del plan" inline description="Sábados y domingos se excluyen automáticamente" cols={2}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Desde <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                        <input className="form-input" type="date" value={rango.desde}
                            onChange={(e) => setRango((p: typeof rango) => ({ ...p, desde: e.target.value }))} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Hasta <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                        <input className="form-input" type="date" value={rango.hasta} min={rango.desde}
                            onChange={(e) => setRango((p: typeof rango) => ({ ...p, hasta: e.target.value }))} />
                    </div>
                </FieldSection>

                {/* Ítems del plan: tarjetas en firme (borde sólido) — a diferencia
                    de "Del plan, por completar" en la lista, acá se está editando
                    algo real, no un pendiente. */}
                <section className="ui-field-section" aria-label="Ítems del plan">
                    <div className="ui-field-section-header ui-field-section-header--inline">
                        <h2 className="ui-field-section-title">Ítems del plan</h2>
                        <p className="ui-field-section-description">
                            Cada uno se repite según su periodicidad · {items.length} ítem{items.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                    <div className="ap-items">
                        {items.map((item, index) => {
                            const typeInfo = ACTIVITY_TYPES[item.tipo];
                            return (
                                <div key={index} className="ap-item">
                                    <div className="ap-item-head">
                                        <span className="ap-item-icon" aria-hidden="true">{typeInfo?.icon}</span>
                                        <div className="ap-item-copy">
                                            <b>{item.tituloBase.trim() || typeInfo?.label || 'Actividad'}</b>
                                            <span>
                                                {periodicidadLabel(item.periodicidad)}
                                                {' · '}
                                                {item.responsables.length > 0
                                                    ? `${item.responsables.length} responsable${item.responsables.length === 1 ? '' : 's'}`
                                                    : 'sin responsables'}
                                            </span>
                                        </div>
                                        {items.length > 1 && (
                                            <button
                                                type="button"
                                                className="ap-item-remove"
                                                aria-label={`Quitar ${typeInfo?.label || 'este ítem'} del plan`}
                                                onClick={() => quitarItem(index)}
                                            >
                                                <FiTrash2 size={15} />
                                            </button>
                                        )}
                                    </div>

                                    <div className="ap-item-fields">
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                                            <label className="form-label">Tipo de actividad <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                                            <Select
                                                ariaLabel={`Tipo de actividad del ítem ${index + 1}`}
                                                value={item.tipo}
                                                onChange={(v) => updateItem(index, { tipo: v })}
                                                options={Object.entries(ACTIVITY_TYPES).map(([key, { label, icon }]) => ({ value: key, label, icon }))}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                                            <label className="form-label">Periodicidad <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                                            <Select
                                                ariaLabel={`Periodicidad del ítem ${index + 1}`}
                                                value={item.periodicidad}
                                                onChange={(v) => updateItem(index, { periodicidad: v as PlanItemForm['periodicidad'] })}
                                                options={[
                                                    { value: 'diaria', label: 'Diaria (lunes a viernes)' },
                                                    { value: 'semanal', label: 'Semanal' },
                                                    { value: 'mensual', label: 'Mensual' },
                                                ]}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                                            <label className="form-label">Tipo de trabajo</label>
                                            <Select
                                                ariaLabel={`Tipo de trabajo del ítem ${index + 1}`}
                                                placeholder="Todos / no aplica"
                                                value={item.tipoTrabajo}
                                                onChange={(v) => updateItem(index, { tipoTrabajo: v })}
                                                options={[
                                                    { value: '', label: 'Todos / no aplica' },
                                                    ...Object.entries(TIPOS_TRABAJO).map(([value, label]) => ({ value, label })),
                                                ]}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                                            <label className="form-label">Hora por defecto</label>
                                            <input className="form-input" type="time" value={item.horaInicio}
                                                onChange={(e) => updateItem(index, { horaInicio: e.target.value })} />
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                                            <label className="form-label">Título base</label>
                                            <input className="form-input" value={item.tituloBase}
                                                placeholder={typeInfo?.label || 'Título de la actividad'}
                                                onChange={(e) => updateItem(index, { tituloBase: e.target.value })} />
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                                            <label className="form-label">Ubicación por defecto</label>
                                            <input className="form-input" value={item.ubicacion}
                                                placeholder="Ej: Frente de obra"
                                                onChange={(e) => updateItem(index, { ubicacion: e.target.value })} />
                                        </div>
                                    </div>

                                    <div>
                                        <p className="ap-item-hint">
                                            Elige solo a quienes les corresponde esta actividad. Se genera un borrador
                                            por día para cada responsable.
                                        </p>
                                        <WorkerPicker
                                            label="Responsables"
                                            variant="flat"
                                            compact
                                            workers={workers}
                                            selected={item.responsables}
                                            onToggle={(personaId) => toggleResponsable(index, personaId)}
                                            search={search[index] || ''}
                                            onSearchChange={(v) => setSearch((prev) => ({ ...prev, [index]: v }))}
                                            maxHeight={170}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ marginTop: 'var(--space-4)' }}
                        onClick={() => setItems((prev) => [...prev, { ...emptyPlanItem }])}
                    >
                        <FiPlus size={14} /> Agregar otro ítem
                    </button>
                </section>
            </FormPage>

            <style>{`
                .ap-items { display: flex; flex-direction: column; gap: var(--space-4); }
                /* Tarjeta EN FIRME: borde sólido, no punteado — acá se está
                   editando algo real, distinto de un pendiente por completar. */
                .ap-item {
                    display: flex; flex-direction: column; gap: var(--space-4);
                    padding: var(--space-5); border: 1px solid var(--surface-border); border-radius: var(--radius-lg);
                }
                .ap-item-head { display: flex; align-items: center; gap: var(--space-3); }
                .ap-item-icon {
                    width: 36px; height: 36px; flex-shrink: 0; border-radius: var(--radius-md);
                    background: var(--surface-hover); color: var(--text-secondary);
                    display: flex; align-items: center; justify-content: center; font-size: 1rem;
                }
                .ap-item-copy { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
                .ap-item-copy b { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
                .ap-item-copy span { font-size: 11.5px; color: var(--text-muted); }
                .ap-item-remove {
                    display: flex; align-items: center; justify-content: center;
                    width: 30px; height: 30px; flex-shrink: 0; background: none; border: none;
                    color: var(--text-muted); cursor: pointer; border-radius: var(--radius-sm);
                }
                .ap-item-remove:hover { color: var(--danger-alerta); background: var(--surface-hover); }
                .ap-item-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); }
                .ap-item-hint { font-size: 11.5px; color: var(--text-muted); margin: 0 0 var(--space-2); line-height: 1.5; }
                @media (max-width: 760px) {
                    .ap-item-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                }
                @media (max-width: 540px) {
                    .ap-item-fields { grid-template-columns: 1fr; }
                }
            `}</style>
        </>
    );
}
