// Proveedor de recorridos guiados (D-33): une el motor con la sesión, la
// pantalla actual, el progreso guardado y la cola sin conexión.
//
//   - Lee el progreso una vez por sesión (`GET /ayuda/progreso`). Las
//     definiciones van en el bundle, así que no hay otra lectura (falla 15).
//   - Lanza solo, como máximo, un recorrido por sesión (decisión 2): el primero
//     de la cola de la pantalla (anuncios, después obligatorios). Nunca con un
//     modal o un flujo crítico abierto (`bloqueo.ts`), nunca sin haber podido
//     leer el progreso (no se le muestra a alguien algo que quizás ya completó)
//     y nunca a una persona con el tratamiento bloqueado.
//   - El progreso va a la cola local y se envía de inmediato; si no hay red,
//     al volver (evento `online`) o en la próxima sesión.
//   - Vista previa: `?recorrido=<id>&previa=1` en la pantalla real abre la
//     definición tal como está (también en borrador) y no guarda nada.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { enviarProgreso, leerProgreso } from '../api/ayuda.api';
import { RECORRIDOS } from './recorridos';
import { colaAutomatica, deLaPantalla, hoyEnChile, manualDePantalla, novedades, pantallaDeRuta } from './reglas';
import type { ContextoPersona } from './reglas';
import { fusionar } from './fusion';
import type { EntradaProgreso } from './fusion';
import { encolar, identidad, pendientesDe, vaciar } from './cola';
import { useHayBloqueo } from './useBloqueoAyuda';
import { bloqueado } from './bloqueo';
import MotorRecorrido from './MotorRecorrido';
import type { EventoRecorrido } from './MotorRecorrido';
import { ContextoRecorridos } from './contexto';
import type { DefinicionRecorrido } from './tipos';

/** Marca de la sesión que ya tuvo su recorrido automático. Solo el id de sesión. */
const CLAVE_AUTOMATICO = 'recorridoAutomatico';
/** Pausa antes de lanzar solo: deja asentar la pantalla y abrir un modal que venga en camino. */
const PAUSA_AUTOMATICO_MS = 800;

const sesionActual = () => {
    try { return localStorage.getItem('session_id'); } catch { return null; }
};
const automaticoUsado = () => {
    try { return sessionStorage.getItem(CLAVE_AUTOMATICO) === sesionActual(); } catch { return true; }
};
const marcarAutomatico = () => {
    try { sessionStorage.setItem(CLAVE_AUTOMATICO, sesionActual() || ''); } catch { /* sin almacenamiento: a lo más se repite */ }
};

/** La entrada que deja un evento, a partir del progreso conocido de esa versión. */
function entradaDe(def: DefinicionRecorrido, previo: EntradaProgreso | undefined, ev: EventoRecorrido): EntradaProgreso {
    const base = previo && previo.version === def.version ? previo : null;
    const cierres = base?.cierres ?? 0;
    const ultimoPaso = Math.max(base?.ultimoPaso ?? 0, ev.ultimoPaso);
    if (ev.tipo === 'cerrar') return { version: def.version, estado: 'en_progreso', ultimoPaso, cierres: cierres + 1 };
    return { version: def.version, estado: ev.tipo === 'omitir' ? 'omitido' : 'completado', ultimoPaso, cierres };
}

interface Activo { def: DefinicionRecorrido; persistir: boolean; ruta: string }

/**
 * Vista previa pedida en la URL con que se abrió la app. Se lee una sola vez:
 * al entrar sin ámbito elegido la app pasa por /seleccionar-obra y vuelve sin
 * la consulta, así que se recuerda la ruta y se lanza al volver a ella.
 */
function previaDeLaUrl(): { id: string; ruta: string } | null {
    if (typeof window === 'undefined') return null;
    const q = new URLSearchParams(window.location.search);
    const id = q.get('recorrido');
    return q.get('previa') === '1' && id ? { id, ruta: window.location.pathname } : null;
}

