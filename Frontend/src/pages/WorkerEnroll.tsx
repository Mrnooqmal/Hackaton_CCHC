import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import SignaturePad from '../components/SignaturePad';
import { FiUser, FiMail, FiPhone, FiBriefcase, FiCheck, FiArrowRight, FiArrowLeft } from 'react-icons/fi';
import { workersApi, type CreateWorkerData } from '../api/client';

type Step = 'data' | 'sign' | 'complete';

export default function WorkerEnroll() {
    const navigate = useNavigate();
    const [step, setStep] = useState<Step>('data');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [workerId, setWorkerId] = useState<string | null>(null);

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
        // Formato básico: 12.345.678-9 o 12345678-9
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

        // Limpiar error del campo cuando se modifica
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
                setStep('sign');
            } else {
                setError(response.error || 'Error al registrar trabajador');
            }
        } catch (err) {
            setError('Error de conexión con el servidor');
        } finally {
            setLoading(false);
        }
    };

    const handleSign = async (signatureData: string) => {
        if (!workerId) return;

        setLoading(true);
        try {
            const response = await workersApi.sign(workerId, { tipo: 'enrolamiento' });

            if (response.success) {
                setStep('complete');
            } else {
                setError(response.error || 'Error al registrar firma');
            }
        } catch (err) {
            setError('Error de conexión con el servidor');
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

    return (
        <>
            <Header title="Enrolamiento de Trabajador" />

            <div className="main-content">
                {/* Progress Steps */}
                <div className="card mb-6">
                    <div className="flex items-center justify-center gap-4">
                        <div className={`flex items-center gap-2 ${step === 'data' ? 'text-primary' : ''}`}>
                            <div
                                className="avatar avatar-sm"
                                style={{
                                    background: step === 'data' ? 'var(--primary-500)' :
                                        step !== 'data' ? 'var(--success-500)' : 'var(--gray-600)'
                                }}
                            >
                                {step !== 'data' ? <FiCheck /> : '1'}
                            </div>
                            <span className="font-bold">Datos Personales</span>
                        </div>

                        <div style={{ width: '60px', height: '2px', background: 'var(--surface-border)' }} />

                        <div className={`flex items-center gap-2 ${step === 'sign' ? 'text-primary' : ''}`}>
                            <div
                                className="avatar avatar-sm"
                                style={{
                                    background: step === 'sign' ? 'var(--primary-500)' :
                                        step === 'complete' ? 'var(--success-500)' : 'var(--gray-600)'
                                }}
                            >
                                {step === 'complete' ? <FiCheck /> : '2'}
                            </div>
                            <span className={step === 'data' ? 'text-muted' : 'font-bold'}>Firma Digital</span>
                        </div>

                        <div style={{ width: '60px', height: '2px', background: 'var(--surface-border)' }} />

                        <div className={`flex items-center gap-2 ${step === 'complete' ? 'text-primary' : ''}`}>
                            <div
                                className="avatar avatar-sm"
                                style={{
                                    background: step === 'complete' ? 'var(--success-500)' : 'var(--gray-600)'
                                }}
                            >
                                {step === 'complete' ? <FiCheck /> : '3'}
                            </div>
                            <span className={step !== 'complete' ? 'text-muted' : 'font-bold'}>Completado</span>
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

                {/* Step 2: Signature */}
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

                        <SignaturePad
                            onSign={handleSign}
                            workerName={`${formData.nombre} ${formData.apellido}`}
                            workerRut={formData.rut}
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

                {/* Step 3: Complete */}
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
