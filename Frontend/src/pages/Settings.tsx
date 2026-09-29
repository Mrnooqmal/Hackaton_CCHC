import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { personasApi, type PersonaResponse } from '../api/client';
import { FiLock, FiKey, FiEdit2 } from 'react-icons/fi';
import ConfirmModal from '../components/ConfirmModal';
import { IdentityPanel } from '../components/ui';
import { getCargoLabel } from '../utils/ds44';
import '../css/ficha.css';

const ROLE_LABELS: Record<string, string> = {
    admin: 'Administrador', jefe_obra: 'Jefe de Obra',
    supervisor: 'Supervisor', prevencionista: 'Prevencionista', trabajador: 'Trabajador',
};

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resizeImageToBase64(file: File, maxSize = 320): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = reject;
            img.src = e.target!.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function formatDate(iso?: string | null) {
    if (!iso) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

function parseTelDigits(raw?: string | null) {
    return formatTelDisplay((raw || '').replace(/^\+56\s*/, '').trim());
}

function formatTelDisplay(raw: string) {
    const d = raw.replace(/\D/g, '').slice(0, 9);
    if (d.length > 5) return d[0] + ' ' + d.slice(1, 5) + ' ' + d.slice(5);
    if (d.length > 1) return d[0] + ' ' + d.slice(1);
    return d;
}

// Un campo de solo lectura: rótulo y valor, o un guion si está vacío.
function Campo({ label, value, vacio = '—' }: { label: string; value: React.ReactNode; vacio?: string }) {
    return (
        <div className="pd-campo">
            <span className="pd-label">{label}</span>
            <span className="pd-valor">{value || <span className="pd-vacio">{vacio}</span>}</span>
        </div>
    );
}

/** Un valor que llega con la ficha: mientras tanto, un bloque del alto del renglón. */
const Pendiente = ({ w }: { w: number }) => (
    <span className="set-pendiente" aria-hidden="true"><span className="ui-skel" style={{ width: w, height: 12 }} /></span>
);

export default function Settings() {
    const { user, updateUser } = useAuth();
    const navigate = useNavigate();

    // Nombre, RUT, rol, correo y teléfono vienen con la sesión y se pintan de
    // inmediato; cargo y fecha de nacimiento llegan con la ficha y, mientras,
    // solo esos valores muestran su esqueleto.
    const [persona, setPersona] = useState<PersonaResponse | null>(null);
    const [cargando, setCargando] = useState(true);
    const [photoSaving, setPhotoSaving] = useState(false);
    const [photoSuccess, setPhotoSuccess] = useState(false);

    const [editando, setEditando] = useState(false);
    const [form, setForm] = useState({ email: '', telefono: '' });
    const [base, setBase] = useState({ email: '', telefono: '' });
    const [guardando, setGuardando] = useState(false);
    const [errorCampo, setErrorCampo] = useState<{ email?: string; telefono?: string }>({});
    const [errorGuardar, setErrorGuardar] = useState('');

    const [showPinConfirm, setShowPinConfirm] = useState(false);

    useEffect(() => {
        const tenantId = user?.tenantId || (user as any)?.empresaId;
        const rut = user?.rut;
        if (!tenantId || !rut) { setCargando(false); return; }
        personasApi.getByRut(tenantId, rut)
            .then((res) => { if (res.success && res.data) setPersona(res.data); })
            .finally(() => setCargando(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const initials = [user?.nombre, user?.apellido].filter(Boolean).map((s) => s![0].toUpperCase()).join('');
    const roleLabel = ROLE_LABELS[user?.rol ?? ''] ?? (user?.rol || '—');
    const cargoCodigo = persona?.cargo || (user as any)?.cargo || '';
    const cargo = getCargoLabel(cargoCodigo) || cargoCodigo || 'Sin cargo';
    const fechaNac = formatDate(persona?.fechaNacimiento || (user as any)?.fechaNacimiento);
    const correo = user?.email || persona?.email || '';
    const telefono = user?.telefono || persona?.telefono || '';

    const personaId = (user as any)?.personaId || user?.userId;
    const tenantId = user?.tenantId;

    const handlePhotoChange = async (file: File) => {
        setPhotoSaving(true);
        setPhotoSuccess(false);
        try {
            const base64 = await resizeImageToBase64(file, 320);
            if (personaId && tenantId) await personasApi.update(tenantId, personaId, { fotoPerfil: base64 });
            updateUser({ fotoPerfil: base64 });
            setPhotoSuccess(true);
            setTimeout(() => setPhotoSuccess(false), 2500);
        } catch { /* silent */ } finally {
            setPhotoSaving(false);
        }
    };

    const handleRemovePhoto = async () => {
        setPhotoSaving(true);
        try {
            if (personaId && tenantId) await personasApi.update(tenantId, personaId, { fotoPerfil: null } as any);
            updateUser({ fotoPerfil: undefined });
        } catch { /* silent */ } finally { setPhotoSaving(false); }
    };

    const empezar = () => {
        const f = { email: correo, telefono: parseTelDigits(telefono) };
        setForm(f);
        setBase(f);
        setErrorCampo({});
        setErrorGuardar('');
        setEditando(true);
    };

    const cancelar = () => {
        setEditando(false);
        setErrorCampo({});
        setErrorGuardar('');
    };

    const cambios = (['email', 'telefono'] as const).filter((k) => form[k].trim() !== base[k].trim());

    const guardar = async () => {
        const email = form.email.trim();
        const digitos = form.telefono.replace(/\D/g, '');
        const errores: { email?: string; telefono?: string } = {};
        if (email && !CORREO_RE.test(email)) errores.email = 'Revisa el correo: falta la @ o el dominio.';
        if (digitos && digitos.length !== 9) errores.telefono = 'El número tiene 9 dígitos, por ejemplo 9 1234 5678.';
        setErrorCampo(errores);
        if (Object.keys(errores).length > 0) return;
        if (!personaId || !tenantId) return;

        const payload: { email?: string; telefono?: string } = {};
        if (cambios.includes('email')) payload.email = email;
        if (cambios.includes('telefono')) payload.telefono = digitos ? `+56 ${form.telefono.trim()}` : '';

        setGuardando(true);
        setErrorGuardar('');
        try {
            const res = await personasApi.update(tenantId, personaId, payload);
            if (!res.success) { setErrorGuardar(res.error || 'No se pudieron guardar tus datos.'); return; }
            updateUser(payload);
            setPersona((p) => (p ? { ...p, ...payload } : p));
            setEditando(false);
        } catch {
            setErrorGuardar('Error de conexión al guardar.');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <>
            <div className="page-content">
                <IdentityPanel
                    eyebrow="Tu cuenta"
                    title={[user?.nombre, user?.apellido].filter(Boolean).join(' ') || '—'}
                    image={user?.fotoPerfil}
                    fallback={initials || '?'}
                    meta={[
                        { label: 'RUT', value: user?.rut || '—', mono: true },
                        { label: 'Cargo', value: cargando && !cargoCodigo ? <Pendiente w={96} /> : cargo },
                        { label: 'Rol', value: roleLabel },
                    ]}
                    photo={{
                        onSelect: handlePhotoChange,
                        onRemove: user?.fotoPerfil ? handleRemovePhoto : undefined,
                        saving: photoSaving,
                        success: photoSuccess,
                    }}
                    actions={
                        <>
                            <button className="btn btn-secondary btn-sm" onClick={() => navigate('/change-password')}>
                                <FiLock size={13} /> Cambiar contraseña
                            </button>
                            {(user as any)?.pinConfigurado === false ? (
                                // Sin PIN (se lo restablecieron): no hay nada que confirmar
                                // ni PIN actual que pedir; se crea directo.
                                <button className="btn btn-primary btn-sm" onClick={() => navigate('/enroll-me', { state: { changePin: true } })}>
                                    <FiKey size={13} /> Crear PIN de firma nuevo
                                </button>
                            ) : (
                                <button className="btn btn-secondary btn-sm" onClick={() => setShowPinConfirm(true)}>
                                    <FiKey size={13} /> Cambiar PIN de firma
                                </button>
                            )}
                        </>
                    }
                />

                <div
                    className={`pd-tab${editando ? ' pd-tab--editando' : ''}`}
                    onKeyDown={(e) => { if (e.key === 'Escape' && editando && !guardando) cancelar(); }}
                >
                    <section className={`pd-seccion${editando ? ' pd-seccion--editando' : ''}`} aria-label="Tus datos">
                        <div className="pd-head">
                            <h2 className="pd-titulo">Tus datos</h2>
                            <span className="pd-hint">
                                {editando
                                    ? 'Editando · los cambios se aplican al guardar'
                                    : 'El correo y el teléfono los actualizas tú; el resto lo mantiene tu empresa.'}
                            </span>
                            <span className="pd-head-accion">
                                {editando
                                    ? <span className="pd-modo"><span className="pd-modo-punto" aria-hidden="true" /> Modo edición</span>
                                    : (
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={empezar}>
                                            <FiEdit2 size={13} /> Editar
                                        </button>
                                    )}
                            </span>
                        </div>

                        {editando ? (
                            <div className="pd-rejilla">
                                <label className="pd-input" style={{ animationDelay: '0ms' }}>
                                    <span className="pd-label">Correo electrónico</span>
                                    <input
                                        className="form-input" type="email" autoFocus autoComplete="email"
                                        value={form.email}
                                        aria-invalid={!!errorCampo.email}
                                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    />
                                    {errorCampo.email
                                        ? <span className="pd-ayuda set-error">{errorCampo.email}</span>
                                        : <span className="pd-ayuda">Aquí te llegan los avisos y la recuperación de contraseña.</span>}
                                </label>
                                <label className="pd-input" style={{ animationDelay: '35ms' }}>
                                    <span className="pd-label">Teléfono</span>
                                    <span className={`set-tel${errorCampo.telefono ? ' is-invalid' : ''}`}>
                                        <span className="set-tel-prefijo" aria-hidden="true">+56</span>
                                        <input
                                            type="text" inputMode="numeric" placeholder="9 1234 5678"
                                            aria-label="Número de teléfono" autoComplete="tel-national"
                                            value={form.telefono}
                                            aria-invalid={!!errorCampo.telefono}
                                            onChange={(e) => setForm({ ...form, telefono: formatTelDisplay(e.target.value) })}
                                        />
                                    </span>
                                    {errorCampo.telefono && <span className="pd-ayuda set-error">{errorCampo.telefono}</span>}
                                </label>
                                <div className="pd-solo-lectura">
                                    <Campo label="Fecha de nacimiento" value={fechaNac ? `${fechaNac} · la mantiene tu empresa` : null} />
                                </div>
                            </div>
                        ) : (
                            <div className="pd-rejilla">
                                <Campo label="Correo electrónico" value={correo} vacio="Sin correo" />
                                <Campo label="Teléfono" value={telefono} vacio="Sin teléfono" />
                                <Campo label="Fecha de nacimiento" value={cargando && !fechaNac ? <Pendiente w={110} /> : fechaNac} />
                            </div>
                        )}
                    </section>

                    {editando && (
                        <div className="pd-barra" role="region" aria-label="Edición en curso">
                            <span className="pd-modo-punto" aria-hidden="true" />
                            <span className="pd-barra-texto">Editando tus datos</span>
                            <span className="pd-barra-cambios">
                                · {errorGuardar
                                    ? <span className="set-error">{errorGuardar}</span>
                                    : cambios.length === 0 ? 'sin cambios' : `${cambios.length} ${cambios.length === 1 ? 'campo modificado' : 'campos modificados'}`}
                            </span>
                            <span className="pd-espacio" />
                            <button className="btn btn-secondary" onClick={cancelar} disabled={guardando}>Cancelar</button>
                            <button className="btn btn-primary" onClick={guardar} disabled={guardando || cambios.length === 0}>
                                {guardando ? 'Guardando…' : 'Guardar cambios'}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <ConfirmModal
                isOpen={showPinConfirm}
                title="Cambiar PIN"
                message="¿Estás seguro de que deseas actualizar tu PIN?"
                confirmLabel="Sí, actualizar"
                cancelLabel="Cancelar"
                onConfirm={() => { setShowPinConfirm(false); navigate('/enroll-me', { state: { changePin: true } }); }}
                onCancel={() => setShowPinConfirm(false)}
            />

            <style>{`
                /* Lo propio de esta pantalla; el resto es la ficha compartida (css/ficha.css). */
                .set-pendiente { display: inline-flex; align-items: center; height: 22px; vertical-align: middle; }
                .set-error { color: var(--danger-alerta); }
                .set-tel {
                    display: flex; align-items: center; height: 38px; overflow: hidden;
                    border: 1px solid var(--surface-border); border-radius: 8px; background: var(--surface-elevated);
                    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
                }
                .set-tel:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
                .set-tel.is-invalid { border-color: var(--danger-alerta); }
                .set-tel-prefijo {
                    display: flex; align-items: center; align-self: stretch; padding: 0 12px;
                    border-right: 1px solid var(--surface-border);
                    font-size: 13px; font-weight: 600; color: var(--text-secondary); user-select: none;
                }
                .set-tel input {
                    flex: 1; min-width: 0; height: 100%; padding: 0 12px; border: none; outline: none; background: none;
                    font-family: inherit; font-size: 13.5px; color: var(--text-primary);
                }
                .pd-input .form-input[aria-invalid='true'] { border-color: var(--danger-alerta); }
            `}</style>
        </>
    );
}
