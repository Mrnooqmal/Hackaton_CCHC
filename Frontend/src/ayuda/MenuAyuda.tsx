// Menú de ayuda de cada pantalla (en el encabezado): los recorridos de la
// pantalla, la página del manual que le corresponde y las novedades. Reemplaza
// al enlace directo al manual, cuyo mapa de rutas vivía en Header.tsx; ahora
// sale del registro de pantallas.

import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { FiBookOpen, FiHelpCircle, FiPlayCircle, FiStar } from 'react-icons/fi';
import { useRecorridos } from './contexto';
import { ancla } from './registro';
import type { EstadoProgreso } from './tipos';
import './ayuda.css';

const ETIQUETA_ESTADO: Record<EstadoProgreso, string> = {
    completado: 'Visto',
    omitido: 'Omitido',
    en_progreso: 'Pendiente',
};

export default function MenuAyuda() {
    const { deLaPantalla, novedades, manual, estadoDe, lanzar, activo, menuAbierto, abrirMenu, cerrarMenu } = useRecorridos();
    const raiz = useRef<HTMLDivElement>(null);
    const boton = useRef<HTMLButtonElement>(null);
    const idPanel = useId();

    // Cerrar al tocar fuera o con Escape. Mientras hay un recorrido en curso no:
    // un paso puede haber abierto el menú para señalar algo dentro de él.
    useEffect(() => {
        if (!menuAbierto || activo) return;
        const fuera = (e: PointerEvent) => {
            if (raiz.current && !raiz.current.contains(e.target as Node)) cerrarMenu();
        };
        const tecla = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { cerrarMenu(); boton.current?.focus(); }
        };
        document.addEventListener('pointerdown', fuera);
        document.addEventListener('keydown', tecla);
        return () => {
            document.removeEventListener('pointerdown', fuera);
            document.removeEventListener('keydown', tecla);
        };
    }, [menuAbierto, activo, cerrarMenu]);

    return (
        <div className="menu-ayuda" ref={raiz}>
            <button
                ref={boton}
                type="button"
                className="header-action header-action--help"
                {...ancla('global.boton-ayuda')}
                aria-expanded={menuAbierto}
                aria-controls={idPanel}
                aria-label="Ayuda de esta pantalla"
                title="Ayuda de esta pantalla"
                onClick={() => (menuAbierto ? cerrarMenu() : abrirMenu())}
            >
                <FiHelpCircle />
            </button>

            {menuAbierto && (
                <div id={idPanel} className="menu-ayuda__panel" role="region" aria-label="Ayuda">
                    <div className="menu-ayuda__grupo" {...ancla('menu-ayuda.recorridos')}>
                        <h2 className="menu-ayuda__titulo">Recorridos de esta pantalla</h2>
                        {deLaPantalla.length === 0 ? (
                            <p className="menu-ayuda__vacio">No hay recorridos para esta pantalla.</p>
                        ) : (
                            <ul className="menu-ayuda__lista">
                                {deLaPantalla.map((d) => {
                                    const estado = estadoDe(d.id);
                                    return (
                                        <li key={d.id}>
                                            <button type="button" className="menu-ayuda__item" onClick={() => lanzar(d.id)}>
                                                <FiPlayCircle aria-hidden="true" />
                                                <span>{d.titulo.es}</span>
                                                {estado && <span className="menu-ayuda__estado">{ETIQUETA_ESTADO[estado]}</span>}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    <div className="menu-ayuda__grupo" {...ancla('menu-ayuda.manual')}>
                        <h2 className="menu-ayuda__titulo">Manual de uso</h2>
                        <Link className="menu-ayuda__item" to={manual} onClick={cerrarMenu}>
                            <FiBookOpen aria-hidden="true" />
                            <span>Abrir el manual de esta pantalla</span>
                        </Link>
                    </div>

                    <div className="menu-ayuda__grupo" {...ancla('menu-ayuda.novedades')}>
                        <h2 className="menu-ayuda__titulo">Novedades</h2>
                        {novedades.length === 0 ? (
                            <p className="menu-ayuda__vacio">No hay novedades.</p>
                        ) : (
                            <ul className="menu-ayuda__lista">
                                {novedades.map((d) => (
                                    <li key={d.id}>
                                        <button type="button" className="menu-ayuda__item" onClick={() => lanzar(d.id)}>
                                            <FiStar aria-hidden="true" />
                                            <span>{d.titulo.es}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
