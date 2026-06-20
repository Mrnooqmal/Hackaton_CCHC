import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { personasApi } from '../api/client';
import PinInput from '../components/PinInput';
import { OnboardingShell } from '../components/ui';
import type { StepperStep } from '../components/ui';
import { FiCheckCircle, FiShield, FiLock, FiArrowRight, FiKey, FiUser, FiPhone, FiMessageSquare, FiCamera, FiSkipForward } from 'react-icons/fi';

type EnrollmentStep = 'welcome' | 'create-pin' | 'confirm-pin' | 'processing' | 'profile' | 'success';

function resizeImageToBase64(file: File, maxSize = 256): Promise<string> {
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
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            img.onerror = reject;
            img.src = e.target!.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export default function EnrollMe() {
    const { user, updateUser } = useAuth();
    const navigate = useNavigate();

    const [currentStep, setCurrentStep] = useState<EnrollmentStep>('welcome');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [pinCreateKey, setPinCreateKey] = useState(0);
    const [pinConfirmKey, setPinConfirmKey] = useState(0);
    const [enrollmentData, setEnrollmentData] = useState<any>(null);

    // Si el usuario ya está enrolado (ej. recargó en el paso de perfil), saltar directo ahí
    useEffect(() => {
        if ((user as any)?.habilitado === true) {
            setCurrentStep('profile');
        }
    }, [user]);

    // Profile step state
    const [fotoPerfil, setFotoPerfil] = useState<string | null>(null);
    const [telefono, setTelefono] = useState('');
    const [telFocused, setTelFocused] = useState(false);
    const [notificacionesSms, setNotificacionesSms] = useState(false);
    const [profileSaving, setProfileSaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleTelefonoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 9);
        let fmt = digits;
        if (digits.length > 5) fmt = digits[0] + ' ' + digits.slice(1, 5) + ' ' + digits.slice(5);
        else if (digits.length > 1) fmt = digits[0] + ' ' + digits.slice(1);
        setTelefono(fmt);
    };

    const PINES_OBVIOS = ['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321'];

    const handlePinCreate = (newPin: string) => {
        if (PINES_OBVIOS.includes(newPin)) {
            setError('PIN demasiado simple, elige otro');
            setPinCreateKey(k => k + 1);
            return;
        }
        setPin(newPin);
        setError('');
        setTimeout(() => setCurrentStep('confirm-pin'), 800);
    };

    const handlePinConfirm = async (confirmedPin: string) => {
        if (confirmedPin !== pin) {
            setError('El PIN no coincide. Inténtalo nuevamente.');
            setPinConfirmKey(k => k + 1);
            return;
        }

        setError('');
        setCurrentStep('processing');

        try {
            const targetId = (user as any)?.personaId || user?.userId;
            const targetTenant = (user as any)?.tenantId || (user as any)?.empresaId;

            if (!targetId || !targetTenant) throw new Error('Usuario o Tenant no encontrado en la sesión');

            const setPinResponse = await personasApi.setPin(targetTenant, targetId, pin);
            if (!setPinResponse.success) throw new Error(setPinResponse.error || 'Error al configurar el PIN');

            const enrollResponse = await personasApi.completarEnrolamiento(targetTenant, targetId, pin);
            if (!enrollResponse.success || !enrollResponse.data) throw new Error(enrollResponse.error || 'Error al completar el enrolamiento');

            updateUser({ habilitado: true });
            setEnrollmentData(enrollResponse.data);
            setCurrentStep('profile');
        } catch (err) {
            console.error('Error en enrolamiento:', err);
            setError(err instanceof Error ? err.message : 'Error desconocido');
            setCurrentStep('confirm-pin');
        }
    };

    const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const base64 = await resizeImageToBase64(file, 256);
            setFotoPerfil(base64);
        } catch {
            // silently ignore resize errors
        }
    };

    const saveProfileAndContinue = async (skip = false) => {
        setProfileSaving(true);
        try {
            const targetId = (user as any)?.personaId || user?.userId;
            const targetTenant = (user as any)?.tenantId || (user as any)?.empresaId;

            if (targetId && targetTenant && !skip) {
                const updates: Record<string, any> = {};
                if (fotoPerfil) updates.fotoPerfil = fotoPerfil;
                const telefonoFull = telefono.replace(/\D/g, '').length >= 9
                    ? `+56 ${telefono}`
                    : '';
                if (telefonoFull) updates.telefono = telefonoFull;
                updates.notificacionesSms = notificacionesSms;

                if (Object.keys(updates).length > 0) {
                    await personasApi.update(targetTenant, targetId, updates);
                    updateUser({ fotoPerfil: fotoPerfil || undefined, telefono: telefonoFull || undefined, notificacionesSms });
                }
            }
        } catch {
            // non-blocking — profile update failure shouldn't block enrollment
        } finally {
            setProfileSaving(false);
            setCurrentStep('success');
            setTimeout(() => navigate('/', { replace: true }), 3000);
        }
    };

    const steps: StepperStep[] = [
        { id: 'welcome', label: 'Bienvenida' },
        { id: 'create-pin', label: 'Crear PIN' },
        { id: 'confirm-pin', label: 'Confirmar' },
        { id: 'profile', label: 'Perfil' },
        { id: 'success', label: 'Completado' },
    ];
    const currentIndex = steps.findIndex(s =>
        s.id === currentStep || (currentStep === 'processing' && s.id === 'profile')
    );

    return (
        <OnboardingShell
            user={user as any}
            steps={steps}
            currentIndex={currentIndex < 0 ? 0 : currentIndex}
            sideHint="Crea tu firma digital (PIN de 4 dígitos) y completa tu perfil para terminar de habilitar tu cuenta."
        >
                {/* Card principal */}
                <div className="card" style={{ padding: 'var(--space-8)' }}>

                    {/* STEP: Bienvenida */}
                    {currentStep === 'welcome' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', animation: 'fadeInScale 0.35s ease-out' }}>
                            <div style={{
                                width: '64px', height: '64px',
                                borderRadius: 'var(--radius-lg)',
                                background: 'var(--accent-tint)',
                                border: '1px solid var(--surface-border)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: 'var(--accent)',
                                margin: '0 auto',
                            }}>
                                <FiShield size={30} />
                            </div>

                            <div style={{ textAlign: 'center' }}>
                                <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-2)', fontFamily: 'var(--font-display)' }}>
                                    Firma Digital
                                </h2>
                                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                    Para habilitar tu cuenta y utilizar todas las funcionalidades,
                                    necesitas crear un PIN de seguridad de 4 dígitos.
                                </p>
                            </div>

                            <div style={{
                                background: 'var(--surface-elevated)',
                                border: '1px solid var(--surface-border)',
                                borderRadius: 'var(--radius-lg)',
                                overflow: 'hidden',
                            }}>
                                {[
                                    { icon: <FiKey size={16} />, title: 'PIN de 4 dígitos', text: 'Tu firma digital para autorizar documentos y actividades en la plataforma.' },
                                    { icon: <FiLock size={16} />, title: 'Seguridad', text: 'Tu PIN está encriptado y sólo tú lo conocerás.' },
                                ].map((item, i) => (
                                    <div key={i} style={{
                                        display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-4)',
                                        borderBottom: i === 0 ? '1px solid var(--surface-border)' : 'none',
                                        alignItems: 'flex-start',
                                    }}>
                                        <div style={{
                                            width: '32px', height: '32px', flexShrink: 0,
                                            borderRadius: 'var(--radius-md)',
                                            background: 'var(--accent-tint)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: 'var(--accent)',
                                        }}>
                                            {item.icon}
                                        </div>
                                        <div>
                                            <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                                                {item.title}
                                            </p>
                                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                                {item.text}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <button
                                className="btn btn-primary"
                                style={{ width: '100%', justifyContent: 'center', gap: 'var(--space-2)' }}
                                onClick={() => setCurrentStep('create-pin')}
                            >
                                Comenzar enrolamiento
                                <FiArrowRight size={16} />
                            </button>
                        </div>
                    )}

                    {/* STEP: Crear PIN */}
                    {currentStep === 'create-pin' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', animation: 'fadeInScale 0.35s ease-out' }}>
                            <PinInput
                                key={pinCreateKey}
                                mode="create"
                                onComplete={handlePinCreate}
                                title="Crea tu PIN de Seguridad"
                                subtitle="Este PIN será tu firma digital. Recuérdalo bien."
                                error={error}
                            />
                            <button
                                className="btn btn-ghost btn-sm"
                                style={{ alignSelf: 'center' }}
                                onClick={() => setCurrentStep('welcome')}
                            >
                                Volver
                            </button>
                        </div>
                    )}

                    {/* STEP: Confirmar PIN */}
                    {currentStep === 'confirm-pin' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', animation: 'fadeInScale 0.35s ease-out' }}>
                            <PinInput
                                key={pinConfirmKey}
                                mode="confirm"
                                onComplete={handlePinConfirm}
                                title="Confirma tu PIN"
                                subtitle="Ingresa nuevamente tu PIN de 4 dígitos"
                                error={error}
                            />
                            <button
                                className="btn btn-ghost btn-sm"
                                style={{ alignSelf: 'center' }}
                                onClick={() => { setCurrentStep('create-pin'); setError(''); }}
                            >
                                Cambiar PIN
                            </button>
                        </div>
                    )}

                    {/* STEP: Procesando */}
                    {currentStep === 'processing' && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-8) 0', animation: 'fadeInScale 0.35s ease-out' }}>
                            <div style={{
                                width: '56px', height: '56px',
                                border: '3px solid var(--surface-border)',
                                borderTopColor: 'var(--accent)',
                                borderRadius: '50%',
                                animation: 'spin 0.8s linear infinite',
                            }} />
                            <div style={{ textAlign: 'center' }}>
                                <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-1)' }}>
                                    Creando tu firma digital…
                                </h3>
                                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                                    Estamos configurando tu cuenta de forma segura
                                </p>
                            </div>
                        </div>
                    )}

                    {/* STEP: Completar perfil (opcional) */}
                    {currentStep === 'profile' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', animation: 'fadeInScale 0.35s ease-out' }}>
                            {/* Header */}
                            <div style={{ textAlign: 'center' }}>
                                <div style={{
                                    width: '56px', height: '56px',
                                    borderRadius: '50%',
                                    background: 'var(--accent-tint)',
                                    border: '1px solid var(--surface-border)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'var(--accent)',
                                    margin: '0 auto var(--space-4)',
                                }}>
                                    <FiUser size={26} />
                                </div>
                                <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-1)', fontFamily: 'var(--font-display)' }}>
                                    Termina de completar tu perfil
                                </h2>
                                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                    Este paso es <strong>opcional</strong>. Puedes completarlo ahora o más tarde desde tu perfil.
                                </p>
                            </div>

                            {/* Foto de perfil */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    style={{
                                        width: '96px', height: '96px',
                                        borderRadius: '50%',
                                        border: `2px dashed ${fotoPerfil ? 'var(--accent)' : 'var(--surface-border)'}`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer',
                                        overflow: 'hidden',
                                        background: fotoPerfil ? 'transparent' : 'var(--surface-elevated)',
                                        transition: 'border-color 0.2s',
                                        position: 'relative',
                                    }}
                                >
                                    {fotoPerfil ? (
                                        <img src={fotoPerfil} alt="Foto de perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: 'var(--text-muted)' }}>
                                            <FiCamera size={22} />
                                            <span style={{ fontSize: '10px' }}>Subir foto</span>
                                        </div>
                                    )}
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    onChange={handleImageChange}
                                />
                                {fotoPerfil && (
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        style={{ fontSize: '12px', padding: '2px 10px' }}
                                        onClick={() => { setFotoPerfil(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                    >
                                        Quitar foto
                                    </button>
                                )}
                            </div>

                            {/* Teléfono — Chilean format, single input */}
                            {(() => {
                                const complete = telefono.replace(/\D/g, '').length === 9;
                                const borderColor = complete
                                    ? 'var(--success-500)'
                                    : telFocused ? 'var(--accent)' : 'var(--surface-border)';
                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-secondary)' }}>
                                            <FiPhone size={13} /> Número de teléfono
                                        </span>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            border: `1.5px solid ${borderColor}`,
                                            borderRadius: 'var(--radius-md)',
                                            background: 'var(--surface-card)',
                                            overflow: 'hidden',
                                            transition: 'border-color 0.2s, box-shadow 0.2s',
                                            boxShadow: telFocused
                                                ? `0 0 0 3px ${complete ? 'rgba(34,197,94,0.15)' : 'rgba(0,110,220,0.12)'}`
                                                : 'none',
                                            height: '42px',
                                        }}>
                                            {/* Prefix badge */}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: '6px',
                                                padding: '0 12px',
                                                height: '100%',
                                                borderRight: '1.5px solid var(--surface-border)',
                                                background: 'var(--surface-elevated)',
                                                flexShrink: 0,
                                                userSelect: 'none',
                                            }}>
                                                <span style={{ fontSize: '13px', lineHeight: 1 }}>🇨🇱</span>
                                                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>+56</span>
                                            </div>

                                            {/* Single input */}
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                placeholder="9 1234 5678"
                                                value={telefono}
                                                onFocus={() => setTelFocused(true)}
                                                onBlur={() => setTelFocused(false)}
                                                onChange={handleTelefonoChange}
                                                style={{
                                                    flex: 1,
                                                    border: 'none',
                                                    outline: 'none',
                                                    background: 'transparent',
                                                    fontSize: '15px',
                                                    color: 'var(--text-primary)',
                                                    padding: '0 10px',
                                                    caretColor: 'var(--accent)',
                                                }}
                                            />

                                            {/* Checkmark when complete */}
                                            <div style={{
                                                paddingRight: '12px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                opacity: complete ? 1 : 0,
                                                transform: complete ? 'scale(1)' : 'scale(0.5)',
                                                transition: 'opacity 0.25s, transform 0.25s',
                                            }}>
                                                <FiCheckCircle size={16} style={{ color: 'var(--success-500)' }} />
                                            </div>
                                        </div>

                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                            Formato: +56 9 1234 5678
                                        </span>
                                    </div>
                                );
                            })()}

                            {/* SMS checkbox */}
                            <label style={{
                                display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
                                padding: 'var(--space-3) var(--space-4)',
                                background: 'var(--surface-elevated)',
                                border: `1px solid ${notificacionesSms ? 'var(--accent)' : 'var(--surface-border)'}`,
                                borderRadius: 'var(--radius-md)',
                                cursor: 'pointer',
                                transition: 'border-color 0.2s',
                            }}>
                                <input
                                    type="checkbox"
                                    checked={notificacionesSms}
                                    onChange={(e) => setNotificacionesSms(e.target.checked)}
                                    style={{ marginTop: '2px', accentColor: 'var(--accent)', width: '16px', height: '16px', flexShrink: 0 }}
                                />
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                                        <FiMessageSquare size={13} style={{ color: 'var(--accent)' }} />
                                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                                            Deseo recibir notificaciones mediante SMS
                                        </span>
                                    </div>
                                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                                        Recibirás alertas importantes sobre documentos y actividades en tu número de teléfono.
                                    </span>
                                </div>
                            </label>

                            {/* Botones */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                <button
                                    className="btn btn-primary"
                                    style={{ width: '100%', justifyContent: 'center' }}
                                    disabled={profileSaving}
                                    onClick={() => saveProfileAndContinue(false)}
                                >
                                    {profileSaving ? 'Guardando…' : 'Guardar y continuar'}
                                </button>
                                <button
                                    className="btn btn-ghost"
                                    style={{ width: '100%', justifyContent: 'center', gap: 'var(--space-2)', color: 'var(--text-muted)' }}
                                    disabled={profileSaving}
                                    onClick={() => saveProfileAndContinue(true)}
                                >
                                    <FiSkipForward size={14} />
                                    Omitir por ahora
                                </button>
                            </div>
                        </div>
                    )}

                    {/* STEP: Éxito */}
                    {currentStep === 'success' && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-5)', animation: 'fadeInScale 0.35s ease-out' }}>
                            <div style={{
                                width: '72px', height: '72px',
                                borderRadius: '50%',
                                background: 'rgba(34, 197, 94, 0.12)',
                                border: '2px solid var(--success-500)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: 'var(--success-500)',
                                animation: 'successPulse 0.6s ease-out',
                            }}>
                                <FiCheckCircle size={36} />
                            </div>

                            <div style={{ textAlign: 'center' }}>
                                <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', marginBottom: 'var(--space-2)' }}>
                                    ¡Enrolamiento completado!
                                </h2>
                                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                                    Tu firma digital ha sido creada exitosamente.
                                </p>
                            </div>

                            {enrollmentData && (
                                <div style={{
                                    width: '100%',
                                    background: 'var(--surface-elevated)',
                                    border: '1px solid var(--surface-border)',
                                    borderRadius: 'var(--radius-lg)',
                                    overflow: 'hidden',
                                }}>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                        padding: 'var(--space-3) var(--space-4)',
                                        borderBottom: '1px solid var(--surface-border)',
                                        background: 'var(--surface-card)',
                                    }}>
                                        <FiShield size={14} style={{ color: 'var(--accent)' }} />
                                        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                                            Datos de la firma
                                        </span>
                                    </div>
                                    {[
                                        { label: 'Token', value: enrollmentData.firma.token },
                                        { label: 'Fecha', value: enrollmentData.firma.fecha },
                                        { label: 'Hora', value: enrollmentData.firma.horario },
                                    ].map((field, i, arr) => (
                                        <div key={i} style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            padding: 'var(--space-3) var(--space-4)',
                                            borderBottom: i < arr.length - 1 ? '1px solid var(--surface-border)' : 'none',
                                        }}>
                                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', fontWeight: 500 }}>{field.label}</span>
                                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{field.value}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontStyle: 'italic', animation: 'pulse 2s ease-in-out infinite' }}>
                                Redirigiendo al panel principal…
                            </p>
                        </div>
                    )}
                </div>

            <style>{`
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(16px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes fadeInScale {
                    from { opacity: 0; transform: scale(0.97); }
                    to   { opacity: 1; transform: scale(1); }
                }
                @keyframes successPulse {
                    0%   { transform: scale(0.5); opacity: 0; }
                    60%  { transform: scale(1.08); }
                    100% { transform: scale(1); opacity: 1; }
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </OnboardingShell>
    );
}
