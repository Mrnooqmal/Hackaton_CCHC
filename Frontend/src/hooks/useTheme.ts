import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/**
 * Maneja el tema claro/oscuro: estado, persistencia en localStorage y
 * aplicación de la clase `theme-light` en <html>. El modo claro es el
 * predeterminado (estética institucional CChC).
 */
export function useTheme() {
    const [theme, setTheme] = useState<Theme>(() => {
        if (typeof window !== 'undefined') {
            return window.localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
        }
        return 'light';
    });

    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.documentElement.classList.toggle('theme-light', theme === 'light');
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

    return { theme, toggleTheme };
}
