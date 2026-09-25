import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { personasApi, type PersonaResponse } from '../api/client';
import {
    FiCheckCircle, FiLock, FiMail, FiPhone, FiCalendar,
    FiSave, FiEdit2, FiX, FiKey, FiMessageSquare
} from 'react-icons/fi';
import ConfirmModal from '../components/ConfirmModal';
import { IdentityPanel } from '../components/ui';
import { getCargoLabel } from '../utils/ds44';

const ROLE_LABELS: Record<string, string> = {
    admin: 'Administrador', jefe_obra: 'Jefe de Obra',
    supervisor: 'Supervisor', prevencionista: 'Prevencionista', trabajador: 'Trabajador',
};

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
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
}

function parseTelDigits(raw?: string) {
    return (raw || '').replace(/^\+56\s*/, '').trim();
}

function formatTelDisplay(raw: string) {
    const d = raw.replace(/\D/g, '').slice(0, 9);
    if (d.length > 5) return d[0] + ' ' + d.slice(1, 5) + ' ' + d.slice(5);
    if (d.length > 1) return d[0] + ' ' + d.slice(1);
    return d;
}

export default function Settings() {
    const { user, updateUser } = useAuth();
    const navigate = useNavigate();

    const [persona, setPersona] = useState<PersonaResponse | null>(null);
    const [photoSaving, setPhotoSaving] = useState(false);
    const [photoSuccess, setPhotoSuccess] = useState(false);

    const [telEditing, setTelEditing] = useState(false);
    const [telValue, setTelValue] = useState(() => parseTelDigits(user?.telefono));
    const [telFocused, setTelFocused] = useState(false);
    const [telSaving, setTelSaving] = useState(false);

    const [notificacionesSms, setNotificacionesSms] = useState(() => user?.notificacionesSms ?? false);
    const [smsSaving, setSmsSaving] = useState(false);

    const [showPinConfirm, setShowPinConfirm] = useState(false);

    useEffect(() => {
        const tenantId = user?.tenantId || (user as any)?.empresaId;
        const rut = user?.rut;
        if (tenantId && rut) {
            personasApi.getByRut(tenantId, rut).then(res => {
                if (res.success && res.data) {
                    setPersona(res.data);
                    if (!user?.telefono && res.data.telefono) {
                        setTelValue(parseTelDigits(res.data.telefono));
                    }
                }
            });
        }
    }, []);

    const initials = [user?.nombre, user?.apellido].filter(Boolean).map(s => s![0].toUpperCase()).join('');
    const roleLabel = ROLE_LABELS[user?.rol ?? ''] ?? (user?.rol || '—');
    const cargoCodigo = persona?.cargo || (user as any)?.cargo || '';
    const cargo = getCargoLabel(cargoCodigo) || cargoCodigo || '—';
    const fechaNac = formatDate(persona?.fechaNacimiento || (user as any)?.fechaNacimiento);
    const telefonoDisplay = user?.telefono || persona?.telefono || '—';

    const handlePhotoChange = async (file: File) => {
        setPhotoSaving(true);
        setPhotoSuccess(false);
        try {
            const base64 = await resizeImageToBase64(file, 320);
            const id = (user as any)?.personaId || user?.userId;
            const tid = user?.tenantId;
            if (id && tid) await personasApi.update(tid, id, { fotoPerfil: base64 });
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
            const id = (user as any)?.personaId || user?.userId;
            const tid = user?.tenantId;
            if (id && tid) await personasApi.update(tid, id, { fotoPerfil: null } as any);
            updateUser({ fotoPerfil: undefined });
        } catch { /* silent */ } finally { setPhotoSaving(false); }
    };

    const cancelTel = () => {
        setTelValue(parseTelDigits(user?.telefono || persona?.telefono));
        setTelEditing(false);
    };

    const saveTelefono = async () => {
        setTelSaving(true);
        const digits = telValue.replace(/\D/g, '');
        const full = digits.length >= 1 ? `+56 ${telValue}` : '';
        try {
            const id = (user as any)?.personaId || user?.userId;
            const tid = user?.tenantId;
            if (id && tid) await personasApi.update(tid, id, { telefono: full });
            updateUser({ telefono: full });
            setTelEditing(false);
        } catch { /* silent */ } finally { setTelSaving(false); }
    };

    const toggleSms = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVal = e.target.checked;
        setNotificacionesSms(newVal);
        setSmsSaving(true);
        try {
            const id = (user as any)?.personaId || user?.userId;
            const tid = user?.tenantId;
            if (id && tid) await personasApi.update(tid, id, { notificacionesSms: newVal });
            updateUser({ notificacionesSms: newVal });
        } catch { setNotificacionesSms(!newVal); } finally { setSmsSaving(false); }
    };

    const telComplete = telValue.replace(/\D/g, '').length === 9;

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
                        { label: 'Cargo', value: cargo },
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
                            <button className="btn btn-secondary btn-sm" onClick={() => setShowPinConfirm(true)}>
                                <FiKey size={13} /> Cambiar PIN de firma
                            </button>
                        </>
                    }
                />

                {/* ── Datos de identidad ── */}
                <section className="idp-section">
                    <div className="idp-section-head">
                        <div>
                            <h2 className="idp-section-title">Tus datos</h2>
                            <div className="idp-section-sub">El teléfono lo actualizas tú; el resto lo mantiene tu empresa.</div>
                        </div>
                    </div>

                    <div className="idp-fields">
                            {[
                                { icon: <FiCalendar size={12} />, label: 'Fecha de nacimiento', value: fechaNac },
                                { icon: <FiMail size={12} />,     label: 'Correo electrónico',  value: user?.email || persona?.email || '—' },
                            ].map(({ icon, label, value }) => (
                                <div key={label} className="idp-field">
                                    <span className="idp-field-label">{icon} {label}</span>
                                    <div className="idp-field-value">{value}</div>
                                </div>
                            ))}

                            {/* Teléfono — el único dato de identidad que editas tú */}
                            <div className={`idp-field${telEditing ? ' idp-field--wide' : ''}`}>
                                <span className="idp-field-label"><FiPhone size={12} /> Teléfono</span>
                                {telEditing ? (
                                    <div className="sett-tel-edit-row">
                                        <div className={`sett-tel-input${telFocused ? ' is-focused' : ''}`}>
                                            <span className="sett-tel-prefix">
                                                <span aria-hidden="true">🇨🇱</span>
                                                <span>+56</span>
                                            </span>
                                            <input
                                                type="text" inputMode="numeric" placeholder="9 1234 5678"
                                                aria-label="Número de teléfono"
                                                value={telValue} autoFocus
                                                onFocus={() => setTelFocused(true)}
                                                onBlur={() => setTelFocused(false)}
                                                onChange={e => setTelValue(formatTelDisplay(e.target.value))}
                                                className="sett-tel-field"
                                            />
                                            {telComplete && <FiCheckCircle size={14} className="sett-tel-ok" />}
                                        </div>
                                        <button className="btn btn-primary btn-sm" onClick={saveTelefono} disabled={telSaving}>
                                            {telSaving ? <span className="idp-spinner sett-spinner-sm" /> : <><FiSave size={13} /> Guardar</>}
                                        </button>
                                        <button className="btn btn-ghost btn-sm" onClick={cancelTel} disabled={telSaving} aria-label="Cancelar">
                                            <FiX size={14} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="idp-field-row">
                                        <span className="idp-field-value">{telefonoDisplay}</span>
                                        <button className="btn btn-ghost btn-sm idp-field-action" onClick={() => setTelEditing(true)}>
                                            <FiEdit2 size={13} /> Editar
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Notificaciones por SMS */}
                            <div className="idp-field">
                                <span className="idp-field-label"><FiMessageSquare size={12} /> Notificaciones por SMS</span>
                                <label className={`sett-sms${smsSaving ? ' is-busy' : ''}`}>
                                    <span className="idp-field-value">
                                        Avisos cuando algo necesita tu firma
                                    </span>
                                    <input
                                        type="checkbox"
                                        className="sett-sms-box"
                                        checked={notificacionesSms}
                                        disabled={smsSaving}
                                        onChange={toggleSms}
                                    />
                                </label>
                            </div>
                        </div>
                </section>
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
                /* Lo específico de esta pantalla. La credencial, la rejilla de
                   campos y las secciones son compartidas: viven en components.css
                   junto a IdentityPanel, para que la ficha de persona y la
                   cuenta propia no se separen con el tiempo. */
                /* ── Teléfono ── */
                .sett-tel-edit-row {
                    display: flex; align-items: center; gap: var(--space-2);
                    margin-top: 2px;
                }
                .sett-tel-input {
                    display: flex; align-items: center; height: 36px; flex: 1; min-width: 0;
                    border: 1.5px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    background: var(--surface-elevated);
                    overflow: hidden;
                    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
                }
                .sett-tel-input.is-focused {
                    border-color: var(--accent);
                    box-shadow: 0 0 0 3px var(--accent-tint);
                }
                .sett-tel-prefix {
                    display: flex; align-items: center; gap: 5px;
                    align-self: stretch; padding: 0 9px;
                    border-right: 1.5px solid var(--surface-border);
                    background: var(--surface-card);
                    font-size: 12px; font-weight: 600; color: var(--text-muted);
                    flex-shrink: 0; user-select: none;
                }
                .sett-tel-field {
                    flex: 1; min-width: 0;
                    border: none; outline: none; background: transparent;
                    padding: 0 8px;
                    font-size: 14px; color: var(--text-primary);
                    caret-color: var(--accent);
                }
                .sett-tel-ok { color: var(--success-500); flex-shrink: 0; margin-right: 8px; }
                .sett-spinner-sm { width: 13px; height: 13px; }

                /* ── Aviso por SMS ── */
                /* Fila, no caja: la etiqueta ya está arriba y la caja era el
                   elemento más pesado de la página una vez quitadas las tarjetas.
                   Toda la fila es el objetivo de clic. */
                .sett-sms {
                    display: flex; align-items: center; justify-content: space-between;
                    gap: var(--space-4);
                    cursor: pointer;
                }
                .sett-sms.is-busy { opacity: 0.6; cursor: default; }
                .sett-sms-box {
                    width: 17px; height: 17px; flex-shrink: 0;
                    accent-color: var(--accent);
                    cursor: inherit;
                }

                @media (max-width: 600px) {
                    .sett-tel-edit-row { flex-wrap: wrap; }
                }
            `}</style>
        </>
    );
}