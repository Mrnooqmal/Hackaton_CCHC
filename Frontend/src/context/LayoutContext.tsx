import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface LayoutContextType {
    /** Overlay del sidebar en móvil/tablet */
    isMobileMenuOpen: boolean;
    toggleMobileMenu: () => void;
    closeMobileMenu: () => void;
    /** Colapsar el sidebar en escritorio (botón hamburguesa estilo consola) */
    isSidebarCollapsed: boolean;
    toggleSidebarCollapsed: () => void;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export function LayoutProvider({ children }: { children: ReactNode }) {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem('sidebarCollapsed') === 'true';
    });

    const toggleMobileMenu = () => {
        setIsMobileMenuOpen((prev) => !prev);
    };

    const closeMobileMenu = () => {
        setIsMobileMenuOpen(false);
    };

    const toggleSidebarCollapsed = () => {
        setIsSidebarCollapsed((prev) => {
            const next = !prev;
            if (typeof window !== 'undefined') {
                window.localStorage.setItem('sidebarCollapsed', String(next));
            }
            return next;
        });
    };

    return (
        <LayoutContext.Provider
            value={{
                isMobileMenuOpen,
                toggleMobileMenu,
                closeMobileMenu,
                isSidebarCollapsed,
                toggleSidebarCollapsed,
            }}
        >
            {children}
        </LayoutContext.Provider>
    );
}

export function useLayout() {
    const context = useContext(LayoutContext);
    if (context === undefined) {
        throw new Error('useLayout must be used within a LayoutProvider');
    }
    return context;
}
