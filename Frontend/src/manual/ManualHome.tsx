import { Link } from 'react-router-dom';
import Callout from './Callout';

const FEATURES = [
    { icon: '🚀', title: 'Guía de Inicio', details: 'Instalación, configuración y onboarding de un nuevo tenant en la plataforma.', link: '/manual/guia-inicio/' },
    { icon: '📋', title: 'DS44 & Normativa', details: 'Cumplimiento del Supremo Decreto 44. Documentos obligatorios, fases de obra y firmas.', link: '/manual/ds44/' },
    { icon: '🧩', title: 'Módulos', details: 'Documentación completa de los módulos de la plataforma.', link: '/manual/modulos/' },
    { icon: '👥', title: 'Roles de Usuario', details: 'Qué puede hacer cada rol. Tabla comparativa de permisos por módulo.', link: '/manual/roles/' },
];

const MAPA = [
    { q: 'Ingresar a la plataforma por primera vez', to: '/manual/guia-inicio/instalacion', txt: 'Cómo ingresar' },
    { q: 'Poner una obra en marcha paso a paso', to: '/manual/guia-inicio/primeros-pasos', txt: 'Primeros pasos' },
    { q: 'Entender qué exige el DS 44', to: '/manual/ds44/', txt: '¿Qué es el DS 44?' },
    { q: 'Aprender a usar cada parte de la plataforma', to: '/manual/modulos/', txt: 'Módulos' },
    { q: 'Saber qué puede hacer mi rol', to: '/manual/roles/', txt: 'Roles de Usuario' },
];

export default function ManualHome() {
    return (
        <div className="manual-home">
            <section className="manual-hero">
                <img src="/logo-bs.svg" alt="Build & Serve" className="manual-hero__logo" />
                <div className="manual-hero__text">
                    <h1 className="manual-hero__name">Build &amp; Serve</h1>
                    <p className="manual-hero__title">Manual de Uso Oficial</p>
                    <p className="manual-hero__tagline">
                        Plataforma de gestión de Seguridad y Salud en el Trabajo (SST) para
                        obras de construcción · CCHC Chile
                    </p>
                    <div className="manual-hero__actions">
                        <Link to="/manual/guia-inicio/" className="btn btn-primary">Guía de Inicio →</Link>
                        <Link to="/manual/modulos/" className="btn btn-secondary">Ver módulos</Link>
                        <Link to="/manual/ds44/" className="btn btn-secondary">Cumplimiento DS 44</Link>
                    </div>
                </div>
            </section>

            <section className="manual-features">
                {FEATURES.map((f) => (
                    <Link key={f.link} to={f.link} className="manual-feature-card">
                        <span className="manual-feature-card__icon">{f.icon}</span>
                        <h3 className="manual-feature-card__title">{f.title}</h3>
                        <p className="manual-feature-card__details">{f.details}</p>
                    </Link>
                ))}
            </section>

            <section className="manual-prose">
                <h2>¿Qué es Build &amp; Serve?</h2>
                <p>
                    <strong>Build &amp; Serve</strong> es una plataforma SaaS multi-tenant que
                    digitaliza la gestión de Seguridad y Salud en el Trabajo (SST) en obras de
                    construcción chilenas. Reemplaza los procesos basados en papel por un sistema
                    único que centraliza documentos, firmas, incidentes, capacitaciones y
                    reportería, con cumplimiento integrado del <strong>Supremo Decreto 44</strong>.
                </p>

                <Callout type="warning" title="Consulta legal pendiente">
                    <p>
                        La validez jurídica del PIN como firma electrónica ante un fiscalizador del
                        DS 44 está siendo evaluada con la Dirección del Trabajo. La funcionalidad
                        opera con normalidad, pero <strong>no debe usarse como única prueba legal</strong>
                        {' '}hasta obtener respuesta oficial. Más detalles en{' '}
                        <Link to="/manual/ds44/firmas-digitales">Firmas digitales y DS44</Link>.
                    </p>
                </Callout>

                <h2>Mapa rápido</h2>
                <table>
                    <thead><tr><th>Quiero…</th><th>Ir a</th></tr></thead>
                    <tbody>
                        {MAPA.map((r) => (
                            <tr key={r.to}>
                                <td>{r.q}</td>
                                <td><Link to={r.to}>{r.txt}</Link></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
        </div>
    );
}
