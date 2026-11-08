import { useEffect, useState } from 'react';
import { privacidadApi, type AvisoPrivacidad as Aviso } from '../../api/gobernanza.api';
import '../../css/aviso-privacidad.css';

/**
 * Aviso de privacidad (deber de información, Ley 21.719).
 *
 * Se muestra en "Mis datos y privacidad" y en el enrolamiento —propio y
 * asistido—, que es cuando se recogen los datos. El contenido lo arma el
 * servidor desde el inventario de datos (Backend/lib/gobernanza/aviso.js): las
 * categorías, finalidades y plazos son los mismos que usa la retención.
 */
export default function AvisoPrivacidad({ compacto = false }: { compacto?: boolean }) {
    const [aviso, setAviso] = useState<Aviso | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let vivo = true;
        privacidadApi.aviso()
            .then((r) => {
                if (!vivo) return;
                if (r.success && r.data) setAviso(r.data);
                else setError(r.error || 'No se pudo cargar el aviso de privacidad.');
            })
            .catch(() => vivo && setError('No se pudo cargar el aviso de privacidad. Revisa tu conexión.'));
        return () => { vivo = false; };
    }, []);

    if (error) return <p className="form-error" role="alert">{error}</p>;
    if (!aviso) return <div className="aviso-privacidad__cargando"><div className="spinner" /></div>;

    const fuera = aviso.encargados.filter((e) => e.transferenciaInternacional);
    return (
        <div className={`aviso-privacidad${compacto ? ' aviso-privacidad--compacto' : ''}`}>
            <section>
                <h3>Quién trata tus datos</h3>
                <p><strong>{aviso.responsable.nombre}</strong>: {aviso.responsable.rol}</p>
                <ul>
                    {aviso.encargados.map((e) => (
                        <li key={e.quien}>
                            <strong>{e.quien}</strong> ({e.donde}). {e.que}
                        </li>
                    ))}
                </ul>
                {fuera.length > 0 && (
                    <p className="aviso-privacidad__destacado">
                        Tus datos se alojan fuera de Chile: {fuera.map((e) => `${e.quien} en ${e.donde}`).join('; ')}.
                    </p>
                )}
            </section>

            <section>
                <h3>Qué datos, para qué y cuánto tiempo</h3>
                <div className="aviso-privacidad__tabla" role="region" aria-label="Datos que se tratan" tabIndex={0}>
                    <table>
                        <thead>
                            <tr><th scope="col">Categoría</th><th scope="col">Para qué</th><th scope="col">Cuánto tiempo</th></tr>
                        </thead>
                        <tbody>
                            {aviso.tratamientos.map((t) => (
                                <tr key={t.categoria}>
                                    <th scope="row">{t.categoria}{t.contieneSalud ? ' *' : ''}</th>
                                    <td>{t.finalidad}</td>
                                    <td>{t.conservacion}{t.alVencer ? `. ${t.alVencer}.` : ''}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="aviso-privacidad__nota">* {aviso.datosSensibles}</p>
                <p>{aviso.enElEquipo}</p>
            </section>

            <section>
                <h3>Por qué se tratan</h3>
                <ul>
                    {aviso.bases.map((b) => <li key={b.tratamiento}><strong>{b.tratamiento}.</strong> {b.base}</li>)}
                </ul>
                <p>
                    Solo con tu autorización: {aviso.consentimientos.map((c) => c.nombre.toLowerCase()).join(', ')}.
                    {' '}Puedes darla o retirarla en Mis datos y privacidad.
                </p>
            </section>

            <section>
                <h3>Tus derechos</h3>
                <ul>
                    {aviso.derechos.map((d) => <li key={d.derecho}><strong>{d.derecho}.</strong> {d.que}</li>)}
                </ul>
                <p>{aviso.plazos.texto}</p>
                <p>{aviso.responsable.contacto}</p>
                <p className="aviso-privacidad__destacado">{aviso.reclamo}</p>
            </section>
            <p className="aviso-privacidad__nota">Versión del aviso: {aviso.version}.</p>
        </div>
    );
}
