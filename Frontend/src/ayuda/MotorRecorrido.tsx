// Motor de un recorrido: resuelve cada paso, resalta el elemento y muestra el
// globo. No sabe nada de la API ni de la cola: avisa por `alEvento` qué hizo la
// persona y quien lo monta decide si eso se guarda. La vista previa lo monta
// sin guardar nada (falla 13).
//
// Cómo se resuelve un paso:
//   1. Si pide abrir la ayuda, la abre (`abrirAyuda`).
//   2. Espera su ancla con MutationObserver hasta `espera` ms (falla 2).
//   3. Si no aparece, se salta y queda en la consola (falla 6). Si no aparece
//      ninguna, el recorrido termina sin registrar nada.
//   4. La trae a la vista, despejando la cabecera fija (falla 1), y la resalta.
//
// Completar solo se registra con el botón final (falla 4). La X, Escape o salir
// de la pantalla a mitad de camino cuentan como cerrar (falla 3). Los textos se
// muestran como texto plano (falla 8).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as KeyboardEventReact } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { FiX } from 'react-icons/fi';
import type { DefinicionRecorrido, EventoRecorrido, Posicion } from './tipos';
import { ATRIBUTOS_QUE_MUEVEN_ANCLAS, ESPERA_ANCLA_MS, ESPERA_SIGUIENTE_MS, buscarAncla, esperarAncla, traerALaVista } from './dom';
import { ANCHO_ANGOSTO, HALO, anchoGlobo, colocar, recolocar } from './posicion';
import type { Colocacion, Rect } from './posicion';
import { TEXTOS } from './textos';
import type { TextosMotor } from './textos';
import './ayuda.css';

export type { EventoRecorrido };

export interface PropsMotor {
    definicion: DefinicionRecorrido;
    /** Lo que hizo la persona. No se llama si ningún paso se pudo mostrar. */
    alEvento: (evento: EventoRecorrido) => void;
    /** Se llama al terminar desde el globo, haya evento o no. */
    alTerminar: () => void;
    abrirAyuda?: () => void;
    /** Se llama si no se pudo mostrar ningún paso (los elementos no están en esta pantalla ahora). */
    alNoMostrar?: () => void;
    textos?: TextosMotor;
    /** Espera máxima por cada ancla, en ms. */
    espera?: number;
    /** Alto de la cabecera fija: el elemento no queda debajo de ella. */
    alturaCabecera?: number;
}

/**
 * Paso en pantalla: cuál, su elemento (null si va centrado), si es el último que
 * se pudo mostrar y el `plan`: los pasos que de verdad se ven (los ya mostrados
 * y los que siguen y hoy se pueden mostrar). De él sale "Paso N de M": un paso
 * que se salta no cuenta.
 */
interface Visible { indice: number; elemento: HTMLElement | null; mostrados: readonly number[]; finalForzado: boolean; plan: readonly number[] }

/** Lo que queda por delante del paso a la vista, recalculado si la página cambia después de mostrarlo. */
interface PorDelante { indice: number; finalForzado: boolean; plan: readonly number[] }

/** Un paso que solo hace falta si otro elemento no se ve, y ese elemento se ve. */
const sobraPaso = (pasos: DefinicionRecorrido['pasos'], i: number) => {
    const otro = pasos[i].soloSiNoSeVe;
    return Boolean(otro && buscarAncla(otro, document));
};

/** Los pasos después de `i` que hoy se pueden mostrar. Uno que abre la ayuda cuenta: su ancla aparece al abrirla. */
const siguientesVisibles = (pasos: DefinicionRecorrido['pasos'], i: number) => pasos.flatMap((p, j) => (j > i && !sobraPaso(pasos, j)
    && (!p.ancla || p.accion === 'abrir_ayuda' || Boolean(buscarAncla(p.ancla, document))) ? [j] : []));

const planDesde = (pasos: DefinicionRecorrido['pasos'], i: number, mostrados: readonly number[]) =>
    [...new Set([...mostrados, i, ...siguientesVisibles(pasos, i)])].sort((a, b) => a - b);

