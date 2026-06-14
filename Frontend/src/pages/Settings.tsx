import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { personasApi, type PersonaResponse } from '../api/client';
import {
    FiCamera, FiCheckCircle, FiLock, FiMail, FiCreditCard,
    FiShield, FiBriefcase, FiPhone, FiCalendar, FiUser, FiSave, FiEdit2, FiX
} from 'react-icons/fi';

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
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [persona, setPersona] = useState<PersonaResponse | null>(null);
    const [photoSaving, setPhotoSaving] = useState(false);
    const [photoSuccess, setPhotoSuccess] = useState(false);
    const [avatarHover, setAvatarHover] = useState(false);

    const [telEditing, setTelEditing] = useState(false);
    const [telValue, setTelValue] = useState(() => parseTelDigits(user?.telefono));
    const [telFocused, setTelFocused] = useState(false);
    const [telSaving, setTelSaving] = useState(false);
    const [telSuccess, setTelSuccess] = useState(false);

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
    const fullName = [user?.nombre, user?.apellido].filter(Boolean).join(' ') || '—';
    const roleLabel = ROLE_LABELS[user?.rol ?? ''] ?? (user?.rol || '—');
    const cargo = persona?.cargo || (user as any)?.cargo || '—';
    const fechaNac = formatDate(persona?.fechaNacimiento || (user as any)?.fechaNacimiento);
    const telefonoDisplay = user?.telefono || persona?.telefono || '—';

    const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
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
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleRemovePhoto = async () => {
        setPhotoSaving(true);
        try {
            const id = (user as any)?.personaId || user?.userId;
            const tid = user?.tenantId;
            if (id && tid) await personasApi.update(tid, id, { fotoPerfil: null });
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
            setTelSuccess(true);
            setTelEditing(false);
            setTimeout(() => setTelSuccess(false), 2500);
        } catch { /* silent */ } finally { setTelSaving(false); }
    };

    const telComplete = telValue.replace(/\D/g, '').length === 9;
    const telBorderColor = telFocused ? 'var(--accent)' : 'var(--surface-border)';

    return (
        <>
            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">Configuración</h2>
                        <p className="page-header-description">Tu perfil y preferencias de la cuenta.</p>
                    </div>
                </div>

                {/* ── Photo hero ── */}
                <div className="card sett-hero-card">
                    <div
                        className="sett-avatar-wrap"
                        onMouseEnter={() => setAvatarHover(true)}
                        onMouseLeave={() => setAvatarHover(false)}
                        onClick={() => fileInputRef.current?.click()}
                        title="Cambiar foto de perfil"
                    >
                        <div className="sett-avatar">
                            {user?.fotoPerfil
                                ? <img src={user.fotoPerfil} alt={initials} className="sett-avatar-img" />
                                : <span className="sett-avatar-initials">{initials || '?'}</span>}
                        </div>
                        <div className={`sett-avatar-overlay${avatarHover || photoSaving ? ' visible' : ''}`}>
                            {photoSaving
                                ? <span className="sett-spinner sett-spinner-white" />
                                : photoSuccess
                                ? <FiCheckCircle size={24} />
                                : <><FiCamera size={20} /><span>Cambiar foto</span></>}
                        </div>
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />

                    <div className="sett-hero-info">
                        <h3 className="sett-hero-name">{fullName}</h3>
                        <span className="sett-role-pill">{roleLabel}</span>
                        <div className="sett-photo-actions">
                            <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={photoSaving}>
                                <FiCamera size={13} /> {photoSaving ? 'Guardando…' : 'Cambiar foto'}
                            </button>
                            {user?.fotoPerfil && (
                                <button className="btn btn-ghost btn-sm" onClick={handleRemovePhoto} disabled={photoSaving} style={{ color: 'var(--text-muted)' }}>
                                    Quitar foto
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Data card ── */}
                <div className="card sett-data-card">
                    <h4 className="sett-section-title">Datos de identidad</h4>
                    <div className="sett-fields">

                        {/* Static fields */}
                        {[
                            { icon: <FiUser size={13} />,       label: 'Nombre completo',     value: fullName },
                            { icon: <FiCreditCard size={13} />, label: 'RUT',                 value: user?.rut || '—' },
                            { icon: <FiCalendar size={13} />,   label: 'Fecha de nacimiento', value: fechaNac },
                            { icon: <FiMail size={13} />,       label: 'Correo electrónico',  value: user?.email || persona?.email || '—' },
                            { icon: <FiShield size={13} />,     label: 'Rol en el sistema',   value: roleLabel },
                            { icon: <FiBriefcase size={13} />,  label: 'Cargo',               value: cargo },
                        ].map(({ icon, label, value }) => (
                            <div key={label} className="sett-field-row">
                                <span className="sett-field-label">{icon} {label}</span>
                                <span className="sett-field-value">{value}</span>
                            </div>
                        ))}

                        {/* Phone — editable */}
                        <div className="sett-field-row">
                            <span className="sett-field-label"><FiPhone size={13} /> Teléfono</span>
                            {telEditing ? (
                                <div className="sett-tel-edit-row">
                                    <div style={{
                                        display: 'flex', alignItems: 'center',
                                        border: `1.5px solid ${telBorderColor}`,
                                        borderRadius: 'var(--radius-md)',
                                        background: 'var(--surface-elevated)',
                                        overflow: 'hidden',
                                        flex: 1,
                                        transition: 'border-color 0.2s, box-shadow 0.2s',
                                        boxShadow: telFocused ? '0 0 0 3px rgba(0,110,220,0.12)' : 'none',
                                        height: '36px',
                                    }}>
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: '5px',
                                            padding: '0 9px', alignSelf: 'stretch',
                                            borderRight: '1.5px solid var(--surface-border)',
                                            background: 'var(--surface-card)',
                                            flexShrink: 0, userSelect: 'none',
                                        }}>
                                            <span style={{ fontSize: '12px' }}>🇨🇱</span>
                                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>+56</span>
                                        </div>
                                        <input
                                            type="text" inputMode="numeric" placeholder="9 1234 5678"
                                            value={telValue} autoFocus
                                            onFocus={() => setTelFocused(true)}
                                            onBlur={() => setTelFocused(false)}
                                            onChange={e => setTelValue(formatTelDisplay(e.target.value))}
                                            style={{
                                                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                                                fontSize: '14px', color: 'var(--text-primary)',
                                                padding: '0 8px', caretColor: 'var(--accent)',
                                            }}
                                        />
                                        {telComplete && <FiCheckCircle size={14} style={{ color: 'var(--success-500)', flexShrink: 0, marginRight: 8 }} />}
                                    </div>
                                    <button className="btn btn-primary btn-sm" onClick={saveTelefono} disabled={telSaving} style={{ flexShrink: 0 }}>
                                        {telSaving ? <span className="sett-spinner sett-spinner-white" style={{ width: 13, height: 13 }} /> : <><FiSave size={13} /> Guardar</>}
                                    </button>
                                    <button className="btn btn-ghost btn-sm" onClick={cancelTel} disabled={telSaving} style={{ flexShrink: 0, padding: '0 8px' }}>
                                        <FiX size={14} />
                                    </button>
                                </div>
                            ) : (
                                <div className="sett-tel-view-row">
                                    <span className="sett-field-value">{telSuccess ? <span style={{ color: 'var(--success-500)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><FiCheckCircle size={14} /> Guardado</span> : telefonoDisplay}</span>
                                    <button className="btn btn-ghost btn-sm sett-edit-btn" onClick={() => setTelEditing(true)}>
                                        <FiEdit2 size={13} /> Editar
                                    </button>
                                </div>
                            )}
                        </div>

                    </div>

                    <div className="sett-card-footer">
                        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/change-password')} style={{ gap: 6 }}>
                            <FiLock size={13} /> Cambiar contraseña
                        </button>
                    </div>
                </div>
            </div>

            <style>{`
                /* ── Hero card ── */
                .sett-hero-card {
                    padding: var(--space-6);
                    display: flex;
                    align-items: center;
                    gap: var(--space-6);
                    margin-bottom: var(--space-4);
                }
                .sett-avatar-wrap {
                    position: relative;
                    cursor: pointer;
                    flex-shrink: 0;
                    border-radius: 50%;
                }
                .sett-avatar {
                    width: 120px;
                    height: 120px;
                    border-radius: 50%;
                    background: var(--accent-tint);
                    border: 3px solid var(--surface-border);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                    transition: border-color 0.2s;
                }
                .sett-avatar-wrap:hover .sett-avatar {
                    border-color: var(--accent);
                }
                .sett-avatar-img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                .sett-avatar-initials {
                    font-size: 2.8rem;
                    font-weight: 700;
                    color: var(--accent);
                    line-height: 1;
                }
                .sett-avatar-overlay {
                    position: absolute;
                    inset: 0;
                    border-radius: 50%;
                    background: rgba(0,0,0,0.52);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 5px;
                    color: white;
                    font-size: 11px;
                    font-weight: 600;
                    opacity: 0;
                    transition: opacity 0.2s;
                    pointer-events: none;
                }
                .sett-avatar-overlay.visible { opacity: 1; }
                .sett-hero-info {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-2);
                }
                .sett-hero-name {
                    font-size: var(--text-xl);
                    font-weight: 700;
                    color: var(--text-primary);
                    margin: 0;
                }
                .sett-role-pill {
                    display: inline-block;
                    background: var(--accent-tint);
                    color: var(--accent);
                    border: 1px solid rgba(0,110,220,0.2);
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.04em;
                    padding: 3px 12px;
                    text-transform: uppercase;
                    width: fit-content;
                }
                .sett-photo-actions {
                    display: flex;
                    gap: var(--space-2);
                    flex-wrap: wrap;
                    margin-top: var(--space-1);
                }

                /* ── Data card ── */
                .sett-data-card {
                    padding: var(--space-6);
                    margin-bottom: var(--space-4);
                }
                .sett-section-title {
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                    color: var(--text-muted);
                    margin: 0 0 var(--space-2);
                }
                .sett-fields {
                    display: flex;
                    flex-direction: column;
                }
                .sett-field-row {
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                    padding: var(--space-4) 0;
                    border-bottom: 1px solid var(--surface-border);
                }
                .sett-field-row:last-child { border-bottom: none; }
                .sett-field-label {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    color: var(--text-muted);
                }
                .sett-field-value {
                    font-size: var(--text-base);
                    color: var(--text-primary);
                    font-weight: 500;
                }
                .sett-tel-view-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: var(--space-3);
                }
                .sett-edit-btn {
                    opacity: 0;
                    transition: opacity 0.15s;
                    gap: 5px;
                    color: var(--text-muted);
                }
                .sett-field-row:hover .sett-edit-btn { opacity: 1; }
                .sett-tel-edit-row {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                }
                .sett-card-footer {
                    margin-top: var(--space-4);
                    padding-top: var(--space-4);
                    border-top: 1px solid var(--surface-border);
                }

                /* Spinner */
                .sett-spinner {
                    display: inline-block;
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    animation: sett-spin 0.7s linear infinite;
                }
                .sett-spinner-white {
                    border: 2px solid rgba(255,255,255,0.35);
                    border-top-color: white;
                }
                @keyframes sett-spin { to { transform: rotate(360deg); } }

                @media (max-width: 600px) {
                    .sett-hero-card { flex-direction: column; align-items: flex-start; }
                    .sett-tel-edit-row { flex-wrap: wrap; }
                }
            `}</style>
        </>
    );
}
