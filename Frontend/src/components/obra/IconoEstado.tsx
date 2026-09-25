import { LuClock } from 'react-icons/lu';
import type { EstadoRequisito } from '../../utils/completitud';

/** Ícono de estado de un requisito, el mismo en la obra y en el repositorio. */
export default function IconoEstado({ estado }: { estado: EstadoRequisito }) {
    if (estado === 'Cumplido') {
        return (
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" fill="var(--ob-ok-fill)" />
                <path d="m7.5 12 3 3 6-6" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (estado === 'Parcial') {
        return (
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" fill="none" stroke="var(--ob-par-fill)" strokeWidth="2" />
                <path d="M12 3a9 9 0 0 1 0 18Z" fill="var(--ob-par-fill)" />
            </svg>
        );
    }
    if (estado === 'Vencido') return <LuClock size={20} color="var(--ob-ven-fill)" aria-hidden="true" />;
    if (estado === 'Pendiente') {
        return (
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" fill="none" stroke="var(--text-muted)" strokeWidth="2" />
            </svg>
        );
    }
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="none" stroke="var(--surface-border)" strokeWidth="2" />
            <path d="M8 12h8" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}