const mismoPlan = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, k) => x === b[k]);

const avisar = (mensaje: string, datos: Record<string, unknown>) => console.warn(`[recorridos] ${mensaje}`, datos);

const rectDe = (el: HTMLElement): Rect => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
};

const vista = () => ({ width: window.innerWidth, height: window.innerHeight });

const mismaColocacion = (a: Colocacion | null, b: Colocacion | null) => JSON.stringify(a) === JSON.stringify(b);

/** Cuánto tiene que cambiar el elemento para que cuente como un cambio de tamaño de verdad (y no redondeo de subpíxeles). */
const TOLERANCIA_TAMANO = 4;

/** El lado del globo elegido en un paso, y con qué medidas se eligió. */
interface Eleccion { paso: Visible; ancho: number | null; alto: number | null; vista: { width: number; height: number }; colocacion: Colocacion }

const parecidos = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) <= TOLERANCIA_TAMANO);

/**
 * Dónde va el globo. Dentro de un paso el lado no cambia mientras el elemento y
 * la pantalla conserven su tamaño: solo sigue al elemento. Antes se elegía de
 * nuevo en cada medición, y con un elemento más alto que la pantalla el globo
 * saltaba de abajo a arriba y de vuelta (al anclarse cambia su ancho, con eso su
 * alto, y con eso la medición siguiente).
 */
function elegirColocacion(eleccion: { current: Eleccion | null }, paso: Visible, objetivo: Rect | null, altoGlobo: number, preferida: Posicion | undefined): Colocacion {
    const v = vista();
    const tamGlobo = { width: anchoGlobo(v), height: altoGlobo };
    const ancho = objetivo ? objetivo.width : null;
    const alto = objetivo ? objetivo.height : null;
    const e = eleccion.current;
    if (e !== null && e.paso === paso && parecidos(e.ancho, ancho) && parecidos(e.alto, alto) && e.vista.width === v.width && e.vista.height === v.height) {
        return recolocar(e.colocacion, objetivo, tamGlobo, v);
    }
    const c = colocar(objetivo, tamGlobo, v, preferida);
    eleccion.current = { paso, ancho, alto, vista: v, colocacion: c };
    return c;
}

