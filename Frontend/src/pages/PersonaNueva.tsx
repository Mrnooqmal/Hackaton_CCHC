import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { personasApi } from '../api/personas.api';
import { tenantsApi, type TenantRole } from '../api/tenants.api';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { FormPage, FieldSection, Select, CredentialCard } from '../components/ui';
import { FiCheckCircle, FiInfo, FiArrowLeft } from 'react-icons/fi';
import { getCargoLabel } from '../utils/ds44';
import { useCargoCatalog } from '../hooks/useCargoCatalog';

// ── constants ─────────────────────────────────────────────────────────────────

const NIVEL_ESCOLAR_OPTIONS = [
    { value: '', label: 'Sin especificar' },
    { value: 'basica_incompleta', label: 'Básica incompleta' },
    { value: 'basica_completa', label: 'Básica completa' },
    { value: 'media_incompleta', label: 'Media incompleta' },
    { value: 'media_completa', label: 'Media completa' },
    { value: 'tecnica', label: 'Técnica / CFT / IP' },
    { value: 'universitaria', label: 'Universitaria' },
    { value: 'postgrado', label: 'Postgrado' },
];

const RELACION_OPTIONS = [
    { value: '', label: 'Sin especificar' },
    { value: 'conyuge', label: 'Cónyuge / pareja' },
    { value: 'padre_madre', label: 'Padre / madre' },
    { value: 'hijo_hija', label: 'Hijo / hija' },
    { value: 'hermano_hermana', label: 'Hermano / hermana' },
    { value: 'amigo', label: 'Amigo / amiga' },
    { value: 'otro', label: 'Otro' },
];

const INITIAL_FORM = {
    rut: '',
    nombre: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    fechaNacimiento: '',
    email: '',
    telefono: '',
    rol: '',
    cargo: '',
    tieneAccesoWeb: true,
    nivelEscolar: '',
    contactoNombre: '',
    contactoTelefono: '',
    contactoRelacion: '',
};

// ── component ─────────────────────────────────────────────────────────────────

