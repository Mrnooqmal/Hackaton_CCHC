import { Link } from 'react-router-dom';
import Callout from './Callout';
import { permisoDePagina } from './manualNav';
import { useFiltroManual } from './filtro';

// Portada del manual, con dos entradas: por tarea ("¿Qué quieres hacer?") y por
// rol ("Soy…"). Las tareas que la persona no puede hacer no aparecen, con el
// mismo filtro por permiso que el menú.

const TAREAS = [
    { q: 'Firmar un documento o mi asistencia', to: 'terreno/firmar' },
    { q: 'Responder una encuesta', to: 'terreno/encuestas' },
    { q: 'Reportar un hallazgo o un incidente', to: 'terreno/reportar' },
    { q: 'Entrar por primera vez o recuperar mi contraseña', to: 'empezar/ingresar' },
    { q: 'Usar la ayuda y los recorridos guiados', to: 'empezar/ayuda' },
    { q: 'Ver o corregir mis datos personales', to: 'terreno/mis-datos' },
    { q: 'Programar una charla o planificar el mes', to: 'obra/actividades' },
    { q: 'Registrar la asistencia de una charla', to: 'obra/asistencia' },
    { q: 'Ver qué le falta a la obra', to: 'obra/cumplimiento' },
    { q: 'Subir un documento o una nueva versión', to: 'obra/documentos' },
    { q: 'Registrar una entrega de EPP', to: 'obra/epp' },
    { q: 'Dar de alta a una persona', to: 'empresa/personas' },
    { q: 'Crear una obra', to: 'empresa/obras' },
];

const ROLES = [
    { title: 'Trabajador', details: 'Firmar, responder encuestas y reportar hallazgos.', to: 'roles/trabajador' },
    { title: 'Supervisor', details: 'Completar y dictar las charlas de tu cuadrilla y registrar su asistencia.', to: 'roles/supervisor' },
    { title: 'Prevencionista', details: 'Documentos, capacitaciones, EPP e incidentes de la obra.', to: 'roles/prevencionista' },
    { title: 'Jefe de obra', details: 'El equipo de la obra, sus documentos y su avance.', to: 'roles/jefe-obra' },
    { title: 'Administrador', details: 'Personas, obras, roles y cargos de la empresa.', to: 'roles/administrador' },
];

export default function ManualHome() {
    const { puede } = useFiltroManual();
    const tareas = TAREAS.filter((t) => puede(permisoDePagina(t.to)));

    return (
        <div className="manual-home">
            <section className="manual-hero">
                <div className="manual-hero__text">
                    <h1 className="manual-hero__name">Build &amp; Serve</h1>
                    <p className="manual-hero__title">Manual de uso</p>
                    <p className="manual-hero__tagline">
                        Cómo registrar y custodiar en la plataforma la evidencia preventiva de tus obras.
                    </p>
                    <div className="manual-hero__actions">
                        <Link to="/manual/empezar/" className="btn btn-primary">Empezar →</Link>
                        <Link to="/manual/roles/" className="btn btn-secondary">Qué hago según mi rol</Link>
                    </div>
                </div>
            </section>

            <section className="manual-prose">
                <h2>¿Qué quieres hacer?</h2>
                <table>
                    <tbody>
                        {tareas.map((t) => (
                            <tr key={t.to}>
                                <td><Link to={`/manual/${t.to}`}>{t.q}</Link></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            <section className="manual-prose">
                <h2>Soy…</h2>
            </section>
            <section className="manual-features">
                {ROLES.map((r) => (
                    <Link key={r.to} to={`/manual/${r.to}`} className="manual-feature-card">
                        <h3 className="manual-feature-card__title">{r.title}</h3>
                        <p className="manual-feature-card__details">{r.details}</p>
                        <span className="manual-feature-card__cta">Ver mis tareas →</span>
                    </Link>
                ))}
            </section>

            <section className="manual-prose">
                <Callout type="warning" title="Validez del PIN como firma">
                    <p>
                        La validez jurídica del PIN como firma electrónica está en consulta. La firma
                        funciona y deja trazabilidad completa, pero <strong>no debe usarse como única
                        prueba legal</strong> hasta tener respuesta oficial. Ver{' '}
                        <Link to="/manual/fuf/firmas">Firmas</Link>.
                    </p>
                </Callout>
            </section>
        </div>
    );
}