export default function MotorRecorrido({
    definicion, alEvento, alTerminar, abrirAyuda, alNoMostrar, textos = TEXTOS, espera = ESPERA_ANCLA_MS, alturaCabecera = 0,
}: PropsMotor) {
    const pasos = definicion.pasos;
    const [visible, setVisible] = useState<Visible | null>(null);
    /** Lo de adelante del paso a la vista, si cambió después de mostrarlo (ver más abajo). */
    const [porDelante, setPorDelante] = useState<PorDelante | null>(null);
    const [destino, setDestino] = useState<{ desde: number; direccion: 1 | -1; n: number }>({ desde: 0, direccion: 1, n: 0 });
    /** Buscando el paso siguiente: los botones no hacen nada (un segundo toque no reinicia la búsqueda). */
    const [resolviendo, setResolviendo] = useState(false);
    const [objetivo, setObjetivo] = useState<Rect | null>(null);
    const [colocacion, setColocacion] = useState<Colocacion | null>(null);
    /** Alto del globo: cambia con el contenido de cada paso, con la clase de anclado o al cargar las fuentes. */
    const [altoGlobo, setAltoGlobo] = useState(0);
    const globoRef = useRef<HTMLDivElement>(null);
    const eleccion = useRef<Eleccion | null>(null);
    const terminado = useRef(false);
    // Lo último conocido, para los manejadores que no se rehacen en cada render.
    // Ninguno entra en las dependencias de la resolución de pasos: quien monta el
    // motor suele pasarlos como funciones nuevas en cada render, y eso reiniciaba
    // la espera de un ancla cada vez que el proveedor se volvía a dibujar.
    const actual = useRef({ visible: null as Visible | null, alEvento, alTerminar, abrirAyuda, alNoMostrar });
    useEffect(() => { actual.current = { visible, alEvento, alTerminar, abrirAyuda, alNoMostrar }; });

    const terminar = useCallback((evento?: EventoRecorrido) => {
        if (terminado.current) return;
        terminado.current = true;
        if (evento) actual.current.alEvento(evento);
        actual.current.alTerminar();
    }, []);

    // Resolver el paso de destino, saltando hacia `direccion` los que no aparecen.
    useEffect(() => {
        const control = new AbortController();
        const { desde, direccion } = destino;
        void (async () => {
            const previo = actual.current.visible;
            const mostrados = previo?.mostrados ?? [];
            // La pantalla puede estar cargando solo al principio.
            const esperaPaso = previo ? Math.min(espera, ESPERA_SIGUIENTE_MS) : espera;
            for (let i = desde; i >= 0 && i < pasos.length; i += direccion) {
                const paso = pasos[i];
                if (sobraPaso(pasos, i)) continue;
                if (paso.accion === 'abrir_ayuda') actual.current.abrirAyuda?.();
                const el = paso.ancla ? await esperarAncla(paso.ancla, document, { espera: esperaPaso, senal: control.signal }) : null;
                if (control.signal.aborted) return;
                if (!paso.ancla || el) {
                    const conEste = [...new Set([...mostrados, i])].sort((a, b) => a - b);
                    setPorDelante(null);
                    setVisible({ indice: i, elemento: el, mostrados: conEste, finalForzado: siguientesVisibles(pasos, i).length === 0, plan: planDesde(pasos, i, conEste) });
                    setResolviendo(false);
                    return;
                }
                avisar('ancla no encontrada: se salta el paso', { recorrido: definicion.id, version: definicion.version, paso: i + 1, ancla: paso.ancla });
            }
            // Se acabaron los pasos en esa dirección.
            if (mostrados.length === 0) {
                avisar('ningún paso se pudo mostrar: no se registra progreso', { recorrido: definicion.id, version: definicion.version, pantalla: definicion.pantalla });
                actual.current.alNoMostrar?.();
                terminar();
                return;
            }
            // Hacia adelante: el último que se vio pasa a ser el final, para que
            // completar siga saliendo del botón. Hacia atrás: se queda en el primero.
            setPorDelante(null);
            if (previo) setVisible(direccion === 1 ? { ...previo, finalForzado: true, plan: previo.mostrados } : previo);
            setResolviendo(false);
        })();
        return () => control.abort();
    }, [destino, pasos, espera, definicion, terminar]);

    // El primer paso puede aparecer antes de que la pantalla termine de cargar
    // (el botón Subir documento está antes que las carpetas). Lo que se vio por
    // delante en ese momento no es definitivo: mientras el paso está a la vista,
    // cada cambio de la página vuelve a calcular el contador y si el botón dice
    // Siguiente o Finalizar. Va en un estado aparte para no volver a desplazar
    // la página ni mover el foco.
    useEffect(() => {
        if (!visible || resolviendo) return;
        const { indice, mostrados } = visible;
        let cuadro = 0;
        const recalcular = () => {
            cuadro = 0;
            const plan = planDesde(pasos, indice, mostrados);
            const finalForzado = siguientesVisibles(pasos, indice).length === 0;
            setPorDelante((previo) => (previo && previo.indice === indice && previo.finalForzado === finalForzado && mismoPlan(previo.plan, plan)
                ? previo : { indice, finalForzado, plan }));
        };
        const observador = new MutationObserver(() => { if (!cuadro) cuadro = requestAnimationFrame(recalcular); });
        observador.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ATRIBUTOS_QUE_MUEVEN_ANCLAS });
        return () => { observador.disconnect(); if (cuadro) cancelAnimationFrame(cuadro); };
    }, [visible, resolviendo, pasos]);

    // Salir de la pantalla a mitad de camino cuenta como cerrar. Si nunca se
    // mostró un paso (o el modo estricto de React monta y desmonta antes de
    // empezar), no hay nada que registrar.
    useEffect(() => () => {
        const v = actual.current.visible;
        if (!terminado.current && v) {
            terminado.current = true;
            actual.current.alEvento({ tipo: 'cerrar', ultimoPaso: v.indice });
        }
    }, []);

    // El foco vuelve a donde estaba al terminar.
    useEffect(() => {
        const previo = document.activeElement as HTMLElement | null;
        return () => { previo?.focus?.(); };
    }, []);

    // Escape cierra, esté donde esté el foco.
    useEffect(() => {
        if (!visible) return;
        const tecla = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            terminar({ tipo: 'cerrar', ultimoPaso: visible.indice });
        };
        document.addEventListener('keydown', tecla, true);
        return () => document.removeEventListener('keydown', tecla, true);
    }, [visible, terminar]);

    // Traer a la vista y medir en el cuadro siguiente, ya desplazado. En
    // pantallas angostas el globo va abajo, así que el elemento se sube; en las
    // anchas, se centra.
    useLayoutEffect(() => {
        if (!visible) return;
        const el = visible.elemento;
        if (el) traerALaVista(el, { margenSuperior: alturaCabecera + 2 * HALO, bloque: window.innerWidth < ANCHO_ANGOSTO ? 'start' : 'center' });
        const cuadro = requestAnimationFrame(() => setObjetivo(el ? rectDe(el) : null));
        return () => cancelAnimationFrame(cuadro);
    }, [visible, alturaCabecera]);

    // Seguir al elemento si la página se desplaza o cambia de tamaño.
    useEffect(() => {
        const el = visible?.elemento;
        if (!el) return;
        let cuadro = 0;
        const medir = () => {
            cancelAnimationFrame(cuadro);
            cuadro = requestAnimationFrame(() => setObjetivo(rectDe(el)));
        };
        window.addEventListener('scroll', medir, true);
        window.addEventListener('resize', medir);
        // Y si el propio elemento cambia de tamaño (se despliega un grupo de requisitos).
        const observador = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir);
        observador?.observe(el);
        return () => {
            observador?.disconnect();
            cancelAnimationFrame(cuadro);
            window.removeEventListener('scroll', medir, true);
            window.removeEventListener('resize', medir);
        };
    }, [visible]);

    // Medir el globo cada vez que cambia de alto.
    const hayVisible = visible !== null;
    useEffect(() => {
        const globo = globoRef.current;
        if (!hayVisible || !globo || typeof ResizeObserver === 'undefined') return;
        const observador = new ResizeObserver(() => setAltoGlobo(globo.offsetHeight));
        observador.observe(globo);
        return () => observador.disconnect();
    }, [hayVisible]);

    // Colocar el globo con su alto real.
    useLayoutEffect(() => {
        const globo = globoRef.current;
        if (!visible || !globo) return;
        const c = elegirColocacion(eleccion, visible, objetivo, globo.offsetHeight, pasos[visible.indice]?.posicion);
        setColocacion((previa) => (mismaColocacion(previa, c) ? previa : c));
    }, [visible, objetivo, pasos, altoGlobo]);

    // El foco entra al globo en cada paso.
    const colocado = colocacion !== null;
    useEffect(() => {
        if (visible && colocado) globoRef.current?.querySelector<HTMLElement>('[data-principal]')?.focus();
    }, [visible, colocado]);

    if (!visible) return null;

    const { indice, mostrados } = visible;
    const vigente = porDelante?.indice === indice ? porDelante : visible;
    const { plan } = vigente;
    const paso = pasos[indice];
    const esFinal = indice === pasos.length - 1 || vigente.finalForzado;
    // "Paso N de M" sobre los pasos que de verdad se ven, no sobre los definidos.
    const total = plan.length;
    const posicion = plan.indexOf(indice) + 1;
    const esAnuncio = definicion.tipo === 'anuncio';
    const previo = [...mostrados].reverse().find((i) => i < indice);
    const idTitulo = `recorrido-${definicion.id}-titulo`;
    const idTexto = `recorrido-${definicion.id}-texto`;

    const siguiente = () => {
        if (resolviendo) return;
        if (esFinal) { terminar({ tipo: 'completar', ultimoPaso: indice }); return; }
        setResolviendo(true);
        setDestino((d) => ({ desde: indice + 1, direccion: 1, n: d.n + 1 }));
    };
    const anterior = () => {
        if (resolviendo || previo === undefined) return;
        setResolviendo(true);
        setDestino((d) => ({ desde: previo, direccion: -1, n: d.n + 1 }));
    };

    const teclado = (e: KeyboardEventReact<HTMLDivElement>) => {
        const enEnlace = Boolean((e.target as HTMLElement).closest('a'));
        if (e.key === 'ArrowRight' && !enEnlace) { e.preventDefault(); siguiente(); return; }
        if (e.key === 'ArrowLeft' && !enEnlace && previo !== undefined) { e.preventDefault(); anterior(); return; }
        if (e.key !== 'Tab' || !globoRef.current) return;
        // El foco no sale del globo mientras dura el recorrido.
        const focables = Array.from(globoRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
        if (focables.length === 0) return;
        const primero = focables[0];
        const ultimo = focables[focables.length - 1];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    };

    const estiloGlobo = colocacion
        ? { top: colocacion.top, left: colocacion.left, width: colocacion.width, ...(colocacion.modo === 'anclado' && colocacion.altoMax ? { maxHeight: colocacion.altoMax } : {}) }
        : { top: 0, left: 0, width: anchoGlobo(vista()), visibility: 'hidden' as const };
    const etiquetaColocacion = !colocacion ? undefined
        : colocacion.modo === 'flotante' ? colocacion.lado
            : colocacion.modo === 'anclado' ? `anclado-${colocacion.borde}` : 'centrado';

    return createPortal(
        <div className="recorrido" data-recorrido={definicion.id}>
            <div className={`recorrido-capa${objetivo ? '' : ' recorrido-capa--opaca'}`} aria-hidden="true" />
            {objetivo && (
                <div
                    className="recorrido-resalte"
                    aria-hidden="true"
                    style={{ top: objetivo.top - HALO, left: objetivo.left - HALO, width: objetivo.width + 2 * HALO, height: objetivo.height + 2 * HALO }}
                />
            )}
            <div
                ref={globoRef}
                className={`recorrido-globo${colocacion?.modo === 'anclado' ? ' recorrido-globo--anclado' : ''}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={idTitulo}
                aria-describedby={idTexto}
                data-colocacion={etiquetaColocacion}
                style={estiloGlobo}
                onKeyDown={teclado}
            >
                <div className="recorrido-globo__cabecera">
                    <h2 id={idTitulo} className="recorrido-globo__titulo">{paso.titulo.es}</h2>
                    <button
                        type="button"
                        className="recorrido-globo__cerrar"
                        onClick={() => terminar({ tipo: 'cerrar', ultimoPaso: indice })}
                        aria-label={textos.cerrar}
                        title={textos.cerrar}
                    >
                        <FiX aria-hidden="true" />
                    </button>
                </div>
                <p id={idTexto} className="recorrido-globo__texto">{paso.descripcion.es}</p>
                {paso.manual && (
                    <Link className="recorrido-globo__manual" to={`/manual/${paso.manual}`} target="_blank" rel="noopener noreferrer">
                        {textos.leerMas}
                    </Link>
                )}
                <div className="recorrido-globo__pie">
                    {total > 1 && <span className="recorrido-globo__progreso" aria-live="polite">{textos.paso(posicion, total)}</span>}
                    <div className="recorrido-globo__acciones">
                        {!esAnuncio && !esFinal && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => terminar({ tipo: 'omitir', ultimoPaso: indice })}>
                                {textos.omitir}
                            </button>
                        )}
                        {previo !== undefined && (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={anterior}>{textos.anterior}</button>
                        )}
                        <button type="button" className="btn btn-primary btn-sm" data-principal onClick={siguiente} aria-busy={resolviendo} disabled={resolviendo}>
                            {esFinal ? (esAnuncio ? textos.entendido : textos.finalizar) : textos.siguiente}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
