import { useEffect, useRef, useState } from 'react';
import { FiLogOut, FiUser, FiMenu } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';

interface HeaderProps {
    title: string;
}

const getRoleLabel = (role?: string) => {
    if (role === 'admin') return 'Administrador';
    if (role === 'prevencionista') return 'Prevencionista';
    if (role === 'trabajador') return 'Trabajador';
    return 'Usuario';
};

export default function Header({ title }: HeaderProps) {
    const { user, logout } = useAuth();
    const { toggleMobileMenu } = useLayout();
    const [menuOpen, setMenuOpen] = useState(false);
    const userCardRef = useRef<HTMLDivElement | null>(null);

    const initials = `${user?.nombre?.[0] || ''}${user?.apellido?.[0] || ''}`.trim();

    const handleLogout = () => {
        if (confirm('¿Cerrar sesión?')) {
            logout();
        }
    };

    const toggleMenu = () => {
        setMenuOpen((prev) => !prev);
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (userCardRef.current && !userCardRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };

        if (menuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }

        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [menuOpen]);

    return (
        <header className="header">
            {/* Mobile Menu Button */}
            <button
                className="mobile-menu-button"
                onClick={toggleMobileMenu}
                aria-label="Abrir menú de navegación"
            >
                <FiMenu />
            </button>

            <h1 className="header-title">{title}</h1>

            <div className="header-actions">
                {user ? (
                    <div className="header-user-wrapper" ref={userCardRef}>
                        <button
                            type="button"
                            className="header-user-card"
                            onClick={toggleMenu}
                            aria-haspopup="true"
                            aria-expanded={menuOpen}
                        >
                            <div className="avatar avatar-sm bg-primary-500">
                                {initials || <FiUser />}
                            </div>
                            <div className="header-user-meta">
                                <span className="header-user-name">{user.nombre} {user.apellido}</span>
                                <span className={`user-role-badge role-${user.rol}`}>
                                    {getRoleLabel(user.rol)}
                                </span>
                            </div>
                        </button>
                        {menuOpen && (
                            <div className="header-user-dropdown" role="menu">
                                <button type="button" className="header-user-dropdown-item" onClick={handleLogout}>
                                    <FiLogOut />
                                    Cerrar sesión
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="avatar">
                        <FiUser />
                    </div>
                )}
            </div>
        </header>
    );
}
