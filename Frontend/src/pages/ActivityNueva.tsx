import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    activitiesApi, tenantsApi, workersApi,
    type CatalogosActividad, type PermisosTrabajoDef, type PermisoTrabajo,
    type PlanificacionActividad, type Worker,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { useToast } from '../context/ToastContext';
import { FormPage, FieldSection, PageHeader, Select, SegmentedControl } from '../components/ui';
import WorkerPicker from '../components/actividades/WorkerPicker';
import PlanificacionDiariaForm from '../components/actividades/PlanificacionDiariaForm';
import PermisosTrabajoForm from '../components/actividades/PermisosTrabajoForm';
import { hoyISO } from '../utils/seguimientoActividad';
import { ACTIVITY_TYPES, CAPACITACION_SUBTIPOS, FRECUENCIA_OPCIONES, labelFrecuencia } from '../utils/actividadCatalogos';

const INITIAL_FORM = {
    tipo: 'CHARLA_5MIN',
    subtipo: '',
    titulo: '',
    descripcion: '',
    relatorId: '',
    fecha: hoyISO(),
    horaInicio: new Date().toTimeString().slice(0, 5),
    horaFin: '',
    ubicacion: '',
    asistentesRequeridos: [] as string[],
    // Periodicidad: 'unica' (sin repetición) o repetir hasta una fecha.
    frecuencia: 'unica' as 'unica' | 'diaria' | 'semanal' | 'mensual',
    repetirHasta: '',
    // Vínculo con un ítem de onboarding (si se agendó desde el Equipo).
    kitItemKey: '' as string,
    // Evaluación de aprendizaje (solo CAPACITACION). El kit del cargo exige
    // 70% general y 90% en altura/SPDC: son las dos únicas notas admitidas.
    evaluacionExigida: false,
    evaluacionNotaMinima: 70 as 70 | 90,
    planificacion: { observaciones: '' } as PlanificacionActividad,
    permisosTrabajo: [] as PermisoTrabajo[],
};

