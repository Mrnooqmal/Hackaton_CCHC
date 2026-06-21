import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { personasApi } from '../api/personas.api';
import { tenantsApi, type TenantRole } from '../api/tenants.api';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { FormPage, FieldSection, Select, CredentialCard } from '../components/ui';
import { FiCheckCircle, FiInfo, FiArrowLeft, FiPhone } from 'react-icons/fi';
import { getCargoLabel } from '../utils/ds44';
import { useCargoCatalog } from '../hooks/useCargoCatalog';
import type { PersonaResponse } from '../api/types';

// ── helpers ───────────────────────────────────────────────────────────────────

// Formatea el RUT con puntos y guion en tiempo real (igual que en el login).
const rutFormat = (raw: string) => {
    const clean = raw.replace(/[^0-9kK]/g, '').toUpperCase();
    if (clean.length < 2) return clean;
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);
    return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
};

// Formatea la parte local de un teléfono chileno (9 dígitos): "9 1234 5678".
const formatTelLocal = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 9);
    if (digits.length > 5) return digits[0] + ' ' + digits.slice(1, 5) + ' ' + digits.slice(5);
    if (digits.length > 1) return digits[0] + ' ' + digits.slice(1);
    return digits;
};

// Antepone el prefijo +56 al guardar (vacío → undefined).
const telToFull = (local: string) => (local.replace(/\D/g, '') ? `+56 ${local}` : undefined);

