/**
 * Catálogos de actividades, compartidos por la lista, el calendario y los dos
 * formularios a pantalla completa (Nueva actividad / Planificar el mes).
 *
 * Vivían como constantes locales de Activities.tsx; con los formularios ahora
 * en sus propias páginas, cada una necesitaba su propia copia. Un solo
 * catálogo evita que las tres se desincronicen si el backend agrega un tipo.
 */
import {
    FiMessageSquare, FiAlertTriangle, FiBook, FiAward, FiSearch, FiUsers, FiFileText,
} from 'react-icons/fi';

// Semáforo de seguimiento → clase de badge existente (usado solo en el
// detalle de una actividad; la lista y el historial ya no lo muestran fila
// por fila — ver ACTIVITIES_REDESIGN en Activities.tsx).
export const NIVEL_BADGE: Record<string, string> = { verde: 'success', amarillo: 'warning', rojo: 'danger', neutral: 'neutral' };

export const ACTIVITY_TYPES: Record<string, { label: string; color: string; icon: React.ReactElement }> = {
    CHARLA_5MIN: { label: 'Charla 5 Minutos', color: 'var(--primary-500)', icon: <FiMessageSquare /> },
    ART: { label: 'Análisis de Riesgos', color: 'var(--warning-500)', icon: <FiAlertTriangle /> },
    CAPACITACION: { label: 'Capacitación', color: 'var(--info-500)', icon: <FiBook /> },
    INDUCCION: { label: 'Inducción', color: 'var(--success-500)', icon: <FiAward /> },
    INSPECCION: { label: 'Inspección', color: 'var(--accent-500)', icon: <FiSearch /> },
    REUNION_COMITE: { label: 'Reunión Comité Paritario', color: 'var(--secondary-500, #7c3aed)', icon: <FiUsers /> },
    SIMULACRO: { label: 'Simulacro de Emergencia', color: 'var(--danger-500, #dc2626)', icon: <FiAlertTriangle /> },
    // Casos no contemplados en el catálogo: el detalle va en el título/descripción.
    OTRO: { label: 'Otra actividad', color: 'var(--gray-500)', icon: <FiFileText /> },
};

// Etapas constructivas de la obra: dimensión "tipo de trabajo" de la planificación
// (misma nomenclatura que Obra.etapaConstructivaActual en el backend).
export const TIPOS_TRABAJO: Record<string, string> = {
    excavacion: 'Excavación',
    obra_gruesa: 'Obra gruesa',
    terminaciones: 'Terminaciones',
    entrega: 'Entrega',
};

// Subtipos de CAPACITACION segun el DS44 (deben coincidir con CAPACITACION_SUBTIPOS del backend).
export const CAPACITACION_SUBTIPOS: Record<string, string> = {
    PRL_8H: 'Prevención de Riesgos Laborales (8h) — Art. 16',
    EPP: 'Uso y mantención de EPP — Art. 13',
    CPHS_ORIENTACION: 'Orientación CPHS (8h) — Art. 32',
    CPHS_20H: 'Curso 20h CPHS — Art. 32',
    DELEGADO: 'Capacitación Delegado SST — Art. 66',
    ENCARGADO: 'Encargado Gestión del Riesgo — Art. 65',
    OTRA: 'Otra capacitación',
};

// Opciones de periodicidad para actividades recurrentes.
export const FRECUENCIA_OPCIONES: Record<'unica' | 'diaria' | 'semanal' | 'mensual', string> = {
    unica: 'Una vez (sin repetir)',
    diaria: 'Diaria',
    semanal: 'Semanal',
    mensual: 'Mensual',
};
export const labelFrecuencia = (f: 'unica' | 'diaria' | 'semanal' | 'mensual') => FRECUENCIA_OPCIONES[f].toLowerCase();
