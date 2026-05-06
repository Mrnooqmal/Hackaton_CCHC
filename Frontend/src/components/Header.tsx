import { useEffect, useRef, useState } from 'react';
import { FiLogOut, FiUser, FiMenu, FiChevronDown, FiMapPin } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useObraContext } from '../context/ObraContext';
import ConfirmModal from './ConfirmModal';

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
    const { obras, selectedObraId, setSelectedObraId, isLoadingObras } = useObraContext();
    const [menuOpen, setMenuOpen] = useState(false);
    const [obraMenuOpen, setObraMenuOpen] = useState(false);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const userCardRef = useRef<HTMLDivElement | null>(null);
    const obraMenuRef = useRef<HTMLDivElement | null>(null);

    const initials = `${user?.nombre?.[0] || ''}${user?.apellido?.[0] || ''}`.trim();

    const handleLogout = () => {
        setMenuOpen(false);
        setShowLogoutConfirm(true);
    };

    const confirmLogout = () => {
        logout();
        setShowLogoutConfirm(false);
    };

    const toggleMenu = () => {
        setMenuOpen((prev) => !prev);
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (userCardRef.current && !userCardRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
            if (obraMenuRef.current && !obraMenuRef.current.contains(event.target as Node)) {
                setObraMenuOpen(false);
            }
        };

        if (menuOpen || obraMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }

        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [menuOpen, obraMenuOpen]);

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

            <div className="header-actions" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-4)' }}>
                {/* Obra Selector */}
                {user && (user.rol === 'admin' || user.rol === 'prevencionista' || obras.length > 0) && (
                    <div className="header-obra-wrapper" ref={obraMenuRef} style={{ position: 'relative' }}>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                            onClick={() => setObraMenuOpen(!obraMenuOpen)}
                            disabled={isLoadingObras}
                        >
                            <FiMapPin />
                            <span style={{ maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {isLoadingObras ? 'Cargando...' : (
                                    selectedObraId 
                                        ? obras.find(o => o.obraId === selectedObraId)?.nombre || 'Obra Desconocida'
                                        : 'Todas las Obras'
                                )}
                            </span>
                            <FiChevronDown />
                        </button>
                        
                        {obraMenuOpen && (
                            <div className="header-user-dropdown" style={{ minWidth: '220px', left: 0, right: 'auto' }} role="menu">
                                <button
                                    type="button"
                                    className={`header-user-dropdown-item ${!selectedObraId ? 'active' : ''}`}
                                    onClick={() => { setSelectedObraId(null); setObraMenuOpen(false); }}
                                    style={{ fontWeight: !selectedObraId ? 'bold' : 'normal' }}
                                >
                                    Todas las Obras
                                </button>
                                {obras.length > 0 && <div style={{ borderTop: '1px solid var(--surface-border)', margin: '4px 0' }} />}
                                {obras.map(obra => (
                                    <button
                                        key={obra.obraId}
                                        type="button"
                                        className={`header-user-dropdown-item ${selectedObraId === obra.obraId ? 'active' : ''}`}
                                        onClick={() => { setSelectedObraId(obra.obraId); setObraMenuOpen(false); }}
                                        style={{ fontWeight: selectedObraId === obra.obraId ? 'bold' : 'normal' }}
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                            <span>{obra.nombre}</span>
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{obra.etapaActual}</span>
                                        </div>
                                    </button>
                                ))}
                                {obras.length === 0 && !isLoadingObras && (
                                    <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                                        No hay obras disponibles
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
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
            <ConfirmModal
                isOpen={showLogoutConfirm}
                title="¿Cerrar sesión?"
                message="Tu sesión actual terminará y tendrás que volver a ingresar para acceder al sistema."
                confirmLabel="Cerrar Sesión"
                cancelLabel="Mantener Sesión"
                variant="danger"
                onConfirm={confirmLogout}
                onCancel={() => setShowLogoutConfirm(false)}
            />
        </header>
    );
}
