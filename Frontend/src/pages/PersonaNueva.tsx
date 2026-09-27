import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { personasApi } from '../api/personas.api';
import { tenantsApi, type TenantRole } from '../api/tenants.api';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { FormPage, FieldSection, Select, CredentialCard, PageHeader } from '../components/ui';
import { FiCheckCircle } from 'react-icons/fi';
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
                display: 'flex', alignItems: 'center', border: `1px solid ${borderColor}`,
                borderRadius: '8px', background: 'none', overflow: 'hidden',
                transition: 'border-color 0.2s',
                height: '38px',
            }}>
                {/* El prefijo es parte del campo, no una pastilla aparte: con el
                    fondo transparente del lienzo, el bloque gris sobraba. */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '0 0 0 12px', height: '100%',
                    flexShrink: 0, userSelect: 'none',
                }}>
                    <span style={{ fontSize: '12px', lineHeight: 1 }}>🇨🇱</span>
                    <span style={{ fontSize: '13.5px', color: 'var(--text-secondary)' }}>+56</span>
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
                        fontSize: '13.5px', color: 'var(--text-primary)', padding: '0 10px', caretColor: 'var(--accent)',
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
            const res = await personasApi.validateRut(form.rut, tenantId);
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
                // Toda persona dada de alta accede al sistema: firma, encuestas y
                // su onboarding pasan por ahí. Era un interruptor en el formulario
                // que nadie apagaba, y apagarlo dejaba a la persona sin forma de
                // firmar. Si alguna vez hay que registrar a alguien sin acceso,
                // el backend ya resuelve el caso omitiendo este campo (lo deduce
                // del rol), pero eso se decide por rol, no por casilla.
                tieneAccesoWeb: true,
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

    // Dedup por id (y por nombre normalizado) para no mostrar roles repetidos en el
    // selector cuando el catálogo del tenant trae duplicados.
    const rolOptions = [
        { value: '', label: 'Selecciona un rol' },
        ...(() => {
            const seen = new Set<string>();
            const out: { value: string; label: string }[] = [];
            for (const r of tenantRoles) {
                // Se deduplica por NOMBRE normalizado (lo que se muestra): dos roles con
                // el mismo nombre pero distinto id (ej. 'jefe_obra' y 'Jefe de Obra')
                // no deben aparecer repetidos en el selector.
                const key = (r.nombre || r.id || '').toLowerCase().trim().replace(/\s+/g, ' ');
                if (!key || seen.has(key)) continue;
                seen.add(key);
                out.push({ value: r.id, label: r.nombre });
            }
            return out;
        })(),
    ];

    const cargoSelectOptions = [
        { value: '', label: 'Sin cargo específico' },
        ...cargoOptions,
    ];

    return (
        <>
            <div className="page-content">
                <PageHeader
                    banner
                    title="Nueva persona"
                    description="Queda registrada en la empresa. La asignación a obras puede cambiarse después."
                />
            </div>

            <FormPage
                maxWidth={960}
                onSubmit={handleSubmit}
                header={<></>}
                actions={
                    <>
                        {formError ? (
                            <span style={{ marginRight: 'auto', fontSize: 'var(--text-sm)', color: 'var(--danger-600)' }}>
                                {formError}
                            </span>
                        ) : (
                            <span style={{ marginRight: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
                                Al crearla se genera su clave de primer acceso.
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
                <FieldSection title="Datos personales" inline cols={3}>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Correo</label>
                        <input className="form-input" type="email" name="email" value={form.email} onChange={handleChange} placeholder="correo@ejemplo.com" autoComplete="email" />
                    </div>
                </FieldSection>

                {/* Acceso y rol. Ya no va en una tarjeta propia: era la única
                    sección enmarcada del formulario y el marco la hacía leer como
                    otra cosa, no como un bloque más de la misma ficha. */}
                <FieldSection title="Acceso y rol" inline cols={3} description="El cargo define qué exige el DS 44 a esta persona.">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Rol <span style={{ color: 'var(--danger-500)' }}>*</span></label>
                        <Select ariaLabel="Rol" value={form.rol} onChange={v => setForm(prev => ({ ...prev, rol: v }))} options={rolOptions} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Cargo</label>
                        <Select ariaLabel="Cargo" value={form.cargo} onChange={v => setForm(prev => ({ ...prev, cargo: v }))} options={cargoSelectOptions} />
                        {form.cargo && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{getCargoLabel(form.cargo)}</span>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Nivel de escolaridad</label>
                        <Select ariaLabel="Nivel de escolaridad" value={form.nivelEscolar} onChange={v => setForm(prev => ({ ...prev, nivelEscolar: v }))} options={NIVEL_ESCOLAR_OPTIONS} />
                    </div>
                </FieldSection>

                {/* Asignación a obras */}
                {obras.length > 0 && (
                    <FieldSection title="Asignación a obras" inline description="Opcional. Al asignarla a una obra empieza su onboarding DS 44.">
                        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                            {/* La cuadrilla se elige EN la misma fila de la obra: es
                                un dato de esa asignación, no una sección aparte. El
                                recuento de obras marcadas sobraba, porque las marcas
                                ya están a la vista. */}
                            <div className="pn-obras">
                                {obras.map(obra => {
                                    const checked = selectedObraIds.includes(obra.obraId);
                                    const sups = supervisoresDeObra(obra.obraId);
                                    return (
                                        <div key={obra.obraId} className={`pn-obra${checked ? ' pn-obra--on' : ''}`}>
                                            <label className="pn-obra-main">
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => toggleObra(obra.obraId)}
                                                />
                                                <span className="pn-obra-info">
                                                    <span className="pn-obra-name">{obra.nombre}</span>
                                                    <span className="pn-obra-meta">
                                                        {obra.codigo && <>{obra.codigo}{obra.comuna ? ' · ' : ''}</>}
                                                        {obra.comuna}
                                                    </span>
                                                </span>
                                            </label>
                                            {checked && esTrabajador && (
                                                sups.length > 0 ? (
                                                    <div className="pn-obra-sup">
                                                        <Select
                                                            ariaLabel={`Cuadrilla en ${obra.nombre}`}
                                                            value={obraSupervisores[obra.obraId] || ''}
                                                            onChange={v => setObraSupervisores(prev => ({ ...prev, [obra.obraId]: v }))}
                                                            options={[
                                                                { value: '', label: 'Cuadrilla: sin asignar' },
                                                                ...sups.map(sup => ({ value: sup.personaId, label: `Cuadrilla: ${sup.nombre} ${sup.apellido || ''}`.trim() })),
                                                            ]}
                                                        />
                                                    </div>
                                                ) : (
                                                    <span className="pn-obra-warn">
                                                        Sin supervisores: podrás asignarle cuadrilla desde el equipo de la obra.
                                                    </span>
                                                )
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
                <FieldSection title="Contacto de emergencia" inline cols={3} description="Opcional. Va al expediente del trabajador.">
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

            <style>{`
                .pn-obras { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
                .pn-obra {
                    display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
                    padding: 12px 14px;
                    border: 1px solid var(--surface-border); border-radius: 10px;
                    transition: border-color 0.18s;
                }
                .pn-obra--on { border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
                .pn-obra-main {
                    display: flex; align-items: center; gap: var(--space-3);
                    flex: 1; min-width: 0; cursor: pointer;
                }
                .pn-obra-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
                .pn-obra-name {
                    font-size: 13px; font-weight: 600; color: var(--text-primary);
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                }
                .pn-obra-meta { font-size: 11px; color: var(--text-muted); }
                .pn-obra-sup { width: 190px; flex-shrink: 0; }
                .pn-obra-warn { font-size: 11px; color: var(--danger-alerta); flex-basis: 100%; }
                @media (max-width: 760px) {
                    .pn-obras { grid-template-columns: 1fr; }
                    .pn-obra-sup { width: 100%; }
                }
            `}</style>
        </>
    );
}
