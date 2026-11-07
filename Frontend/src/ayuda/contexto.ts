import { createContext, useContext } from 'react';
import type { PantallaKey } from './registro';
import type { DefinicionRecorrido, EstadoProgreso } from './tipos';

export interface ValorRecorridos {
    /** Pantalla actual según el registro, o null (ruta sin pantalla registrada). */
    readonly pantalla: PantallaKey | null;
    /** Recorridos de esta pantalla que la persona puede abrir desde la ayuda. */
    readonly deLaPantalla: readonly DefinicionRecorrido[];
    /** Anuncios vigentes que la persona puede ver. */
    readonly novedades: readonly DefinicionRecorrido[];
    /** Página del manual de esta pantalla, como ruta de la app. */
    readonly manual: string;
    /** Estado de la persona en un recorrido, si lo hay en su versión actual o anterior. */
    readonly estadoDe: (id: string) => EstadoProgreso | null;
    /** Abre un recorrido. Desde la ayuda siempre se puede, aunque esté completado. */
    readonly lanzar: (id: string) => void;
    /** Id del recorrido en curso, o null. */
    readonly activo: string | null;
    readonly menuAbierto: boolean;
    readonly abrirMenu: () => void;
    readonly cerrarMenu: () => void;
}

const VACIO: ValorRecorridos = {
    pantalla: null, deLaPantalla: [], novedades: [], manual: '/manual', estadoDe: () => null,
    lanzar: () => {}, activo: null, menuAbierto: false, abrirMenu: () => {}, cerrarMenu: () => {},
};

export const ContextoRecorridos = createContext<ValorRecorridos>(VACIO);

export const useRecorridos = () => useContext(ContextoRecorridos);
