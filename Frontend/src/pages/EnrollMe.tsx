import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { personasApi } from '../api/client';
import PinInput from '../components/PinInput';
import { FiCheckCircle, FiShield, FiLock, FiArrowRight, FiKey } from 'react-icons/fi';

type EnrollmentStep = 'welcome' | 'create-pin' | 'confirm-pin' | 'processing' | 'success';

export default function EnrollMe() {
    const { user, updateUser } = useAuth();
    const navigate = useNavigate();

    const [currentStep, setCurrentStep] = useState<EnrollmentStep>('welcome');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [enrollmentData, setEnrollmentData] = useState<any>(null);

    const handlePinCreate = (newPin: string) => {
        setPin(newPin);
        setError('');
        setTimeout(() => setCurrentStep('confirm-pin'), 800);
    };

    const handlePinConfirm = async (confirmedPin: string) => {
        if (confirmedPin !== pin) {
            setError('El PIN no coincide. Inténtalo nuevamente.');
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
            setCurrentStep('success');

            setTimeout(() => navigate('/', { replace: true }), 3000);
        } catch (err) {
            console.error('Error en enrolamiento:', err);
            setError(err instanceof Error ? err.message : 'Error desconocido');
            setCurrentStep('confirm-pin');
        }
    };

    const steps = [
        { key: 'welcome', label: 'Bienvenida' },
        { key: 'create-pin', label: 'Crear PIN' },
        { key: 'confirm-pin', label: 'Confirmar' },
        { key: 'success', label: 'Completado' },
    ];
    const currentIndex = steps.findIndex(s => s.key === currentStep || (currentStep === 'processing' && s.key === 'success'));

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--surface-base)',
            padding: 'var(--space-6)',
        }}>
            <div style={{ width: '100%', maxWidth: '520px', animation: 'fadeInUp 0.4s ease-out' }}>

                {/* Barra de progreso */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    position: 'relative',
                    marginBottom: 'var(--space-6)',
                }}>
                    {/* Línea de fondo */}
                    <div style={{
                        position: 'absolute',
                        top: '18px',
                        left: '10%',
                        right: '10%',
                        height: '2px',
                        background: 'var(--surface-border)',
                    }} />
                    {/* Línea de progreso */}
                    <div style={{
                        position: 'absolute',
                        top: '18px',
                        left: '10%',
                        height: '2px',
                        background: 'var(--accent)',
                        width: `${(currentIndex / (steps.length - 1)) * 80}%`,
                        transition: 'width 0.4s ease',
                    }} />

                    {steps.map((step, index) => {
                        const isCompleted = index < currentIndex;
                        const isActive = index === currentIndex;
                        return (
                            <div key={step.key} style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 'var(--space-2)',
                                flex: 1,
                                position: 'relative',
                                zIndex: 1,
                            }}>
                                <div style={{
                                    width: '36px',
                                    height: '36px',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 600,
                                    fontSize: 'var(--text-sm)',
                                    transition: 'all 0.3s ease',
                                    background: isCompleted ? 'var(--accent)' : isActive ? 'var(--accent-tint)' : 'var(--surface-card)',
                                    border: `2px solid ${isCompleted || isActive ? 'var(--accent)' : 'var(--surface-border)'}`,
                                    color: isCompleted ? 'white' : isActive ? 'var(--accent)' : 'var(--text-muted)',
                                }}>
                                    {isCompleted ? <FiCheckCircle size={15} /> : index + 1}
                                </div>
                                <span style={{
                                    fontSize: '11px',
                                    fontWeight: isActive ? 600 : 400,
                                    color: isActive ? 'var(--accent-text)' : 'var(--text-muted)',
                                    textAlign: 'center',
                                }}>
                                    {step.label}
                                </span>
                            </div>
                        );
                    })}
                </div>

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
                                mode="create"
                                onComplete={handlePinCreate}
                                title="Crea tu PIN de Seguridad"
                                subtitle="Este PIN será tu firma digital. Recuérdalo bien."
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

                    {/* STEP: Éxito */}
                    {currentStep === 'success' && enrollmentData && (
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

                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontStyle: 'italic', animation: 'pulse 2s ease-in-out infinite' }}>
                                Redirigiendo al panel principal…
                            </p>
                        </div>
                    )}
                </div>
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
        </div>
    );
}
