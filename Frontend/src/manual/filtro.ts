// Manual según el rol: muestra solo lo que la persona puede hacer.
//
// Se filtra por PERMISO, no por nombre de rol: cada empresa ajusta los permisos
// de sus roles y crea roles propios, así que el rol no dice qué puede hacer
// alguien en su empresa. Los permisos vienen resueltos en la sesión.
//
// Es solo presentación: se OCULTA de la navegación, del buscador y de la página,
// pero nada se bloquea. Si alguien llega por un enlace a una página oculta, la
// ve con un aviso. El interruptor "Todo el manual" la muestra completa (lo usa
// quien capacita a otros), y sin sesión se ve todo.
//
// Dos niveles:
//  - Página: `permiso` en `manualNav.ts`.
//  - Sección: un bloque en el markdown, con CUATRO dos puntos para no chocar con
//    los avisos `:::` que pueda tener adentro:
//
//        :::: solo personas.crear
//        ## Agregar una persona
//        ...
//        ::::
//
//    Varios permisos separados por espacio: basta con tener uno.

import { createContext, useContext } from 'react';

/** Permisos que habilitan algo: basta con tener uno. Vacío o ausente = todos. */
export type Permisos = readonly string[] | undefined;

const ABRE = /^::::\s*solo\s+(.+?)\s*$/;
const CIERRA = /^::::\s*$/;

/** Línea de apertura de una sección restringida, o null. */
export function permisosDeLinea(linea: string): string[] | null {
    const m = ABRE.exec(linea.trim());
    return m ? m[1].split(/\s+/).filter(Boolean) : null;
}
export const cierraSeccion = (linea: string) => CIERRA.test(linea.trim());

/**
 * Quita del markdown las secciones restringidas que la persona no puede ver, y
 * las marcas de las que sí. Lo que queda es markdown normal.
 */
export function filtrarMarkdown(md: string, puede: (p: Permisos) => boolean): string {
    const salida: string[] = [];
    let oculta = false;
    for (const linea of md.split('\n')) {
        const permisos = permisosDeLinea(linea);
        if (permisos) { oculta = !puede(permisos); continue; }
        if (cierraSeccion(linea)) { oculta = false; continue; }
        if (!oculta) salida.push(linea);
    }
    return salida.join('\n');
}

export interface FiltroManual {
    /** Hay sesión: tiene sentido filtrar y mostrar el interruptor. */
    conSesion: boolean;
    verTodo: boolean;
    setVerTodo: (v: boolean) => void;
    /** ¿Se muestra algo que exige estos permisos? */
    puede: (p: Permisos) => boolean;
}

export const ContextoFiltroManual = createContext<FiltroManual>({ conSesion: false, verTodo: true, setVerTodo: () => {}, puede: () => true });

export const useFiltroManual = () => useContext(ContextoFiltroManual);
