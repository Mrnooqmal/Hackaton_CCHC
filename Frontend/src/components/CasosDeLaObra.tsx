import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiAlertTriangle, FiChevronRight } from 'react-icons/fi';
import { incidentsApi, type CasoResumen } from '../api/client';
import { LoadingSpinner } from './ui';
import { plural } from '../utils/plural';

const ETIQUETA_TIPO: Record<string, string> = {
    accidente: 'Accidente',
    incidente: 'Incidente',
    condicion_subestandar: 'Hallazgo · condición subestándar',
    accion_subestandar: 'Hallazgo · acción subestándar',
};

/** AAAA-MM-DD sin zona: con `new Date('2026-11-15')` se leería como UTC y en Chile mostraría el día anterior. */
const fechaCorta = (valor: string | null) => {
    if (!valor) return 'Sin fecha';
    const [a, m, d] = valor.slice(0, 10).split('-').map(Number);
    return a && m && d ? new Date(a, m - 1, d).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : valor;
};

/** "3 de 4 papeles"; un caso que no exige papeles no dice "0 de 0". */
const textoAvance = (c: CasoResumen) =>
    c.avance.total === 0 ? 'No exige papeles' : `${c.avance.cumplidos} de ${plural(c.avance.total, 'papel', 'papeles')}`;

interface Props {
    obraId: string;
}

/**
 * "Casos de incidentes y accidentes" del repositorio de la obra (fase 4 del
 * rediseño): qué casos tiene la obra y cuántos papeles lleva cada uno, para que la
 * empresa vea de un vistazo qué le falta ante una fiscalización.
 *
 * Es una lista, no una carpeta de archivos. Los archivos y su descarga auditada
 * siguen viviendo en el detalle del caso (`/incidents/{id}`): acá no se muestran ni
 * se repiten, y el resumen que llega del servidor no trae nombres, RUT, relato ni
 * claves de archivo. Solo se monta para quien tiene `incidentes.historial` (el
 * padre decide, y el servidor también lo exige).
 */
export default function CasosDeLaObra({ obraId }: Props) {
    // Lo cargado queda junto a la obra para la que se pidió: al cambiar de obra no se
    // muestra, ni por un instante, la lista de la anterior.
    const [cargado, setCargado] = useState<{ obraId: string; casos: CasoResumen[]; error: string } | null>(null);

    useEffect(() => {
        let cancelado = false;
        incidentsApi.getCasosResumen(obraId).then((res) => {
            if (cancelado) return;
            if (res.success && res.data) setCargado({ obraId, casos: res.data, error: '' });
            else setCargado({ obraId, casos: [], error: res.error || 'No se pudieron cargar los casos de la obra.' });
        }).catch(() => {
            if (!cancelado) setCargado({ obraId, casos: [], error: 'Error de conexión al cargar los casos de la obra.' });
        });
        return () => { cancelado = true; };
    }, [obraId]);

    const actual = cargado && cargado.obraId === obraId ? cargado : null;

    return (
        <section style={{ marginTop: 'var(--space-6)' }} aria-labelledby="repo-casos-titulo">
            <h2 id="repo-casos-titulo" style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
                Casos de incidentes y accidentes
            </h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
                Los papeles de cada caso (DIAT, informe de investigación, constancias) se ven y se descargan en el detalle del caso.
            </p>

            {!actual && <LoadingSpinner />}

            {actual?.error && (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{actual.error}</p>
            )}

            {actual && !actual.error && actual.casos.length === 0 && (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Esta obra no tiene casos de incidentes ni accidentes.</p>
            )}

            {actual && actual.casos.length > 0 && (
                <div className="repo-doc-list">
                    {actual.casos.map((c) => {
                        const incompleto = c.avance.cumplidos < c.avance.total;
                        return (
                            <div key={c.incidentId} className="repo-doc">
                                <div className="repo-doc-icon" style={{ color: incompleto && c.estado === 'abierto' ? 'var(--warning-600)' : 'var(--text-muted)' }}>
                                    <FiAlertTriangle size={18} />
                                </div>
                                <div className="repo-doc-main">
                                    <div className="repo-doc-title">
                                        {c.tipo ? ETIQUETA_TIPO[c.tipo] || c.tipo : 'Caso'}
                                        {c.gravedad && c.gravedad !== 'leve' ? ` · ${c.gravedad}` : ''}
                                    </div>
                                    <div className="repo-doc-meta">
                                        <span className={`badge ${c.estado === 'cerrado' ? 'badge-neutral' : 'badge-secondary'}`}>
                                            {c.estado === 'cerrado' ? 'Cerrado' : 'Abierto'}
                                        </span>
                                        <span>{fechaCorta(c.fecha)}</span>
                                        <span>· {textoAvance(c)}</span>
                                        {!c.clasificado && <span>· Sin clasificar</span>}
                                    </div>
                                </div>
                                <div className="repo-doc-actions">
                                    <Link to={`/incidents/${c.incidentId}`} className="btn btn-ghost btn-sm">
                                        Ver caso <FiChevronRight />
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