export default function PersonaNueva() {
    const { user } = useAuth();
    const { obras, selectedObraId } = useObraContext();
    const navigate = useNavigate();
    const { options: cargoOptions } = useCargoCatalog();

    const tenantId = user?.tenantId || user?.empresaId || localStorage.getItem('tenant_id') || '';
    const solicitanteId = user?.personaId || (user as any)?.id || undefined;
    const isAdmin = user?.rol === 'admin';

    const [form, setForm] = useState(INITIAL_FORM);
    const [selectedObraIds, setSelectedObraIds] = useState<string[]>(
        selectedObraId ? [selectedObraId] : []
    );
    const [tenantRoles, setTenantRoles] = useState<TenantRole[]>([]);
    const [rutError, setRutError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [success, setSuccess] = useState<{ rut: string; nombre: string; password?: string } | null>(null);

    useEffect(() => {
        if (!tenantId) return;
        tenantsApi.get(tenantId).then(res => {
            if (res.success && res.data?.roles?.length) setTenantRoles(res.data.roles);
        }).catch(() => {});
    }, [tenantId]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        setForm(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
        }));
    };

    const handleRutBlur = async () => {
        if (!form.rut) { setRutError(''); return; }
        try {
            const res = await personasApi.validateRut(form.rut);
            if (!res.success || !res.data) return;
            if (!res.data.valido) { setRutError('RUT inválido.'); return; }
            if (res.data.existe) { setRutError('Este RUT ya está registrado en la empresa.'); return; }
            setRutError('');
        } catch { setRutError(''); }
    };

    const toggleObra = (obraId: string) => {
        setSelectedObraIds(prev =>
            prev.includes(obraId) ? prev.filter(id => id !== obraId) : [...prev, obraId]
        );
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.rut) { setFormError('El RUT es obligatorio.'); return; }
        if (!form.nombre) { setFormError('El nombre es obligatorio.'); return; }
        if (!form.rol) { setFormError('Debes asignar un rol.'); return; }
        if (rutError) { setFormError('Corrige el RUT antes de continuar.'); return; }
        setFormError(''); setIsSubmitting(true);
        try {
            const res = await personasApi.create(tenantId, {
                rut: form.rut,
                nombre: form.nombre,
                apellidoPaterno: form.apellidoPaterno || undefined,
                apellidoMaterno: form.apellidoMaterno || undefined,
                fechaNacimiento: form.fechaNacimiento || undefined,
                email: form.email || undefined,
                telefono: form.telefono || undefined,
                rol: form.rol,
                cargo: form.cargo || undefined,
                tieneAccesoWeb: form.tieneAccesoWeb,
                obraIds: selectedObraIds.length > 0 ? selectedObraIds : undefined,
                solicitanteId,
                nivelEscolar: form.nivelEscolar || undefined,
                contactoEmergencia: (form.contactoNombre || form.contactoTelefono) ? {
                    nombre: form.contactoNombre || undefined,
                    telefono: form.contactoTelefono || undefined,
                    relacion: form.contactoRelacion || undefined,
                } : undefined,
            });
            if (!res.success || !res.data) {
                setFormError(res.error || 'Error al crear la persona.');
                return;
            }
            setSuccess({
                rut: res.data.persona.rut,
                nombre: `${form.nombre} ${form.apellidoPaterno}`.trim(),
                password: res.data.passwordTemporal,
            });
        } catch {
            setFormError('Error de conexión. Intenta nuevamente.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── success state ──────────────────────────────────────────────────────────

    if (success) {
        return (
            <div className="page-content">
                <div style={{ maxWidth: 580, margin: '0 auto', padding: 'var(--space-12) var(--space-6)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-6)', textAlign: 'center' }}>
                        <div style={{
                            width: 68, height: 68, borderRadius: '50%',
                            background: 'rgba(34, 197, 94, 0.1)', border: '2px solid rgba(34, 197, 94, 0.3)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--success-500)',
                        }}>
                            <FiCheckCircle size={30} />
                        </div>
                        <div>
                            <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: '0 0 var(--space-2)', color: 'var(--text-primary)' }}>
                                Persona creada
                            </h1>
                            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
                                {success.nombre} ha sido registrado/a correctamente en la empresa.
                            </p>
                        </div>
                        {success.password && (
                            <CredentialCard rut={success.rut} password={success.password} />
                        )}
                        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                            <button className="btn btn-secondary" onClick={() => { setSuccess(null); setForm(INITIAL_FORM); setSelectedObraIds(selectedObraId ? [selectedObraId] : []); }}>
                                Crear otra persona
                            </button>
                            <button className="btn btn-primary" onClick={() => navigate('/personas', { state: { created: true, rut: success.rut, password: success.password } })}>
                                Ir a personas
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── form ───────────────────────────────────────────────────────────────────

    const rolOptions = [
        { value: '', label: 'Selecciona un rol' },
        ...tenantRoles.map(r => ({ value: r.id, label: r.nombre })),
    ];

    const cargoSelectOptions = [
        { value: '', label: 'Sin cargo específico' },
        ...cargoOptions,
    ];

    return (
        <>
            {/* CChC navy banner */}
            <div style={{
                background: '#002952',
                padding: 'var(--space-5) var(--space-8) 0',
                position: 'relative',
            }}>
                <div style={{ maxWidth: 960, margin: '0 auto' }}>
                    <button
                        type="button"
                        onClick={() => navigate('/personas')}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'rgba(255,255,255,0.7)', fontSize: 'var(--text-sm)', padding: 0,
                            marginBottom: 'var(--space-2)',
                        }}
                    >
                        <FiArrowLeft size={14} /> Personas
                    </button>
                    <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'white', fontFamily: 'var(--font-display)' }}>
                        Nueva persona
                    </h1>
                    <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>
                        Registra un trabajador o colaborador en la empresa.
                    </p>
                </div>
                <div style={{ height: 3, background: 'linear-gradient(90deg, #006edc 0%, #df3601 100%)', marginTop: 'var(--space-6)' }} />
            </div>

            <FormPage
                maxWidth={960}
                onSubmit={handleSubmit}
                header={<></>}
                actions={
                    <>
                        {formError && (
                            <span style={{ marginRight: 'auto', fontSize: 'var(--text-sm)', color: 'var(--danger-600)' }}>
                                {formError}
                            </span>
                        )}
                        <button type="button" className="btn btn-secondary" onClick={() => navigate('/personas')}>
                            Cancelar
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                            {isSubmitting ? 'Creando…' : 'Crear persona'}
                        </button>
                    </>
                }
            >
                {/* Datos personales */}
                <FieldSection title="Datos personales" accent="blue" cols={3}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">RUT <span style={{ color: 'var(--danger-500)' }}>*</span></label>
                        <input
                            className={`form-input${rutError ? ' form-input--error' : ''}`}
                            name="rut"
                            value={form.rut}
                            onChange={e => setForm(prev => ({ ...prev, rut: e.target.value }))}
                            onBlur={handleRutBlur}
                            placeholder="12.345.678-9"
                            autoComplete="off"
                            style={{ fontFamily: 'var(--font-mono)' }}
                        />
                        {rutError && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--danger-600)', marginTop: 2 }}>{rutError}</span>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Nombre <span style={{ color: 'var(--danger-500)' }}>*</span></label>
                        <input className="form-input" name="nombre" value={form.nombre} onChange={handleChange} placeholder="Nombre(s)" autoComplete="given-name" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Apellido paterno</label>
                        <input className="form-input" name="apellidoPaterno" value={form.apellidoPaterno} onChange={handleChange} placeholder="Apellido paterno" autoComplete="family-name" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Apellido materno</label>
                        <input className="form-input" name="apellidoMaterno" value={form.apellidoMaterno} onChange={handleChange} placeholder="Apellido materno" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Fecha de nacimiento</label>
                        <input className="form-input" type="date" name="fechaNacimiento" value={form.fechaNacimiento} onChange={handleChange} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Teléfono</label>
                        <input className="form-input" type="tel" name="telefono" value={form.telefono} onChange={handleChange} placeholder="+56 9 1234 5678" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', gridColumn: '1 / -1' }}>
                        <label className="form-label">Email</label>
                        <input className="form-input" type="email" name="email" value={form.email} onChange={handleChange} placeholder="correo@ejemplo.com" autoComplete="email" style={{ maxWidth: 360 }} />
                    </div>
                </FieldSection>

                {/* Acceso y rol */}
                <div style={{ background: 'var(--surface-elevated)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', border: '1px solid var(--surface-border)' }}>
                    <FieldSection title="Acceso y rol" accent="blue" cols={3} description="Define el nivel de acceso y cargo de esta persona dentro de la empresa.">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                            <label className="form-label">Rol <span style={{ color: 'var(--danger-500)' }}>*</span></label>
                            <Select ariaLabel="Rol" value={form.rol} onChange={v => setForm(prev => ({ ...prev, rol: v }))} options={rolOptions} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                            <label className="form-label">Cargo DS44</label>
                            <Select ariaLabel="Cargo" value={form.cargo} onChange={v => setForm(prev => ({ ...prev, cargo: v }))} options={cargoSelectOptions} />
                            {form.cargo && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{getCargoLabel(form.cargo)}</span>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                            <label className="form-label">Nivel de escolaridad</label>
                            <Select ariaLabel="Nivel de escolaridad" value={form.nivelEscolar} onChange={v => setForm(prev => ({ ...prev, nivelEscolar: v }))} options={NIVEL_ESCOLAR_OPTIONS} />
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', cursor: 'pointer', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--surface-border)', background: form.tieneAccesoWeb ? 'rgba(0,110,220,0.05)' : 'transparent', transition: 'all 0.2s' }}>
                                <input type="checkbox" name="tieneAccesoWeb" checked={form.tieneAccesoWeb} onChange={handleChange} style={{ marginTop: 2 }} />
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>Acceso web</div>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                                        {form.tieneAccesoWeb
                                            ? 'La contraseña temporal serán los primeros 4 dígitos del RUT — la persona la cambia en su primer ingreso.'
                                            : 'La persona solo existe en el sistema, sin credenciales de acceso web.'}
                                    </div>
                                </div>
                            </label>
                        </div>
                    </FieldSection>
                </div>

                {/* Asignación a obras */}
                {obras.length > 0 && (
                    <FieldSection title="Asignación a obras" accent="blue" description="Selecciona las obras a las que se asignará esta persona al momento de crearla. Puedes cambiar esto después desde el perfil.">
                        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                            {selectedObraIds.length > 0 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                                    <FiInfo size={14} style={{ color: 'var(--primary-500)' }} />
                                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                                        {selectedObraIds.length} obra{selectedObraIds.length > 1 ? 's' : ''} seleccionada{selectedObraIds.length > 1 ? 's' : ''}
                                    </span>
                                </div>
                            )}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-2)' }}>
                                {obras.map(obra => {
                                    const checked = selectedObraIds.includes(obra.obraId);
                                    return (
                                        <label
                                            key={obra.obraId}
                                            style={{
                                                display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
                                                padding: 'var(--space-3) var(--space-4)', cursor: 'pointer',
                                                borderRadius: 'var(--radius-md)',
                                                border: `1px solid ${checked ? 'var(--primary-400)' : 'var(--surface-border)'}`,
                                                background: checked ? 'rgba(0,110,220,0.06)' : 'var(--surface-card)',
                                                transition: 'all 0.18s',
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleObra(obra.obraId)}
                                                style={{ marginTop: 2 }}
                                            />
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {obra.nombre}
                                                </div>
                                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 6 }}>
                                                    {obra.codigo && <span style={{ fontFamily: 'monospace' }}>{obra.codigo}</span>}
                                                    {obra.codigo && <span>·</span>}
                                                    <span style={{ fontFamily: 'monospace', opacity: 0.6 }}>{obra.obraId?.slice(0, 8)}…</span>
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                            {!isAdmin && selectedObraId && (
                                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4 }}>
                                    La obra actualmente seleccionada en el sistema está pre-marcada.
                                </p>
                            )}
                        </div>
                    </FieldSection>
                )}

                {/* Contacto de emergencia */}
                <FieldSection title="Contacto de emergencia" description="Datos opcionales para el expediente del trabajador.">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Nombre</label>
                        <input className="form-input" name="contactoNombre" value={form.contactoNombre} onChange={handleChange} placeholder="Nombre del contacto" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Teléfono</label>
                        <input className="form-input" type="tel" name="contactoTelefono" value={form.contactoTelefono} onChange={handleChange} placeholder="+56 9 1234 5678" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Relación</label>
                        <Select ariaLabel="Relación" value={form.contactoRelacion} onChange={v => setForm(prev => ({ ...prev, contactoRelacion: v }))} options={RELACION_OPTIONS} />
                    </div>
                </FieldSection>
            </FormPage>

        </>
    );
}