export default function ActivityNueva() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { selectedObraId } = useObraContext();
    const { toast } = useToast();

    const [workers, setWorkers] = useState<Worker[]>([]);
    const [catalogos, setCatalogos] = useState<CatalogosActividad | null>(null);
    const [permisosDef, setPermisosDef] = useState<PermisosTrabajoDef>({});
    const [form, setForm] = useState(INITIAL_FORM);
    // Filtrado de asistentes por relator: por defecto se muestra solo su grupo
    // (su cuadrilla, o las cuadrillas de sus supervisores). El toggle expande
    // a toda la obra por si algún vínculo no está cargado.
    const [verTodaLaObra, setVerTodaLaObra] = useState(false);
    const [attendeeSearch, setAttendeeSearch] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!selectedObraId) return;
        workersApi.list({ obraId: selectedObraId }).then((res) => {
            if (res.success && res.data) setWorkers(res.data);
        }).catch(() => {});
    }, [selectedObraId]);

    useEffect(() => {
        if (!user?.tenantId) return;
        tenantsApi.getCatalogosActividad(user.tenantId).then((res) => {
            if (res.success && res.data) {
                setCatalogos(res.data.catalogos);
                setPermisosDef(res.data.permisosTrabajoDef);
            }
        }).catch(() => {
            toast.error('No se pudieron cargar los catálogos de actividades. Recarga la página para crear charlas o ART.');
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.tenantId]);

    // Prefill: desde el panel del día del calendario (solo la fecha) o desde
    // "Agendar" en el Equipo de la obra (una capacitación para una persona).
    useEffect(() => {
        const prefill = (location.state as any)?.prefill;
        if (!prefill) return;
        if (prefill.personaId) {
            setForm((prev) => ({
                ...prev,
                tipo: 'CAPACITACION',
                subtipo: prefill.subtipo || 'OTRA',
                titulo: prefill.titulo || '',
                asistentesRequeridos: [prefill.personaId],
                kitItemKey: prefill.kitItemKey || '',
            }));
        } else if (prefill.fecha) {
            setForm((prev) => ({ ...prev, fecha: prefill.fecha }));
        }
        window.history.replaceState({}, ''); // evita reaplicar el prefill al volver
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Trabajadores visibles para un relator: si es supervisor, su cuadrilla; si
    // es prevencionista, los supervisores a su cargo y las cuadrillas de ellos.
    // Si el relator está por encima de la cadena o no hay vínculos cargados,
    // se muestra toda la obra.
    const scopeWorkersFor = (relatorId: string): { list: Worker[]; scoped: boolean } => {
        if (!relatorId) return { list: workers, scoped: false };
        const asigOf = (w: Worker) => (w.asignaciones || []).find((a) => a.obraId === selectedObraId);
        const supsDelPrev = new Set(
            workers.filter((w) => asigOf(w)?.prevencionistaPersonaId === relatorId).map((w) => w.personaId)
        );
        const list = workers.filter((w) => {
            const a = asigOf(w);
            if (!a) return false;
            if (a.supervisorPersonaId === relatorId) return true;
            if (supsDelPrev.has(w.personaId)) return true;
            if (a.supervisorPersonaId && supsDelPrev.has(a.supervisorPersonaId)) return true;
            return false;
        });
        return list.length ? { list, scoped: true } : { list: workers, scoped: false };
    };
    const visibleWorkersFor = (relatorId: string): { list: Worker[]; scoped: boolean } => {
        const s = scopeWorkersFor(relatorId);
        if (verTodaLaObra || !s.scoped) return { list: workers, scoped: s.scoped };
        return s;
    };

    const toggleAttendee = (personaId: string) => {
        setForm((prev) => ({
            ...prev,
            asistentesRequeridos: prev.asistentesRequeridos.includes(personaId)
                ? prev.asistentesRequeridos.filter((id) => id !== personaId)
                : [...prev.asistentesRequeridos, personaId],
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        if (!selectedObraId) {
            setError('Selecciona una obra antes de crear una actividad.');
            return;
        }
        if (!form.titulo) { setError('El título es obligatorio.'); return; }
        if (!form.relatorId) { setError('Debes asignar un relator.'); return; }
        if (['CHARLA_5MIN', 'ART'].includes(form.tipo) && !catalogos) {
            setError('No se pudieron cargar los catálogos de actividades. Recarga la página para crear charlas o ART.');
            return;
        }

        setError('');
        setSubmitting(true);
        try {
            const payload: any = { ...form, obraId: selectedObraId };
            // El subtipo solo aplica a capacitaciones.
            if (payload.tipo !== 'CAPACITACION') delete payload.subtipo;
            // La evaluación viaja como bloque; los flags del form no son del API.
            delete payload.evaluacionExigida;
            delete payload.evaluacionNotaMinima;
            if (payload.tipo === 'CAPACITACION' && form.evaluacionExigida) {
                payload.evaluacion = { exigida: true, notaMinima: form.evaluacionNotaMinima };
            }
            if (!payload.horaFin) delete payload.horaFin;
            if (!payload.ubicacion) delete payload.ubicacion;
            // Periodicidad: validar que la repetición tenga fecha de término.
            if (payload.frecuencia === 'unica') {
                delete payload.frecuencia;
                delete payload.repetirHasta;
            } else if (!payload.repetirHasta) {
                setError('Indica hasta qué fecha se debe repetir la actividad.');
                setSubmitting(false);
                return;
            } else if (payload.repetirHasta < payload.fecha) {
                setError('La fecha de término debe ser posterior a la fecha de inicio.');
                setSubmitting(false);
                return;
            }
            // La planificación completa solo aplica a charlas/ART; para el resto
            // solo viajan las observaciones (si las hay).
            if (!['CHARLA_5MIN', 'ART'].includes(payload.tipo)) {
                const obs = payload.planificacion?.observaciones?.trim();
                payload.planificacion = obs ? { observaciones: obs } : undefined;
                payload.permisosTrabajo = undefined;
            }
            const res = await activitiesApi.create(payload);
            if (res.success && res.data) {
                const data = res.data as any;
                if (data?.serie) {
                    toast.success(`${data.count} actividades creadas (serie ${labelFrecuencia(form.frecuencia)})`);
                } else {
                    toast.success('Actividad creada correctamente');
                }
                navigate('/activities');
            } else {
                setError(res.error || 'Error al crear la actividad.');
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
                <PageHeader banner title="Nueva actividad" description="Selecciona una obra para registrar una actividad." />
            </div>
        );
    }

    const { list: visibles, scoped } = visibleWorkersFor(form.relatorId);

    return (
        <>
            <div className="page-content">
                <PageHeader
                    banner
                    title="Nueva actividad"
                    description="Queda programada y, al iniciar, sus asistentes pueden firmar."
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
                                Se notifica a cada convocado al programarse.
                            </span>
                        )}
                        <button type="button" className="btn btn-secondary" onClick={() => navigate('/activities')}>
                            Cancelar
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={submitting}>
                            {submitting ? 'Creando…' : 'Crear actividad'}
                        </button>
                    </>
                }
            >
                {/* Tipo y detalle */}
                <FieldSection title="Tipo y detalle" inline cols={3}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Tipo de actividad <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                        <Select
                            ariaLabel="Tipo de actividad"
                            value={form.tipo}
                            onChange={(v) => setForm((prev) => ({ ...prev, tipo: v }))}
                            options={Object.entries(ACTIVITY_TYPES).map(([key, { label, icon }]) => ({ value: key, label, icon }))}
                        />
                    </div>
                    {form.tipo === 'CAPACITACION' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                            <label className="form-label">Tipo de capacitación (DS44) <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                            <Select
                                ariaLabel="Tipo de capacitación DS44"
                                placeholder="Selecciona el tipo"
                                searchable
                                value={form.subtipo}
                                onChange={(v) => setForm((prev) => ({ ...prev, subtipo: v }))}
                                options={Object.entries(CAPACITACION_SUBTIPOS).map(([key, label]) => ({ value: key, label }))}
                            />
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Ubicación</label>
                        <input className="form-input" value={form.ubicacion}
                            placeholder="Ej: Frente de obra, sala de charlas…"
                            onChange={(e) => setForm((prev) => ({ ...prev, ubicacion: e.target.value }))} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', gridColumn: '1 / -1' }}>
                        <label className="form-label">Título <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                        <input className="form-input" value={form.titulo}
                            placeholder="Ej: Uso correcto de EPP"
                            onChange={(e) => setForm((prev) => ({ ...prev, titulo: e.target.value }))} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', gridColumn: '1 / -1' }}>
                        <label className="form-label">Descripción</label>
                        <textarea className="form-input" rows={3} value={form.descripcion}
                            placeholder="Descripción de la actividad…" style={{ resize: 'vertical' }}
                            onChange={(e) => setForm((prev) => ({ ...prev, descripcion: e.target.value }))} />
                    </div>

                    {/* Evaluación de aprendizaje: el DS44 no se conforma con que la
                        capacitación se dicte (Art. 13.4 exige registrar las
                        evaluaciones). Se puede activar después desde el detalle,
                        mientras nadie haya rendido. */}
                    {form.tipo === 'CAPACITACION' && (
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label className="ev-check">
                                <input
                                    type="checkbox"
                                    className="checkbox-input custom-checkbox"
                                    checked={form.evaluacionExigida}
                                    onChange={(e) => setForm((prev) => ({ ...prev, evaluacionExigida: e.target.checked }))}
                                />
                                <span>Con evaluación de aprendizaje</span>
                            </label>
                            {form.evaluacionExigida && (
                                <div className="ev-minima-pick">
                                    <span className="form-label">Nota mínima de aprobación</span>
                                    <SegmentedControl
                                        value={String(form.evaluacionNotaMinima)}
                                        onChange={(v) => setForm((prev) => ({ ...prev, evaluacionNotaMinima: Number(v) as 70 | 90 }))}
                                        options={[
                                            { value: '70', label: '70% general' },
                                            { value: '90', label: '90% altura / SPDC' },
                                        ]}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </FieldSection>

                {/* Horario */}
                <FieldSection title="Horario" inline description="La fecha de inicio si se repite periódicamente" cols={3}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">{form.frecuencia === 'unica' ? 'Fecha' : 'Fecha de inicio'} <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                        <input className="form-input" type="date" value={form.fecha}
                            onChange={(e) => setForm((prev) => ({ ...prev, fecha: e.target.value }))} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Hora inicio <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                        <input className="form-input" type="time" value={form.horaInicio}
                            onChange={(e) => setForm((prev) => ({ ...prev, horaInicio: e.target.value }))} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Hora fin</label>
                        <input className="form-input" type="time" value={form.horaFin}
                            onChange={(e) => setForm((prev) => ({ ...prev, horaFin: e.target.value }))} />
                    </div>
                </FieldSection>

                {/* Responsable y repetición */}
                <FieldSection title="Responsable" inline description="El relator queda como primer responsable de la actividad" cols={3}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Relator <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                        <Select
                            ariaLabel="Relator"
                            placeholder="Selecciona un relator"
                            searchable
                            value={form.relatorId}
                            onChange={(v) => setForm((prev) => ({ ...prev, relatorId: v }))}
                            options={workers.map((w) => ({ value: w.personaId, label: `${w.nombre} ${w.apellido || ''}`.trim(), description: w.cargo }))}
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Periodicidad</label>
                        <Select
                            ariaLabel="Periodicidad"
                            value={form.frecuencia}
                            onChange={(v) => setForm((prev) => ({ ...prev, frecuencia: v as typeof prev.frecuencia }))}
                            options={Object.entries(FRECUENCIA_OPCIONES).map(([value, label]) => ({ value, label }))}
                        />
                    </div>
                    {form.frecuencia !== 'unica' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                            <label className="form-label">Repetir hasta <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                            <input className="form-input" type="date" value={form.repetirHasta} min={form.fecha}
                                onChange={(e) => setForm((prev) => ({ ...prev, repetirHasta: e.target.value }))} />
                        </div>
                    )}
                    {form.frecuencia !== 'unica' && (
                        <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                            Se creará una actividad {labelFrecuencia(form.frecuencia)} a las {form.horaInicio || '—'} desde{' '}
                            {form.fecha || '—'}{form.repetirHasta ? ` hasta ${form.repetirHasta}` : ''}.
                        </p>
                    )}
                </FieldSection>

                {/* Planificación del día: solo charlas y ART (DS 44). */}
                {catalogos && ['CHARLA_5MIN', 'ART', 'REUNION_COMITE'].includes(form.tipo) && (
                    <FieldSection title="Planificación del día" inline description="Exigida por el DS 44 para charlas y ART" cols={3}>
                        <PlanificacionDiariaForm
                            value={form.planificacion}
                            onChange={(planificacion) => setForm((prev) => ({ ...prev, planificacion }))}
                            catalogos={catalogos}
                            tipoActividad={form.tipo}
                        />
                    </FieldSection>
                )}

                {/* Permisos de trabajo especiales: solo charlas y ART. */}
                {['CHARLA_5MIN', 'ART'].includes(form.tipo) && Object.keys(permisosDef).length > 0 && (
                    <FieldSection title="Permisos de trabajo especiales" inline description="Solo si la actividad los requiere">
                        <div style={{ gridColumn: '1 / -1' }}>
                            <PermisosTrabajoForm
                                value={form.permisosTrabajo}
                                onChange={(permisosTrabajo) => setForm((prev) => ({ ...prev, permisosTrabajo }))}
                                permisosDef={permisosDef}
                                workers={workers}
                            />
                        </div>
                    </FieldSection>
                )}

                {/* Asistentes requeridos */}
                <FieldSection title="Asistentes requeridos" inline description="Opcional. Quedan convocados y reciben el aviso al programarse.">
                    <div style={{ gridColumn: '1 / -1' }}>
                        <WorkerPicker
                            label="Convocados"
                            variant="flat"
                            workers={visibles}
                            selected={form.asistentesRequeridos}
                            onToggle={toggleAttendee}
                            search={attendeeSearch}
                            onSearchChange={setAttendeeSearch}
                            maxHeight={220}
                            emptyMessage={
                                workers.length === 0
                                    ? 'No hay trabajadores asignados a esta obra.'
                                    : 'Este relator no tiene trabajadores en su grupo. Usa «Ver toda la obra» para elegir de todos modos.'
                            }
                            headerActions={
                                scoped ? (
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVerTodaLaObra((v) => !v)}>
                                        {verTodaLaObra ? 'Ver solo su grupo' : 'Ver toda la obra'}
                                    </button>
                                ) : undefined
                            }
                        />
                    </div>
                </FieldSection>
            </FormPage>

            <style>{`
                .ev-check { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-primary); cursor: pointer; }
                .ev-minima-pick { display: flex; flex-direction: column; gap: 5px; margin-top: var(--space-3); }
            `}</style>
        </>
    );
}
