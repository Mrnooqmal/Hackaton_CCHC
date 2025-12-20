import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usersApi } from '../api/client';
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
    const [processing, setProcessing] = useState(false);

    const handlePinCreate = (newPin: string) => {
        setPin(newPin);
        setError('');
        // Pequeño delay para que el usuario vea el éxito antes de avanzar
        setTimeout(() => {
            setCurrentStep('confirm-pin');
        }, 800);
    };

    const handlePinConfirm = async (confirmedPin: string) => {
        if (confirmedPin !== pin) {
            setError('El PIN no coincide. Inténtalo nuevamente.');
            return;
        }

        setError('');
        setCurrentStep('processing');
        setProcessing(true);

        try {
            if (!user?.userId) {
                throw new Error('Usuario no encontrado');
            }

            // Paso 1: Configurar el PIN
            const setPinResponse = await usersApi.setPin(user.userId, pin);

            if (!setPinResponse.success) {
                throw new Error(setPinResponse.error || 'Error al configurar el PIN');
            }

            // Paso 2: Completar enrolamiento (crea la firma digital)
            const enrollResponse = await usersApi.completeEnrollment(user.userId, pin);

            if (!enrollResponse.success || !enrollResponse.data) {
                throw new Error(enrollResponse.error || 'Error al completar el enrolamiento');
            }

            // Actualizar el usuario en el contexto
            updateUser({ habilitado: true });

            // Guardar datos del enrolamiento para mostrar
            setEnrollmentData(enrollResponse.data);
            setCurrentStep('success');

            // Redirigir al dashboard después de 3 segundos
            setTimeout(() => {
                navigate('/', { replace: true });
            }, 3000);

        } catch (err) {
            console.error('Error en enrolamiento:', err);
            setError(err instanceof Error ? err.message : 'Error desconocido');
            setCurrentStep('confirm-pin');
        } finally {
            setProcessing(false);
        }
    };

    const renderStepIndicator = () => {
        const steps = [
            { key: 'welcome', label: 'Bienvenida' },
            { key: 'create-pin', label: 'Crear PIN' },
            { key: 'confirm-pin', label: 'Confirmar' },
            { key: 'success', label: 'Completado' },
        ];

        const currentIndex = steps.findIndex(s => s.key === currentStep || (currentStep === 'processing' && s.key === 'success'));

        return (
            <div className="enrollment-progress">
                {steps.map((step, index) => (
                    <div key={step.key} className="enrollment-progress-item">
                        <div className={`enrollment-progress-circle ${index <= currentIndex ? 'active' : ''} ${index < currentIndex ? 'completed' : ''}`}>
                            {index < currentIndex ? <FiCheckCircle size={16} /> : index + 1}
                        </div>
                        <span className="enrollment-progress-label">{step.label}</span>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="enrollment-page">
            <div className="enrollment-bg">
                <div className="enrollment-bg-gradient enrollment-bg-gradient-1"></div>
                <div className="enrollment-bg-gradient enrollment-bg-gradient-2"></div>
            </div>

            <div className="enrollment-container">
                {renderStepIndicator()}

                <div className="enrollment-card">
                    {currentStep === 'welcome' && (
                        <div className="enrollment-step enrollment-step-fade-in">
                            <div className="enrollment-icon">
                                <FiShield size={48} />
                            </div>
                            <h2 className="enrollment-title">Bienvenido al Sistema de Firma Digital</h2>
                            <p className="enrollment-description">
                                Para habilitar tu cuenta y poder utilizar todas las funcionalidades del sistema,
                                necesitas completar tu enrolamiento creando un PIN de seguridad de 4 dígitos.
                            </p>

                            <div className="enrollment-info-box">
                                <div className="enrollment-info-item">
                                    <FiKey className="enrollment-info-icon" />
                                    <div>
                                        <h4 className="enrollment-info-title">PIN de 4 dígitos</h4>
                                        <p className="enrollment-info-text">
                                            Este PIN será tu firma digital para autorizar documentos y actividades
                                        </p>
                                    </div>
                                </div>
                                <div className="enrollment-info-item">
                                    <FiLock className="enrollment-info-icon" />
                                    <div>
                                        <h4 className="enrollment-info-title">Seguridad</h4>
                                        <p className="enrollment-info-text">
                                            Tu PIN está encriptado y solo tú lo conocerás
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <button
                                className="btn btn-primary btn-lg w-full enrollment-btn"
                                onClick={() => setCurrentStep('create-pin')}
                            >
                                Comenzar Enrolamiento
                                <FiArrowRight className="ml-2" />
                            </button>
                        </div>
                    )}

                    {currentStep === 'create-pin' && (
                        <div className="enrollment-step enrollment-step-fade-in">
                            <PinInput
                                mode="create"
                                onComplete={handlePinCreate}
                                title="Crea tu PIN de Seguridad"
                                subtitle="Este PIN será tu firma digital. Recuérdalo bien."
                            />
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setCurrentStep('welcome')}
                                style={{ marginTop: 'var(--space-4)' }}
                            >
                                Volver
                            </button>
                        </div>
                    )}

                    {currentStep === 'confirm-pin' && (
                        <div className="enrollment-step enrollment-step-fade-in">
                            <PinInput
                                mode="confirm"
                                onComplete={handlePinConfirm}
                                title="Confirma tu PIN"
                                subtitle="Ingresa nuevamente tu PIN de 4 dígitos"
                                error={error}
                            />
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setCurrentStep('create-pin');
                                    setError('');
                                }}
                                style={{ marginTop: 'var(--space-4)' }}
                            >
                                Cambiar PIN
                            </button>
                        </div>
                    )}

                    {currentStep === 'processing' && (
                        <div className="enrollment-step enrollment-step-fade-in text-center">
                            <div className="enrollment-processing">
                                <div className="spinner-large"></div>
                                <h3 className="enrollment-processing-title">Creando tu Firma Digital...</h3>
                                <p className="enrollment-processing-text">
                                    Estamos configurando tu cuenta de forma segura
                                </p>
                            </div>
                        </div>
                    )}

                    {currentStep === 'success' && enrollmentData && (
                        <div className="enrollment-step enrollment-step-fade-in text-center">
                            <div className="enrollment-success-icon">
                                <FiCheckCircle size={64} />
                            </div>
                            <h2 className="enrollment-success-title">¡Enrolamiento Completado!</h2>
                            <p className="enrollment-success-description">
                                Tu firma digital ha sido creada exitosamente
                            </p>

                            <div className="enrollment-signature-card">
                                <div className="enrollment-signature-header">
                                    <FiShield size={24} />
                                    <span>Firma Digital</span>
                                </div>
                                <div className="enrollment-signature-body">
                                    <div className="enrollment-signature-field">
                                        <span className="enrollment-signature-label">Token</span>
                                        <span className="enrollment-signature-value">{enrollmentData.firma.token}</span>
                                    </div>
                                    <div className="enrollment-signature-field">
                                        <span className="enrollment-signature-label">Fecha</span>
                                        <span className="enrollment-signature-value">{enrollmentData.firma.fecha}</span>
                                    </div>
                                    <div className="enrollment-signature-field">
                                        <span className="enrollment-signature-label">Hora</span>
                                        <span className="enrollment-signature-value">{enrollmentData.firma.horario}</span>
                                    </div>
                                </div>
                            </div>

                            <p className="enrollment-redirect-text">
                                Redirigiendo al panel principal...
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                .enrollment-page {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                    overflow: hidden;
                    background: var(--surface-bg);
                    padding: var(--space-6);
                }

                .enrollment-bg {
                    position: absolute;
                    inset: 0;
                    z-index: 0;
                    overflow: hidden;
                }

                .enrollment-bg-gradient {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(120px);
                    opacity: 0.25;
                    animation: floatSlow 25s ease-in-out infinite;
                }

                .enrollment-bg-gradient-1 {
                    width: 700px;
                    height: 700px;
                    background: linear-gradient(135deg, var(--primary-500), var(--info-500));
                    top: -250px;
                    left: -250px;
                }

                .enrollment-bg-gradient-2 {
                    width: 600px;
                    height: 600px;
                    background: linear-gradient(135deg, var(--success-500), var(--primary-600));
                    bottom: -200px;
                    right: -200px;
                    animation-delay: -12s;
                }

                @keyframes floatSlow {
                    0%, 100% {
                        transform: translate(0, 0) scale(1);
                    }
                    50% {
                        transform: translate(30px, -30px) scale(1.05);
                    }
                }

                .enrollment-container {
                    position: relative;
                    z-index: 1;
                    width: 100%;
                    max-width: 600px;
                    animation: fadeInUp 0.6s ease-out;
                }

                .enrollment-progress {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: var(--space-8);
                    position: relative;
                }

                .enrollment-progress::before {
                    content: '';
                    position: absolute;
                    top: 20px;
                    left: 5%;
                    right: 5%;
                    height: 2px;
                    background: var(--surface-border);
                    z-index: 0;
                }

                .enrollment-progress-item {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: var(--space-2);
                    flex: 1;
                    position: relative;
                    z-index: 1;
                }

                .enrollment-progress-circle {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: var(--surface-card);
                    border: 2px solid var(--surface-border);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 600;
                    font-size: var(--text-sm);
                    color: var(--text-muted);
                    transition: all 0.3s ease;
                }

                .enrollment-progress-circle.active {
                    border-color: var(--primary-500);
                    color: var(--primary-400);
                    background: rgba(76, 175, 80, 0.1);
                }

                .enrollment-progress-circle.completed {
                    background: var(--primary-500);
                    border-color: var(--primary-500);
                    color: white;
                }

                .enrollment-progress-label {
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                    font-weight: 500;
                    text-align: center;
                }

                .enrollment-card {
                    background: rgba(26, 26, 26, 0.8);
                    backdrop-filter: blur(20px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: var(--radius-xl);
                    padding: var(--space-8);
                    box-shadow: 
                        0 20px 60px rgba(0, 0, 0, 0.5),
                        0 0 0 1px rgba(255, 255, 255, 0.05) inset;
                }

                .enrollment-step {
                    min-height: 300px;
                    display: flex;
                    flex-direction: column;
                }

                .enrollment-step-fade-in {
                    animation: fadeInScale 0.4s ease-out;
                }

                @keyframes fadeInScale {
                    from {
                        opacity: 0;
                        transform: scale(0.95);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1);
                    }
                }

                .enrollment-icon {
                    width: 80px;
                    height: 80px;
                    background: linear-gradient(135deg, var(--primary-500), var(--primary-700));
                    border-radius: var(--radius-xl);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto var(--space-5);
                    color: white;
                    box-shadow: 0 10px 30px rgba(76, 175, 80, 0.3);
                }

                .enrollment-title {
                    font-size: var(--text-2xl);
                    font-weight: 700;
                    color: var(--text-primary);
                    text-align: center;
                    margin-bottom: var(--space-3);
                }

                .enrollment-description {
                    font-size: var(--text-base);
                    color: var(--text-secondary);
                    text-align: center;
                    line-height: 1.6;
                    margin-bottom: var(--space-6);
                }

                .enrollment-info-box {
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                    padding: var(--space-5);
                    margin-bottom: var(--space-6);
                }

                .enrollment-info-item {
                    display: flex;
                    gap: var(--space-4);
                    margin-bottom: var(--space-4);
                }

                .enrollment-info-item:last-child {
                    margin-bottom: 0;
                }

                .enrollment-info-icon {
                    color: var(--primary-400);
                    flex-shrink: 0;
                    margin-top: 2px;
                }

                .enrollment-info-title {
                    font-size: var(--text-sm);
                    font-weight: 600;
                    color: var(--text-primary);
                    margin-bottom: var(--space-1);
                }

                .enrollment-info-text {
                    font-size: var(--text-sm);
                    color: var(--text-muted);
                    line-height: 1.5;
                }

                .enrollment-btn {
                    margin-top: auto;
                }

                .enrollment-processing {
                    padding: var(--space-8) 0;
                }

                .spinner-large {
                    width: 64px;
                    height: 64px;
                    border: 4px solid var(--surface-border);
                    border-top-color: var(--primary-500);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                    margin: 0 auto var(--space-5);
                }

                .enrollment-processing-title {
                    font-size: var(--text-xl);
                    font-weight: 600;
                    color: var(--text-primary);
                    margin-bottom: var(--space-2);
                }

                .enrollment-processing-text {
                    font-size: var(--text-sm);
                    color: var(--text-muted);
                }

                .enrollment-success-icon {
                    width: 120px;
                    height: 120px;
                    background: linear-gradient(135deg, var(--success-500), var(--success-600));
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto var(--space-6);
                    color: white;
                    animation: successPulse 1.5s ease-out;
                }

                @keyframes successPulse {
                    0% {
                        transform: scale(0);
                        opacity: 0;
                    }
                    50% {
                        transform: scale(1.1);
                    }
                    100% {
                        transform: scale(1);
                        opacity: 1;
                    }
                }

                .enrollment-success-title {
                    font-size: var(--text-3xl);
                    font-weight: 700;
                    color: var(--text-primary);
                    margin-bottom: var(--space-3);
                }

                .enrollment-success-description {
                    font-size: var(--text-base);
                    color: var(--text-secondary);
                    margin-bottom: var(--space-6);
                }

                .enrollment-signature-card {
                    background: var(--surface-elevated);
                    border: 1px solid var(--primary-600);
                    border-radius: var(--radius-lg);
                    overflow: hidden;
                    margin-bottom: var(--space-6);
                }

                .enrollment-signature-header {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: var(--space-3);
                    padding: var(--space-4);
                    background: linear-gradient(135deg, var(--primary-600), var(--primary-700));
                    color: white;
                    font-weight: 600;
                }

                .enrollment-signature-body {
                    padding: var(--space-5);
                }

                .enrollment-signature-field {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: var(--space-3) 0;
                    border-bottom: 1px solid var(--surface-border);
                }

                .enrollment-signature-field:last-child {
                    border-bottom: none;
                }

                .enrollment-signature-label {
                    font-size: var(--text-sm);
                    color: var(--text-muted);
                    font-weight: 500;
                }

                .enrollment-signature-value {
                    font-size: var(--text-sm);
                    color: var(--text-primary);
                    font-weight: 600;
                    font-family: var(--font-mono);
                }

                .enrollment-redirect-text {
                    font-size: var(--text-sm);
                    color: var(--text-muted);
                    font-style: italic;
                    animation: pulse 2s ease-in-out infinite;
                }

                .text-center {
                    text-align: center;
                }

                .w-full {
                    width: 100%;
                }

                .ml-2 {
                    margin-left: var(--space-2);
                }

                @media (max-width: 640px) {
                    .enrollment-progress-label {
                        font-size: 10px;
                    }
                    
                    .enrollment-card {
                        padding: var(--space-6);
                    }

                    .enrollment-title {
                        font-size: var(--text-xl);
                    }
                }
            `}</style>
        </div>
    );
}
