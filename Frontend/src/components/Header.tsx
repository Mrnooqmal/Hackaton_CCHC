import { FiBell, FiUser } from 'react-icons/fi';

interface HeaderProps {
    title: string;
}

export default function Header({ title }: HeaderProps) {
    return (
        <header className="header">
            <h1 className="header-title">{title}</h1>

            <div className="header-actions">
                <button className="btn btn-ghost btn-icon" title="Notificaciones">
                    <FiBell />
                </button>
                <div className="avatar">
                    <FiUser />
                </div>
            </div>
        </header>
    );
}
