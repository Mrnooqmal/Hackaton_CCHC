import { FiSun } from 'react-icons/fi';
import type { CatalogosActividad, CatalogoItem } from '../../api/client';
import type { PlanificacionActividad } from '../../api/client';
import { Select } from '../ui';

interface Props {
    value: PlanificacionActividad;
    onChange: (next: PlanificacionActividad) => void;
    catalogos: CatalogosActividad;
    /** Los campos de planificación completa solo aplican a CHARLA_5MIN y ART. */
    tipoActividad: string;
}

const OTRO = '__OTRO__';

// Temporada de alta radiación UV en Chile: 1 sep – 31 mar. Solo condiciona el
// AVISO; el campo de protector solar aparece siempre que el trabajo sea exterior.
const esTemporadaUV = () => {
    const mes = new Date().getMonth() + 1;
    return mes >= 9 || mes <= 3;
};

const opciones = (items: CatalogoItem[], conOtro: boolean) => [
    ...items.map((i) => ({ value: i.codigo, label: i.label })),
    ...(conOtro ? [{ value: OTRO, label: 'Otro…' }] : []),
];

/** Desplegable multi-selección simple sobre checkboxes (lista corta). */
function MultiCatalogo({ label, items, seleccion, otro, onToggle, onOtro, requerido = false }: {
    label: string; items: CatalogoItem[]; seleccion: string[]; otro: string | null | undefined;
    onToggle: (codigo: string) => void; onOtro: (texto: string | null) => void; requerido?: boolean;
}) {
    return (
        <div className="form-group">
            <label className="form-label">{label}{requerido ? ' *' : ''}</label>
            <div className="flex flex-col gap-1" style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2)' }}>
                {items.map((i) => (
                    <label key={i.codigo} className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
                        <input type="checkbox" checked={seleccion.includes(i.codigo)} onChange={() => onToggle(i.codigo)} />
                        {i.label}
                    </label>
                ))}
                <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={otro != null} onChange={() => onOtro(otro != null ? null : '')} />
                    Otro…
                </label>
                {otro != null && (
                    <input className="form-input" placeholder="Especificar…" maxLength={200} value={otro} onChange={(e) => onOtro(e.target.value)} />
                )}
            </div>
        </div>
    );
}

export default function PlanificacionDiariaForm({ value, onChange, catalogos, tipoActividad }: Props) {
    const set = (patch: Partial<PlanificacionActividad>) => onChange({ ...value, ...patch });
    const completa = tipoActividad === 'CHARLA_5MIN' || tipoActividad === 'ART';
    const esComite = tipoActividad === 'REUNION_COMITE';

    const toggleEn = (key: 'recursos' | 'riesgos' | 'medidas') => (codigo: string) => {
        const actual = value[key]?.codigos || [];
        const codigos = actual.includes(codigo) ? actual.filter((c) => c !== codigo) : [...actual, codigo];
        set({ [key]: { ...(value[key] || { codigos: [] }), codigos } });
    };
    const otroEn = (key: 'recursos' | 'riesgos' | 'medidas') => (texto: string | null) => {
        set({ [key]: { codigos: value[key]?.codigos || [], otro: texto } });
    };

    const temaValor = value.tema?.otro != null ? OTRO : (value.tema?.codigo || '');

    return (
        <>
            {completa && (
                <>
                    <div className="form-group">
                        <label className="form-label">Tema tratado *</label>
                        <Select
                            ariaLabel="Tema tratado"
                            placeholder="Seleccione el tema"
                            searchable
                            value={temaValor}
                            onChange={(v) => set({ tema: v === OTRO ? { otro: '' } : { codigo: v } })}
                            options={opciones(catalogos.temas, true)}
                        />
                        {value.tema?.otro != null && (
                            <input
                                className="form-input" style={{ marginTop: 'var(--space-2)' }}
                                placeholder="Escribe el tema no listado…" maxLength={200}
                                value={value.tema.otro} onChange={(e) => set({ tema: { otro: e.target.value } })}
                                required
                            />
                        )}
                    </div>

                    <MultiCatalogo label="Recursos utilizados" items={catalogos.recursos}
                        seleccion={value.recursos?.codigos || []} otro={value.recursos?.otro}
                        onToggle={toggleEn('recursos')} onOtro={otroEn('recursos')} />

                    <MultiCatalogo label="Riesgos identificados" items={catalogos.riesgos}
                        seleccion={value.riesgos?.codigos || []} otro={value.riesgos?.otro}
                        onToggle={toggleEn('riesgos')} onOtro={otroEn('riesgos')} />

                    <MultiCatalogo label="Medidas de prevención" items={catalogos.medidas}
                        seleccion={value.medidas?.codigos || []} otro={value.medidas?.otro}
                        onToggle={toggleEn('medidas')} onOtro={otroEn('medidas')} />

                    <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                        <div className="form-group">
                            <label className="form-label">Tipo de trabajo</label>
                            <Select
                                ariaLabel="Tipo de trabajo"
                                placeholder="Interior / exterior"
                                value={value.tipoTrabajo || ''}
                                onChange={(v) => set({
                                    tipoTrabajo: (v || null) as PlanificacionActividad['tipoTrabajo'],
                                    // Al pasar a exterior el protector solar parte activado.
                                    protectorSolar: v === 'exterior' ? (value.protectorSolar ?? true) : null,
                                })}
                                options={[
                                    { value: 'interior', label: 'Interior' },
                                    { value: 'exterior', label: 'Exterior' },
                                ]}
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Condición climática</label>
                            <Select
                                ariaLabel="Condición climática"
                                placeholder="Seleccione"
                                value={value.condicionClimatica || ''}
                                onChange={(v) => set({ condicionClimatica: (v || null) as PlanificacionActividad['condicionClimatica'] })}
                                options={[
                                    { value: 'despejado', label: 'Despejado' },
                                    { value: 'parcial', label: 'Parcialmente nublado' },
                                    { value: 'nublado', label: 'Nublado' },
                                    { value: 'lluvia', label: 'Lluvia' },
                                ]}
                            />
                        </div>
                    </div>

                    {value.tipoTrabajo === 'exterior' && (
                        <div className="form-group">
                            <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={value.protectorSolar ?? true}
                                    onChange={(e) => set({ protectorSolar: e.target.checked })}
                                />
                                <span className="form-label" style={{ margin: 0 }}>Aplicación de protector solar</span>
                            </label>
                            {esTemporadaUV() && (
                                <p className="text-xs" style={{ color: 'var(--warning-600, #b45309)', margin: 'var(--space-1) 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <FiSun size={12} /> Temporada de alta radiación UV (septiembre–marzo)
                                </p>
                            )}
                        </div>
                    )}
                </>
            )}

            <div className="form-group">
                <label className="form-label">{esComite ? 'Participación y consulta' : 'Observaciones'}</label>
                <textarea
                    className="form-input" rows={3} maxLength={4000} style={{ resize: 'vertical' }}
                    placeholder={esComite
                        ? 'Acuerdos, consultas y participación de los trabajadores en la reunión del Comité Paritario…'
                        : 'Observaciones, participación y consultas de los asistentes…'}
                    value={value.observaciones || ''}
                    onChange={(e) => set({ observaciones: e.target.value })}
                />
            </div>
        </>
    );
}
