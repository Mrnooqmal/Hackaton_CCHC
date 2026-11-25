import { Badge } from './ui';
import type { Incident } from '../api/client';
import type { EstadoMedida } from '../utils/casos';

const ETIQUETA_ESTADO: Record<EstadoMedida, string> = {
    pendiente: 'Pendiente',
    en_proceso: 'En proceso',
    completada: 'Completada',
    verificada: 'Verificada',
};

const ETIQUETA_JERARQUIA: Record<string, string> = {
    eliminacion: 'Eliminar el peligro',
    sustitucion: 'Sustituir por algo menos peligroso',
    ingenieria: 'Control de ingeniería',
    administrativa: 'Control administrativo',
    epp: 'Elementos de protección personal',
};

const VARIANTE_ESTADO: Record<EstadoMedida, 'neutral' | 'info' | 'success'> = {
    pendiente: 'neutral',
    en_proceso: 'info',
    completada: 'success',
    verificada: 'success',
};

/** AAAA-MM-DD sin zona: con `new Date('2026-11-15')` se leería como UTC y en Chile mostraría el día anterior. */
const fechaCorta = (aaaammdd?: string | null) => {
    const [a, m, d] = String(aaaammdd || '').slice(0, 10).split('-').map(Number);
    return a && m && d ? new Date(a, m - 1, d).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Sin plazo';
};

/**
 * "Medidas registradas antes": las medidas correctivas que un caso guardó cuando todavía
 * eran datos de la plataforma (texto, responsable, plazo y estado). Hoy las medidas se
 * definen subiendo el plan de medidas correctivas, así que esto es solo lectura: no
 * se crean, no se editan y no se les cambia el estado desde acá. Sin medidas guardadas,
 * no se muestra nada.
 */
export default function MedidasAnteriores({ incidente }: { incidente: Incident }) {
    const medidas = incidente.medidasCorrectivas ?? [];
    if (medidas.length === 0) return null;

    return (
        <section className="inc-ficha-card" aria-label="Medidas registradas antes">
            <div>
                <h2 className="inc-papeles-titulo">Medidas registradas antes</h2>
                <p className="inc-ficha-texto inc-papeles-ayuda">
                    Este caso tiene medidas guardadas en la plataforma antes de que se definieran con un plan de medidas correctivas. Se muestran solo para consulta.
                </p>
            </div>
            <ul className="inc-papeles-lista">
                {medidas.map((m, indice) => {
                    // El servidor numera las medidas antiguas que no traían número; el índice evita que
                    // React repita `key` si aun así llegara una sin número o repetida.
                    const numero = String(m.numero);
                    return (
                        <li key={`${numero}-${indice}`} className="inc-papeles-fila">
                            <div className="inc-papeles-nombre">
                                <div>{numero}. {m.medida}</div>
                                <div className="inc-papeles-meta">
                                    {m.responsableNombre || 'Sin responsable'} · plazo {fechaCorta(m.fechaMaxEjecucion)}
                                    {m.jerarquia ? ` · ${ETIQUETA_JERARQUIA[m.jerarquia] ?? m.jerarquia}` : ''}
                                    {m.causaRaiz ? ` · causa: ${m.causaRaiz}` : ''}
                                </div>
                            </div>
                            <Badge variant={VARIANTE_ESTADO[m.estado] ?? 'neutral'} size="sm">{ETIQUETA_ESTADO[m.estado] ?? m.estado}</Badge>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
