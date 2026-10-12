// Proveedor del filtro del manual según el rol. La lógica está en `filtro.ts`.

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { ContextoFiltroManual, type Permisos } from './filtro';

const CLAVE = 'manual.verTodo';
const leerVerTodo = () => { try { return localStorage.getItem(CLAVE) === '1'; } catch { return false; } };

export default function FiltroManualProvider({ children }: { children: ReactNode }) {
    const { user, hasPermission } = useAuth();
    const [verTodo, setVerTodoEstado] = useState(leerVerTodo);
    const conSesion = Boolean(user);

    const setVerTodo = useCallback((v: boolean) => {
        setVerTodoEstado(v);
        try { localStorage.setItem(CLAVE, v ? '1' : '0'); } catch { /* sin almacenamiento: solo esta visita */ }
    }, []);

    const puede = useCallback((p: Permisos) => {
        if (!conSesion || verTodo || !p || p.length === 0) return true;
        return p.some((x) => hasPermission(x));
    }, [conSesion, verTodo, hasPermission]);

    const valor = useMemo(() => ({ conSesion, verTodo, setVerTodo, puede }), [conSesion, verTodo, setVerTodo, puede]);
    return <ContextoFiltroManual.Provider value={valor}>{children}</ContextoFiltroManual.Provider>;
}

