import type { PermisoTrabajo, PermisoTrabajoTipo, PermisosTrabajoDef } from '../../api/client';
import { Select } from '../ui';

interface WorkerOption { personaId: string; nombre: string; apellido?: string; cargo?: string; }

interface Props {
    value: PermisoTrabajo[];
    onChange: (next: PermisoTrabajo[]) => void;
    permisosDef: PermisosTrabajoDef;
    workers: WorkerOption[];
}

const RESPUESTAS: { value: 'si' | 'no' | 'na'; label: string }[] = [
    { value: 'si', label: 'Sí' },
    { value: 'no', label: 'No' },
    { value: 'na', label: 'N/A' },
];

export default function PermisosTrabajoForm({ value, onChange, permisosDef, workers }: Props) {
    const tipos = Object.keys(permisosDef) as PermisoTrabajoTipo[];

    const permisoDe = (tipo: PermisoTrabajoTipo) => value.find((p) => p.tipo === tipo);

    const toggle = (tipo: PermisoTrabajoTipo) => {
        const existente = permisoDe(tipo);
        if (existente) {
            const tieneDatos = existente.responsableId || Object.keys(existente.checklist).length > 0;
            if (tieneDatos && !window.confirm('Se descartarán los datos de este permiso. ¿Continuar?')) return;
            onChange(value.filter((p) => p.tipo !== tipo));
        } else {
            onChange([...value, { tipo, responsableId: '', horaInicio: '', horaFin: '', ubicacion: '', checklist: {} }]);
        }
    };

    const actualizar = (tipo: PermisoTrabajoTipo, patch: Partial<PermisoTrabajo>) => {
        onChange(value.map((p) => (p.tipo === tipo ? { ...p, ...patch } : p)));
    };

    return (
        <div className="form-group">
            <label className="form-label">Permisos de trabajo especiales</label>
            <div className="flex flex-col gap-2">
                {tipos.map((tipo) => {
                    const def = permisosDef[tipo];
                    const permiso = permisoDe(tipo);
                    return (
                        <div key={tipo} style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                            <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                                <input type="checkbox" checked={!!permiso} onChange={() => toggle(tipo)} />
                                <span className="font-bold">{def.label}</span>
                            </label>

                            {permiso && (
                                <div className="flex flex-col gap-3" style={{ marginTop: 'var(--space-3)' }}>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">Responsable del permiso *</label>
                                        <Select
                                            ariaLabel={`Responsable ${def.label}`}
                                            placeholder="Seleccione responsable"
                                            searchable
                                            value={permiso.responsableId}
                                            onChange={(v) => actualizar(tipo, { responsableId: v })}
                                            options={workers.map((w) => ({
                                                value: w.personaId,
                                                label: `${w.nombre} ${w.apellido || ''}`.trim(),
                                                description: w.cargo,
                                            }))}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2" style={{ gap: 'var(--space-3)' }}>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label className="form-label">Válido desde *</label>
                                            <input type="time" className="form-input" value={permiso.horaInicio}
                                                onChange={(e) => actualizar(tipo, { horaInicio: e.target.value })} />
                                        </div>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label className="form-label">Válido hasta *</label>
                                            <input type="time" className="form-input" value={permiso.horaFin}
                                                onChange={(e) => actualizar(tipo, { horaFin: e.target.value })} />
                                        </div>
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">Ubicación específica</label>
                                        <input className="form-input" maxLength={200} placeholder="Ej: losa piso 4, cámara de alcantarillado norte…"
                                            value={permiso.ubicacion || ''} onChange={(e) => actualizar(tipo, { ubicacion: e.target.value })} />
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted" style={{ marginBottom: 'var(--space-1)' }}>Lista de verificación *</div>
                                        {def.checklist.map((item) => (
                                            <div key={item.key} className="flex items-center justify-between gap-2" style={{ padding: '4px 0' }}>
                                                <span className="text-sm">{item.label}</span>
                                                <div className="flex gap-1">
                                                    {RESPUESTAS.map((r) => (
                                                        <button
                                                            key={r.value} type="button"
                                                            className={`btn btn-sm ${permiso.checklist[item.key] === r.value ? 'btn-primary' : 'btn-secondary'}`}
                                                            onClick={() => actualizar(tipo, { checklist: { ...permiso.checklist, [item.key]: r.value } })}
                                                        >
                                                            {r.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
