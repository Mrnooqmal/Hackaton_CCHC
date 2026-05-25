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
    if (role === 'jefe_obra') return 'Jefe de Obra';
    if (role === 'supervisor') return 'Supervisor';
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
                {/* Obra Selector — only for obra-contextual roles */}
                {user && ['jefe_obra', 'supervisor', 'prevencionista'].includes(user.rol || '') && obras.length > 0 && (
                    <div className="header-obra-wrapper" ref={obraMenuRef} style={{ position: 'relative' }}>
                        <button
                            type="button"
                            className="btn"
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: 'var(--space-2)',
                                background: 'var(--surface-elevated)',
                                border: '1.5px solid var(--text-primary)',
                                color: 'var(--text-primary)',
                                borderRadius: 'var(--radius-full)',
                                padding: 'var(--space-2) var(--space-4)',
                                height: '36px',
                                fontSize: 'var(--text-xs)',
                                fontWeight: 700,
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                                cursor: 'pointer'
                            }}
                            onClick={() => setObraMenuOpen(!obraMenuOpen)}
                            disabled={isLoadingObras}
                            onMouseOver={(e) => {
                                e.currentTarget.style.background = 'var(--surface-hover)';
                                e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.15)';
                                e.currentTarget.style.transform = 'translateY(-1px)';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.background = 'var(--surface-elevated)';
                                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
                                e.currentTarget.style.transform = 'translateY(0)';
                            }}
                        >
                            <FiMapPin style={{ color: 'var(--text-primary)' }} />
                            <span style={{ maxWidth: '160px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {isLoadingObras ? 'Cargando...' : (
                                    selectedObraId 
                                        ? obras.find(o => o.obraId === selectedObraId)?.nombre || 'Obra Desconocida'
                                        : 'Seleccionar Obra'
                                )}
                            </span>
                            <FiChevronDown style={{ opacity: 0.8 }} />
                        </button>
                        
                        {obraMenuOpen && (
                            <div 
                                className="header-user-dropdown" 
                                style={{ 
                                    minWidth: '260px', 
                                    left: 0, 
                                    right: 'auto',
                                    background: 'var(--surface-card)',
                                    border: '1.5px solid var(--surface-border)',
                                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
                                    borderRadius: 'var(--radius-lg)',
                                    padding: 'var(--space-2)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px',
                                    animation: 'fadeIn 0.15s ease-out'
                                }} 
                                role="menu"
                            >
                                <div style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Seleccionar Obra
                                </div>
                                <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                    {obras.map(obra => {
                                        const isSelected = selectedObraId === obra.obraId;
                                        return (
                                            <button
                                                key={obra.obraId}
                                                type="button"
                                                className={`header-user-dropdown-item ${isSelected ? 'active' : ''}`}
                                                onClick={() => { setSelectedObraId(obra.obraId); setObraMenuOpen(false); }}
                                                style={{ 
                                                    fontWeight: isSelected ? 'bold' : '500',
                                                    background: isSelected ? 'rgba(76, 175, 80, 0.08)' : 'transparent',
                                                    color: isSelected ? 'var(--primary-500)' : 'var(--text-primary)',
                                                    borderRadius: 'var(--radius-md)',
                                                    padding: '8px 12px',
                                                    transition: 'all 0.15s ease',
                                                    textAlign: 'left',
                                                    width: '100%'
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                    <span style={{ 
                                                        width: '8px', 
                                                        height: '8px', 
                                                        borderRadius: '50%', 
                                                        background: isSelected ? 'var(--primary-500)' : 'transparent',
                                                        border: isSelected ? 'none' : '1px solid var(--text-muted)',
                                                        flexShrink: 0
                                                    }} />
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                                                        <span style={{ fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{obra.nombre}</span>
                                                        <span style={{ fontSize: '11px', color: isSelected ? 'var(--primary-400)' : 'var(--text-muted)', textTransform: 'capitalize' }}>{obra.etapaActual}</span>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
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