export default function RecorridosProvider({ children }: { children: ReactNode }) {
    const { user, hasPermission } = useAuth();
    // Hasta que haya ámbito (obra o empresa) la app redirige a /seleccionar-obra:
    // nada se lanza antes, o se cortaría con la redirección.
    const { scope, scopeElegido } = useObraContext();
    const location = useLocation();
    const hayBloqueo = useHayBloqueo();

    const tenantId = user?.tenantId;
    const personaId = (user as { personaId?: string } | null)?.personaId;
    const quien = tenantId && personaId ? identidad(tenantId, personaId) : null;

    const [progreso, setProgreso] = useState<ReadonlyMap<string, EntradaProgreso>>(new Map());
    const [cargado, setCargado] = useState(false);
    const [registrar, setRegistrar] = useState(true);
    const [activo, setActivo] = useState<Activo | null>(null);
    const [menuAbierto, setMenuAbierto] = useState(false);
    const [previa, setPrevia] = useState(previaDeLaUrl);
    const enviando = useRef(false);
    const progresoRef = useRef(progreso);
    useEffect(() => { progresoRef.current = progreso; }, [progreso]);

    const pantalla = pantallaDeRuta(location.pathname);
    const persona: ContextoPersona = useMemo(() => ({
        tienePermiso: hasPermission,
        ambito: scope === 'obra' || scope === 'empresa' ? scope : null,
    }), [hasPermission, scope]);
    const hoy = hoyEnChile();

    const vaciarCola = useCallback(async () => {
        if (!quien || enviando.current) return;
        enviando.current = true;
        try { await vaciar(localStorage, quien, enviarProgreso); } finally { enviando.current = false; }
    }, [quien]);

    // Una lectura por sesión. Lo que quedó en la cola local se fusiona encima:
    // es más nuevo que lo que tiene el servidor.
    useEffect(() => {
        setCargado(false);
        setProgreso(new Map());
        setActivo(null);
        if (!quien) return;
        let vigente = true;
        void leerProgreso().then((r) => {
            if (!vigente || !r) return;
            const mapa = new Map<string, EntradaProgreso>();
            for (const p of r.progreso) mapa.set(p.recorridoId, { version: p.version, estado: p.estado, ultimoPaso: p.ultimoPaso, cierres: p.cierres });
            for (const [id, e] of Object.entries(pendientesDe(localStorage, quien))) mapa.set(id, fusionar(mapa.get(id) || null, e).progreso);
            setProgreso(mapa);
            setRegistrar(r.registrar);
            setCargado(true);
            void vaciarCola();
        });
        return () => { vigente = false; };
    }, [quien, vaciarCola]);

    useEffect(() => {
        const alVolver = () => { void vaciarCola(); };
        window.addEventListener('online', alVolver);
        return () => window.removeEventListener('online', alVolver);
    }, [vaciarCola]);

    const registrarEvento = useCallback((def: DefinicionRecorrido, ev: EventoRecorrido) => {
        if (!quien) return;
        const entrada = entradaDe(def, progresoRef.current.get(def.id), ev);
        setProgreso((mapa) => new Map(mapa).set(def.id, fusionar(mapa.get(def.id) || null, entrada).progreso));
        // Con el tratamiento bloqueado no se encola: el servidor lo rechazaría.
        if (!registrar) return;
        encolar(localStorage, quien, def.id, entrada);
        void vaciarCola();
    }, [quien, registrar, vaciarCola]);

    // Lanzamiento automático: uno por sesión, sin bloqueos ni otro en curso, y
    // nunca mientras hay una vista previa pendiente.
    useEffect(() => {
        if (!quien || !scopeElegido || !cargado || !registrar || activo || previa || hayBloqueo || automaticoUsado()) return;
        const primero = colaAutomatica(RECORRIDOS, pantalla, progreso, persona, hoy)[0];
        if (!primero) return;
        const ruta = location.pathname;
        const t = window.setTimeout(() => {
            if (bloqueado() || automaticoUsado()) return;
            marcarAutomatico();
            setActivo({ def: primero, persistir: true, ruta });
        }, PAUSA_AUTOMATICO_MS);
        return () => window.clearTimeout(t);
    }, [quien, scopeElegido, cargado, registrar, activo, previa, hayBloqueo, pantalla, progreso, persona, hoy, location.pathname]);

    // Vista previa (`?recorrido=<id>&previa=1`): en la pantalla real, tal como
    // está la definición, sin escribir progreso. Ocupa el recorrido automático
    // de la sesión, para no mezclarse con uno de verdad.
    useEffect(() => {
        if (!previa || !quien || !scopeElegido || activo || location.pathname !== previa.ruta) return;
        const def = RECORRIDOS.find((d) => d.id === previa.id);
        const t = window.setTimeout(() => {
            setPrevia(null);
            if (!def) { console.warn('[recorridos] vista previa: no existe el recorrido', { recorrido: previa.id }); return; }
            marcarAutomatico();
            setActivo({ def, persistir: false, ruta: previa.ruta });
        }, 0);
        return () => window.clearTimeout(t);
    }, [previa, quien, scopeElegido, activo, location.pathname]);

    // Cambiar de pantalla termina el recorrido en curso (el motor registra el cierre al desmontarse).
    useEffect(() => {
        if (activo && activo.ruta !== location.pathname) setActivo(null);
    }, [activo, location.pathname]);

    const lanzar = useCallback((id: string) => {
        const def = RECORRIDOS.find((d) => d.id === id);
        if (!def) return;
        setMenuAbierto(false);
        setActivo({ def, persistir: true, ruta: location.pathname });
    }, [location.pathname]);

    const alTerminar = useCallback(() => {
        setActivo(null);
        setMenuAbierto(false);
    }, []);

    const valor = useMemo(() => ({
        pantalla,
        deLaPantalla: user ? deLaPantalla(RECORRIDOS, pantalla, persona, hoy) : [],
        novedades: user ? novedades(RECORRIDOS, persona, hoy) : [],
        manual: manualDePantalla(pantalla),
        estadoDe: (id: string) => progreso.get(id)?.estado ?? null,
        lanzar,
        activo: activo?.def.id ?? null,
        menuAbierto,
        abrirMenu: () => setMenuAbierto(true),
        cerrarMenu: () => setMenuAbierto(false),
    }), [pantalla, user, persona, hoy, progreso, lanzar, activo, menuAbierto]);

    const alturaCabecera = typeof document !== 'undefined'
        ? document.querySelector('.header')?.getBoundingClientRect().height ?? 0
        : 0;

    return (
        <ContextoRecorridos.Provider value={valor}>
            {children}
            {activo && (
                <MotorRecorrido
                    key={`${activo.def.id}@${activo.ruta}`}
                    definicion={activo.def}
                    alEvento={(ev) => { if (activo.persistir) registrarEvento(activo.def, ev); }}
                    alTerminar={alTerminar}
                    abrirAyuda={() => setMenuAbierto(true)}
                    alturaCabecera={alturaCabecera}
                />
            )}
        </ContextoRecorridos.Provider>
    );
}
