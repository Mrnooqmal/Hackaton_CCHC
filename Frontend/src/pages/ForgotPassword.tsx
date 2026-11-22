import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../api/client';
import { FiUser, FiArrowLeft, FiArrowRight, FiMail } from 'react-icons/fi';
import TarjetaAcceso from '../components/TarjetaAcceso';

// Formatea el RUT mientras se escribe (igual que en el login).
const rutFormat = (raw: string) => {
    const clean = raw.replace(/[^0-9kK]/g, '').toUpperCase();
    if (clean.length < 2) return clean;
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);
    return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
};

const Volver = () => (
    <div className="lp-foot">
        <Link to="/login" className="lp-foot-link"><FiArrowLeft size={14} /> Volver al inicio de sesión</Link>
    </div>
);

export default function ForgotPassword() {
    const [rut, setRut] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // El backend responde siempre genérico (anti-enumeración): mostramos un
    // mensaje de "revisa tu correo" sin confirmar si el RUT existe.
    const [sent, setSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!rut.trim()) { setError('Ingresa tu RUT'); return; }
        setLoading(true); setError('');
        try {
            const res = await authApi.forgotPassword(rut.trim());
            if (res.success) setSent(true);
            else setError(res.error || 'No se pudo procesar la solicitud');
        } catch {
            setError('Error de conexión con el servidor');
        } finally {
            setLoading(false);
        }
    };

    if (sent) {
        return (
            <TarjetaAcceso>
                <div className="lp-body onb-resultado" role="status">
                    <span className="onb-resultado-icono onb-resultado-icono--ok"><FiMail size={26} /></span>
                    <h1 className="lp-title">Revisa tu correo</h1>
                    <p className="lp-hint">
                        Si el RUT está registrado y tiene un correo asociado, te enviamos un enlace para
                        restablecer tu contraseña. El enlace caduca en 30 minutos.
                    </p>
                </div>
                <Volver />
            </TarjetaAcceso>
        );
    }

    return (
        <TarjetaAcceso>
            <div className="lp-body">
                <h1 className="lp-title">Recuperar contraseña</h1>
                <p className="lp-hint">Ingresa tu RUT y te enviaremos un enlace a tu correo para crear una nueva contraseña.</p>

                <form className="lp-form" onSubmit={handleSubmit} noValidate>
                    <div className="lp-field">
                        <label className="lp-label" htmlFor="fp-rut">RUT</label>
                        <div className="lp-input-wrap">
                            <span className="lp-input-icon"><FiUser size={15} /></span>
                            <input
                                id="fp-rut"
                                type="text"
                                className="lp-input"
                                placeholder="12.345.678-9"
                                value={rut}
                                onChange={(e) => { setRut(rutFormat(e.target.value)); if (error) setError(''); }}
                                autoComplete="username"
                                autoFocus
                            />
                        </div>
                    </div>

                    {error && <p className="lp-error" role="alert">{error}</p>}

                    <button type="submit" className="lp-submit" disabled={loading}>
                        {loading ? <div className="lp-spinner" /> : <><span>Enviar enlace</span><FiArrowRight size={15} /></>}
                    </button>
                </form>
            </div>
            <Volver />
        </TarjetaAcceso>
    );
}
