import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersApi } from '../api/client';
import { FiShield, FiArrowRight, FiCheckCircle } from 'react-icons/fi';

export default function RegisterAdmin() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [successData, setSuccessData] = useState<{ password?: string; rut: string } | null>(null);
    const [formData, setFormData] = useState({
        rut: '',
        nombre: '',
        apellido: '',
        email: ''
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            // Creamos el admin inicial
            const response = await usersApi.create({
                ...formData,
                rol: 'admin',
                cargo: 'Administrador General'
            });

            console.log('API Response:', response);
            if (response.success && response.data) {
                console.log('Success condition met. Data:', response.data);
                setSuccessData({
                    password: (response.data as any).passwordTemporal,
                    rut: formData.rut
                });
            } else {
                console.error('Success condition failed:', response);
                setError(response.error || 'Error al crear el administrador inicial');
            }
        } catch (err) {
            setError('Error de conexión con el servidor. Verifique que el backend esté desplegado.');
        } finally {
            setLoading(false);
        }
    };

    if (successData) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-surface-base p-4">
                <div className="card max-w-md w-full text-center">
                    <div className="flex justify-center mb-4 text-success-500">
                        <FiCheckCircle size={64} />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">¡Administrador Creado!</h2>
                    <p className="text-text-muted mb-6">
                        Guarde estas credenciales en un lugar seguro. Solo se muestran una vez.
                    </p>

                    <div className="bg-surface-elevated p-6 rounded-lg font-mono mb-6 text-left border border-success-500/30">
                        <div className="mb-2">
                            <span className="text-text-muted">RUT:</span> <br />
                            <span className="text-xl font-bold">{successData.rut}</span>
                        </div>
                        <div>
                            <span className="text-text-muted">CONTRASEÑA TEMPORAL:</span> <br />
                            <span className="text-2xl font-bold text-primary-500 break-all">{successData.password || '******'}</span>
                        </div>
                    </div>

                    <button
                        onClick={() => navigate('/login')}
                        className="btn btn-primary w-full"
                    >
                        Ir al Login
                        <FiArrowRight className="ml-2" />
                    </button>

                    <p className="mt-4 text-xs text-text-muted">
                        Se le solicitará cambiar esta contraseña y configurar su PIN de firma en su primer acceso.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-surface-base">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex justify-center mb-6">
                    <div className="avatar avatar-lg bg-primary-500">
                        <FiShield size={32} />
                    </div>
                </div>
                <h2 className="text-center text-3xl font-extrabold text-text-primary">
                    Configuración Inicial
                </h2>
                <p className="mt-2 text-center text-sm text-text-muted">
                    Crear primer usuario Administrador del sistema
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="card">
                    <form className="space-y-4" onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label className="form-label">RUT</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="12.345.678-9"
                                value={formData.rut}
                                onChange={(e) => setFormData({ ...formData, rut: e.target.value })}
                                required
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="form-group">
                                <label className="form-label">Nombre</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Juan"
                                    value={formData.nombre}
                                    onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Apellido</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Pérez"
                                    value={formData.apellido}
                                    onChange={(e) => setFormData({ ...formData, apellido: e.target.value })}
                                    required
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Email</label>
                            <input
                                type="email"
                                className="form-input"
                                placeholder="admin@empresa.cl"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                required
                            />
                        </div>

                        {error && (
                            <div className="p-3 bg-danger-500/10 border border-danger-500/20 rounded text-danger-500 text-sm">
                                {error}
                            </div>
                        )}

                        <div className="pt-2">
                            <button
                                type="submit"
                                className="btn btn-primary w-full"
                                disabled={loading}
                            >
                                {loading ? 'Creando...' : 'Registrar Administrador'}
                            </button>
                        </div>

                        <p className="text-[10px] text-text-muted text-center mt-4">
                            Este formulario es solo para el primer uso del sistema.
                            Posteriormente use el panel de gestión de usuarios.
                        </p>
                    </form>
                </div>
            </div>
        </div>
    );
}
