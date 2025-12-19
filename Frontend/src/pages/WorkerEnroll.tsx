import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import PinInput from '../components/PinInput';
import { FiUser, FiMail, FiPhone, FiBriefcase, FiCheck, FiArrowRight, FiArrowLeft, FiLock, FiShield } from 'react-icons/fi';
import { workersApi, type CreateWorkerData } from '../api/client';

type Step = 'data' | 'create-pin' | 'confirm-pin' | 'sign' | 'complete';

export default function WorkerEnroll() {
    const navigate = useNavigate();
    const [step, setStep] = useState<Step>('data');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [pinError, setPinError] = useState('');
    const [workerId, setWorkerId] = useState<string | null>(null);
    const [newPin, setNewPin] = useState('');
    const [signatureToken, setSignatureToken] = useState('');

    const [formData, setFormData] = useState<CreateWorkerData>({
        rut: '',
        nombre: '',
        apellido: '',
        email: '',
        telefono: '',
        cargo: '',
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateRut = (rut: string): boolean => {
        const cleanRut = rut.replace(/\./g, '').replace(/-/g, '');
        if (cleanRut.length < 8 || cleanRut.length > 9) return false;
        return true;
    };

    const validateStep1 = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!formData.rut) {
            newErrors.rut = 'RUT es requerido';
        } else if (!validateRut(formData.rut)) {
            newErrors.rut = 'RUT inválido';
        }

        if (!formData.nombre) {
            newErrors.nombre = 'Nombre es requerido';
        }

        if (!formData.cargo) {
            newErrors.cargo = 'Cargo es requerido';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));

        if (errors[name]) {
            setErrors((prev) => ({ ...prev, [name]: '' }));
        }
    };

    const handleSubmitData = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validateStep1()) return;

        setLoading(true);
        setError('');

        try {
            const response = await workersApi.create(formData);

            if (response.success && response.data) {
                setWorkerId(response.data.workerId);
                setStep('create-pin');
            } else {
                setError(response.error || 'Error al registrar trabajador');
            }
        } catch (err) {
            setError('Error de conexión con el servidor');
        } finally {
            setLoading(false);
        }
    };

    const handleCreatePin = async (pin: string) => {
        if (!workerId) return;

        setNewPin(pin);
        setLoading(true);
        setPinError('');

        try {
            const response = await workersApi.setPin(workerId, pin);

            if (response.success) {
                setStep('confirm-pin');
            } else {
                setPinError(response.error || 'Error al configurar PIN');
            }
        } catch (err) {
            setPinError('Error de conexión con el servidor');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmPin = async (pin: string) => {
        if (pin !== newPin) {
            setPinError('Los PINs no coinciden. Intente nuevamente.');
            return;
        }

        setPinError('');
        setStep('sign');
    };

    const handleSign = async (pin: string) => {
        if (!workerId) return;

        setLoading(true);
        setPinError('');

        try {
            const response = await workersApi.completeEnrollment(workerId, pin);

            if (response.success && response.data) {
                setSignatureToken(response.data.firma.token);
                setStep('complete');
            } else {
                setPinError(response.error || 'Error al completar enrolamiento');
            }
        } catch (err) {
            setPinError('Error de conexión con el servidor');
        } finally {
            setLoading(false);
        }
    };

    const cargos = [
        'Operario',
        'Soldador',
        'Electricista',
        'Maestro de Obra',
        'Supervisor',
        'Jefe de Cuadrilla',
        'Ayudante',
        'Carpintero',
        'Albañil',
        'Jornal',
        'Otro'
    ];

    const getStepNumber = () => {
        switch (step) {
            case 'data': return 1;
            case 'create-pin': return 2;
            case 'confirm-pin': return 2;
            case 'sign': return 3;
            case 'complete': return 4;
        }
    };

    const isStepComplete = (stepNum: number) => {
        const current = getStepNumber();
        return current > stepNum;
    };

    return (
        <>
            <Header title="Enrolamiento de Trabajador" />

            <div className="main-content">
                {/* Progress Steps */}
                <div className="card mb-6">
                    <div className="flex items-center justify-center gap-4" style={{ flexWrap: 'wrap' }}>
                        {/* Step 1: Datos */}
                        <div className={`flex items-center gap-2 ${step === 'data' ? 'text-primary' : ''}`}>
                            <div
                                className="avatar avatar-sm"
                                style={{
                                    background: step === 'data' ? 'var(--primary-500)' :
                                        isStepComplete(1) ? 'var(--success-500)' : 'var(--gray-600)'
                                }}
                            >
                                {isStepComplete(1) ? <FiCheck /> : '1'}
                            </div>
                            <span className={step === 'data' ? 'font-bold' : isStepComplete(1) ? '' : 'text-muted'}>
                                Datos
                            </span>
                        </div>

                        <div style={{ width: '40px', height: '2px', background: 'var(--surface-border)' }} />

                        {/* Step 2: PIN */}
                        <div className={`flex items-center gap-2 ${step === 'create-pin' || step === 'confirm-pin' ? 'text-primary' : ''}`}>
                            <div
                                className="avatar avatar-sm"
                                style={{
                                    background: step === 'create-pin' || step === 'confirm-pin' ? 'var(--primary-500)' :
                                        isStepComplete(2) ? 'var(--success-500)' : 'var(--gray-600)'
                                }}
                            >
                                {isStepComplete(2) ? <FiCheck /> : <FiLock size={14} />}
                            </div>
                            <span className={step === 'create-pin' || step === 'confirm-pin' ? 'font-bold' : isStepComplete(2) ? '' : 'text-muted'}>
                                Crear PIN
                            </span>
                        </div>

                        <div style={{ width: '40px', height: '2px', background: 'var(--surface-border)' }} />

                        {/* Step 3: Firma */}
                        <div className={`flex items-center gap-2 ${step === 'sign' ? 'text-primary' : ''}`}>
                            <div
                                className="avatar avatar-sm"
                                style={{
                                    background: step === 'sign' ? 'var(--primary-500)' :
                                        isStepComplete(3) ? 'var(--success-500)' : 'var(--gray-600)'
                                }}
                            >
                                {isStepComplete(3) ? <FiCheck /> : <FiShield size={14} />}
                            </div>
                            <span className={step === 'sign' ? 'font-bold' : isStepComplete(3) ? '' : 'text-muted'}>
                                Firma
                            </span>
                        </div>

                        <div style={{ width: '40px', height: '2px', background: 'var(--surface-border)' }} />

                        {/* Step 4: Completado */}
                        <div className={`flex items-center gap-2 ${step === 'complete' ? 'text-primary' : ''}`}>
                            <div
                                className="avatar avatar-sm"
                                style={{
                                    background: step === 'complete' ? 'var(--success-500)' : 'var(--gray-600)'
                                }}
                            >
                                {step === 'complete' ? <FiCheck /> : '4'}
                            </div>
                            <span className={step === 'complete' ? 'font-bold' : 'text-muted'}>
                                Listo
                            </span>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="alert alert-danger mb-4">
                        {error}
                    </div>
                )}

                {/* Step 1: Data Form */}
                {step === 'data' && (
                    <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
                        <h2 className="card-title mb-4">Datos del Trabajador</h2>
                        <p className="text-muted mb-6">
                            Complete los datos personales del trabajador para iniciar el proceso de enrolamiento.
                        </p>

                        <form onSubmit={handleSubmitData}>
                            <div className="form-group">
                                <label className="form-label">
                                    RUT *
                                </label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type="text"
                                        name="rut"
                                        value={formData.rut}
                                        onChange={handleChange}
                                        placeholder="12.345.678-9"
                                        className={`form-input ${errors.rut ? 'error' : ''}`}
                                        style={{ paddingLeft: '40px' }}
                                    />
                                    <FiUser
                                        style={{
                                            position: 'absolute',
                                            left: '12px',
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            color: 'var(--text-muted)'
                                        }}
                                    />
                                </div>
                                {errors.rut && <div className="form-error">{errors.rut}</div>}
                                <div className="form-hint">Ingrese el RUT con puntos y guión</div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="form-group">
                                    <label className="form-label">Nombre *</label>
                                    <input
                                        type="text"
                                        name="nombre"
                                        value={formData.nombre}
                                        onChange={handleChange}
                                        placeholder="Juan"
                                        className={`form-input ${errors.nombre ? 'error' : ''}`}
                                    />
                                    {errors.nombre && <div className="form-error">{errors.nombre}</div>}
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Apellido</label>
                                    <input
                                        type="text"
                                        name="apellido"
                                        value={formData.apellido}
                                        onChange={handleChange}
                                        placeholder="Pérez"
                                        className="form-input"
                                    />
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    <FiBriefcase style={{ display: 'inline', marginRight: '8px' }} />
                                    Cargo *
                                </label>
                                <select
                                    name="cargo"
                                    value={formData.cargo}
                                    onChange={handleChange}
                                    className={`form-input form-select ${errors.cargo ? 'error' : ''}`}
                                >
                                    <option value="">Seleccione un cargo</option>
                                    {cargos.map((cargo) => (
                                        <option key={cargo} value={cargo}>{cargo}</option>
                                    ))}
                                </select>
                                {errors.cargo && <div className="form-error">{errors.cargo}</div>}
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    <FiMail style={{ display: 'inline', marginRight: '8px' }} />
                                    Email
                                </label>
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    placeholder="juan.perez@empresa.cl"
                                    className="form-input"
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    <FiPhone style={{ display: 'inline', marginRight: '8px' }} />
                                    Teléfono
                                </label>
                                <input
                                    type="tel"
                                    name="telefono"
                                    value={formData.telefono}
                                    onChange={handleChange}
                                    placeholder="+56 9 1234 5678"
                                    className="form-input"
                                />
                            </div>

                            <div className="flex gap-3 mt-6">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => navigate('/workers')}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={loading}
                                    style={{ flex: 1 }}
                                >
                                    {loading ? (
                                        <div className="spinner" />
                                    ) : (
                                        <>
                                            Continuar
                                            <FiArrowRight />
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {/* Step 2a: Create PIN */}
                {step === 'create-pin' && (
                    <div className="card" style={{ maxWidth: '500px', margin: '0 auto' }}>
                        <h2 className="card-title mb-4">Crear PIN de Seguridad</h2>
                        <p className="text-muted mb-6">
                            El trabajador debe crear un PIN de 4 dígitos. Este PIN será utilizado
                            para firmar documentos y validar su identidad en el sistema.
                        </p>

                        <div className="alert alert-info mb-4">
                            <strong>Importante:</strong> El PIN es personal e intransferible.
                            Se recomienda no usar secuencias obvias como 1234 o fechas de nacimiento.
                        </div>

                        <PinInput
                            onComplete={handleCreatePin}
                            mode="create"
                            error={pinError}
                            disabled={loading}
                        />

                        <div className="flex gap-3 mt-6">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setStep('data')}
                                disabled={loading}
                            >
                                <FiArrowLeft />
                                Volver
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 2b: Confirm PIN */}
                {step === 'confirm-pin' && (
                    <div className="card" style={{ maxWidth: '500px', margin: '0 auto' }}>
                        <h2 className="card-title mb-4">Confirmar PIN</h2>
                        <p className="text-muted mb-6">
                            Ingrese nuevamente el PIN para confirmar que lo recuerda correctamente.
                        </p>

                        <PinInput
                            onComplete={handleConfirmPin}
                            mode="confirm"
                            error={pinError}
                            disabled={loading}
                        />

                        <div className="flex gap-3 mt-6">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => {
                                    setNewPin('');
                                    setPinError('');
                                    setStep('create-pin');
                                }}
                                disabled={loading}
                            >
                                <FiArrowLeft />
                                Crear otro PIN
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 3: Sign Enrollment */}
                {step === 'sign' && (
                    <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
                        <h2 className="card-title mb-4">Firma de Enrolamiento</h2>
                        <p className="text-muted mb-6">
                            El trabajador debe firmar digitalmente para completar el proceso de enrolamiento.
                            Esta firma autoriza el uso del sistema para futuras firmas de documentos.
                        </p>

                        <div className="alert alert-info mb-4">
                            <strong>Datos de la firma:</strong>
                            <br />
                            Nombre: {formData.nombre} {formData.apellido}
                            <br />
                            RUT: {formData.rut}
                            <br />
                            Fecha: {new Date().toLocaleDateString('es-CL')}
                            <br />
                            Hora: {new Date().toLocaleTimeString('es-CL')}
                        </div>

                        <div style={{
                            background: 'rgba(245, 158, 11, 0.1)',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            borderRadius: 'var(--radius-md)',
                            padding: 'var(--space-4)',
                            marginBottom: 'var(--space-4)',
                            fontSize: 'var(--text-sm)',
                            color: 'var(--warning-600)'
                        }}>
                            Al ingresar su PIN, usted acepta que sus datos han sido verificados
                            y autoriza el uso de firma digital para documentos laborales según
                            la normativa vigente (DS 44).
                        </div>

                        <PinInput
                            onComplete={handleSign}
                            mode="verify"
                            title="Ingrese su PIN para firmar"
                            subtitle="Confirme su identidad con el PIN creado"
                            error={pinError}
                            disabled={loading}
                        />

                        <div className="flex gap-3 mt-6">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setStep('confirm-pin')}
                                disabled={loading}
                            >
                                <FiArrowLeft />
                                Volver
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 4: Complete */}
                {step === 'complete' && (
                    <div className="card" style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
                        <div
                            className="avatar avatar-lg"
                            style={{
                                background: 'var(--success-500)',
                                margin: '0 auto var(--space-6)',
                                width: '80px',
                                height: '80px',
                                fontSize: 'var(--text-3xl)'
                            }}
                        >
                            <FiCheck />
                        </div>

                        <h2 className="card-title mb-4">¡Enrolamiento Exitoso!</h2>
                        <p className="text-muted mb-6">
                            El trabajador <strong>{formData.nombre} {formData.apellido}</strong> ha sido
                            enrolado exitosamente en el sistema. Ya puede firmar documentos y registrar
                            asistencia a actividades.
                        </p>

                        <div
                            className="flex flex-col gap-2 mb-6"
                            style={{
                                background: 'var(--surface-elevated)',
                                padding: 'var(--space-4)',
                                borderRadius: 'var(--radius-md)'
                            }}
                        >
                            <div className="flex justify-between">
                                <span className="text-muted">RUT:</span>
                                <span className="font-bold">{formData.rut}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted">Cargo:</span>
                                <span className="font-bold">{formData.cargo}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted">Fecha:</span>
                                <span className="font-bold">{new Date().toLocaleDateString('es-CL')}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted">Token de Firma:</span>
                                <span className="font-bold" style={{ fontSize: 'var(--text-xs)', fontFamily: 'monospace' }}>
                                    {signatureToken}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted">Estado:</span>
                                <span style={{
                                    color: 'var(--success-500)',
                                    fontWeight: 600,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}>
                                    <FiShield size={14} />
                                    Habilitado
                                </span>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                className="btn btn-secondary"
                                onClick={() => {
                                    setStep('data');
                                    setFormData({
                                        rut: '',
                                        nombre: '',
                                        apellido: '',
                                        email: '',
                                        telefono: '',
                                        cargo: '',
                                    });
                                    setWorkerId(null);
                                    setNewPin('');
                                    setSignatureToken('');
                                    setError('');
                                    setPinError('');
                                }}
                                style={{ flex: 1 }}
                            >
                                Enrolar Otro
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => navigate('/workers')}
                                style={{ flex: 1 }}
                            >
                                Ver Trabajadores
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