// Campo de teléfono con el mismo diseño que la pantalla de enrolamiento (EnrollMe):
// badge 🇨🇱 +56 fijo, formato en vivo y check al completar los 9 dígitos.
function PhoneField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
    const [focused, setFocused] = useState(false);
    const complete = value.replace(/\D/g, '').length === 9;
    const borderColor = complete ? 'var(--success-500)' : focused ? 'var(--accent)' : 'var(--surface-border)';
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label className="form-label">{label}</label>
            <div style={{
                display: 'flex', alignItems: 'center', border: `1.5px solid ${borderColor}`,
                borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', overflow: 'hidden',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                boxShadow: focused ? `0 0 0 3px ${complete ? 'rgba(34,197,94,0.15)' : 'rgba(0,110,220,0.12)'}` : 'none',
                height: '42px',
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '0 12px', height: '100%',
                    borderRight: '1.5px solid var(--surface-border)', background: 'var(--surface-elevated)',
                    flexShrink: 0, userSelect: 'none',
                }}>
                    <span style={{ fontSize: '13px', lineHeight: 1 }}>🇨🇱</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>+56</span>
                </div>
                <input
                    type="text"
                    inputMode="numeric"
                    placeholder="9 1234 5678"
                    value={value}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onChange={(e) => onChange(formatTelLocal(e.target.value))}
                    style={{
                        flex: 1, border: 'none', outline: 'none', background: 'transparent',
                        fontSize: '15px', color: 'var(--text-primary)', padding: '0 10px', caretColor: 'var(--accent)',
                    }}
                />
                <div style={{
                    paddingRight: '12px', display: 'flex', alignItems: 'center',
                    opacity: complete ? 1 : 0, transform: complete ? 'scale(1)' : 'scale(0.5)',
                    transition: 'opacity 0.25s, transform 0.25s',
                }}>
                    <FiCheckCircle size={16} style={{ color: 'var(--success-500)' }} />
                </div>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Formato: +56 9 1234 5678</span>
        </div>
    );
}

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
    const [personas, setPersonas] = useState<PersonaResponse[]>([]);
    // Supervisor (cuadrilla) elegido por obra cuando el rol es "persona trabajadora".
    const [obraSupervisores, setObraSupervisores] = useState<Record<string, string>>({});
    const [rutError, setRutError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [success, setSuccess] = useState<{ rut: string; nombre: string; password?: string } | null>(null);

    useEffect(() => {
        if (!tenantId) return;
        tenantsApi.get(tenantId).then(res => {
            if (res.success && res.data?.roles?.length) setTenantRoles(res.data.roles);
        }).catch(() => {});
        // Personas del tenant → para resolver los supervisores de cada obra.
        personasApi.list(tenantId).then(res => {
            if (res.success && res.data?.personas) setPersonas(res.data.personas);
        }).catch(() => {});
    }, [tenantId]);

    // Rol seleccionado y si es una "persona trabajadora" (requiere cuadrilla).
    const selectedRole = tenantRoles.find(r => r.id === form.rol);
    const esTrabajador = selectedRole?.tipo === 'trabajador';

    // Supervisores activos asignados a una obra concreta.
    const supervisoresDeObra = (obraId: string) =>
        personas.filter(p =>
            p.rolTipo === 'supervisor'
            && p.estado !== 'inactivo' && p.estado !== 'desvinculado'
            && Array.isArray(p.obraIds) && p.obraIds.includes(obraId)
        );

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
                telefono: telToFull(form.telefono),
                rol: form.rol,
                cargo: form.cargo || undefined,
                tieneAccesoWeb: form.tieneAccesoWeb,
                obraIds: selectedObraIds.length > 0 ? selectedObraIds : undefined,
                solicitanteId,
                nivelEscolar: form.nivelEscolar || undefined,
                contactoEmergencia: (form.contactoNombre || form.contactoTelefono) ? {
                    nombre: form.contactoNombre || undefined,
                    telefono: telToFull(form.contactoTelefono),
                    relacion: form.contactoRelacion || undefined,
                } : undefined,
            });
            if (!res.success || !res.data) {
                setFormError(res.error || 'Error al crear la persona.');
                return;
            }

            // Si es persona trabajadora, fija el supervisor (cuadrilla) elegido por obra.
            if (esTrabajador) {
                const nuevoId = res.data.persona.personaId;
                const cargos = form.cargo ? [form.cargo] : [];
                for (const obraId of selectedObraIds) {
                    const supId = obraSupervisores[obraId];
                    if (!supId) continue;
                    try {
                        await personasApi.setAsignacion(tenantId, nuevoId, obraId, cargos, solicitanteId, supId);
                    } catch { /* la asignación a la obra ya quedó; el supervisor se puede fijar luego */ }
                }
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
                            <button className="btn btn-secondary" onClick={() => { setSuccess(null); setForm(INITIAL_FORM); setSelectedObraIds(selectedObraId ? [selectedObraId] : []); setObraSupervisores({}); }}>
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
                        Registra una persona trabajadora o miembro del equipo en la empresa.
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
                            onChange={e => setForm(prev => ({ ...prev, rut: rutFormat(e.target.value) }))}
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
                    <PhoneField label="Teléfono" value={form.telefono} onChange={v => setForm(prev => ({ ...prev, telefono: v }))} />
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
                                    const sups = supervisoresDeObra(obra.obraId);
                                    return (
                                        <div
                                            key={obra.obraId}
                                            style={{
                                                borderRadius: 'var(--radius-md)',
                                                border: `1px solid ${checked ? 'var(--primary-400)' : 'var(--surface-border)'}`,
                                                background: checked ? 'rgba(0,110,220,0.06)' : 'var(--surface-card)',
                                                transition: 'all 0.18s', overflow: 'hidden',
                                            }}
                                        >
                                            <label
                                                style={{
                                                    display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
                                                    padding: 'var(--space-3) var(--space-4)', cursor: 'pointer',
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
                                            {checked && esTrabajador && (
                                                <div style={{ padding: '0 var(--space-4) var(--space-3)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    <label className="form-label" style={{ fontSize: 'var(--text-xs)' }}>Asignar a supervisor</label>
                                                    {sups.length > 0 ? (
                                                        <Select
                                                            ariaLabel={`Supervisor en ${obra.nombre}`}
                                                            value={obraSupervisores[obra.obraId] || ''}
                                                            onChange={v => setObraSupervisores(prev => ({ ...prev, [obra.obraId]: v }))}
                                                            options={[
                                                                { value: '', label: '— Sin asignar —' },
                                                                ...sups.map(s => ({ value: s.personaId, label: `${s.nombre} ${s.apellido || ''}`.trim() })),
                                                            ]}
                                                        />
                                                    ) : (
                                                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--warning-600, #b45309)' }}>
                                                            No hay supervisores en esta obra. Podrás asignarlo después desde el equipo de la obra.
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
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
                        <label className="form-label">Nombre completo</label>
                        <input className="form-input" name="contactoNombre" value={form.contactoNombre} onChange={handleChange} placeholder="Nombre completo del contacto" />
                    </div>
                    <PhoneField label="Teléfono" value={form.contactoTelefono} onChange={v => setForm(prev => ({ ...prev, contactoTelefono: v }))} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Relación</label>
                        <Select ariaLabel="Relación" value={form.contactoRelacion} onChange={v => setForm(prev => ({ ...prev, contactoRelacion: v }))} options={RELACION_OPTIONS} />
                    </div>
                </FieldSection>
            </FormPage>

        </>
    );
}
