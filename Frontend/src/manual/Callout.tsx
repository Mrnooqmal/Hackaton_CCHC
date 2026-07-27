import type { ReactNode } from 'react';
import { FiAlertTriangle, FiInfo, FiCheckCircle, FiAlertOctagon } from 'react-icons/fi';

type CalloutType = 'warning' | 'tip' | 'info' | 'danger' | 'note' | 'details';

const META: Record<CalloutType, { icon: ReactNode; tituloDefecto: string }> = {
    warning: { icon: <FiAlertTriangle />, tituloDefecto: 'Atención' },
    danger: { icon: <FiAlertOctagon />, tituloDefecto: 'Importante' },
    tip: { icon: <FiCheckCircle />, tituloDefecto: 'Consejo' },
    info: { icon: <FiInfo />, tituloDefecto: 'Nota' },
    note: { icon: <FiInfo />, tituloDefecto: 'Nota' },
    details: { icon: <FiInfo />, tituloDefecto: 'Detalles' },
};

interface CalloutProps {
    type?: string;
    title?: string;
    children?: ReactNode;
}

export default function Callout({ type = 'info', title, children }: CalloutProps) {
    const t = (META[type as CalloutType] ? type : 'info') as CalloutType;
    const { icon, tituloDefecto } = META[t];
    const encabezado = title?.trim() || tituloDefecto;

    return (
        <div className={`manual-callout manual-callout--${t}`}>
            <div className="manual-callout__head">
                <span className="manual-callout__icon" aria-hidden="true">{icon}</span>
                <span className="manual-callout__title">{encabezado}</span>
            </div>
            <div className="manual-callout__body">{children}</div>
        </div>
    );
}
