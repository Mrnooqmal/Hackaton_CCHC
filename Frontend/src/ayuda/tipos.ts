// Modelo de los recorridos guiados (D-33).
//
// Los recorridos son código: se definen en `recorridos.ts`, se revisan en un PR
// y se publican con el despliegue del frontend. No hay panel de administración
// ni rol de plataforma. `scripts/verificar-recorridos.mjs` los valida antes de
// `tsc -b` en `npm run build`, así que un recorrido roto no se publica.
//
// Los estados y los límites del progreso tienen un gemelo en el backend
// (`Backend/lib/ayuda/progreso.js`); `Backend/tests/ayuda-gemelos.test.js`
// falla si divergen.
//
// Este archivo solo usa sintaxis que se puede borrar (sin enums ni namespaces):
// el chequeo del build lo ejecuta Node directamente, sin compilarlo.

import type { AnclaKey, PantallaKey } from './registro.ts';
import type { PermissionKey } from '../permissions.ts';

/** obligatorio: se lanza solo la primera vez. opcional: desde la ayuda. anuncio: aviso de novedad, sin resaltar nada. */
export const TIPOS_RECORRIDO = ['obligatorio', 'opcional', 'anuncio'] as const;
export type TipoRecorrido = typeof TIPOS_RECORRIDO[number];

/** Estado del progreso de una persona. Solo avanza en este orden. */
export const ESTADOS_PROGRESO = ['en_progreso', 'omitido', 'completado'] as const;
export type EstadoProgreso = typeof ESTADOS_PROGRESO[number];

/** borrador: no se muestra (solo en la vista previa). inactivo: se retira sin borrarlo. */
export const ESTADOS_RECORRIDO = ['borrador', 'publicado', 'inactivo'] as const;
export type EstadoRecorrido = typeof ESTADOS_RECORRIDO[number];

/** Dónde va el globo respecto del elemento. `auto` lo decide el motor según el espacio. */
export const POSICIONES = ['auto', 'arriba', 'abajo', 'izquierda', 'derecha'] as const;
export type Posicion = typeof POSICIONES[number];

/** Acciones que un paso puede pedir antes de resaltar. Lista cerrada (falla 9). */
export const ACCIONES_PASO = ['abrir_ayuda'] as const;
export type AccionPaso = typeof ACCIONES_PASO[number];

/** Dónde aplica: dentro de una obra, en la vista de empresa, o en ambas. */
export const AMBITOS = ['obra', 'empresa', 'cualquiera'] as const;
export type Ambito = typeof AMBITOS[number];

/** Límites compartidos con el backend. */
export const LIMITES = {
    LARGO_ID: 64,
    VERSION_MAX: 10000,
    PASOS_MAX: 20,
    CIERRES_PARA_OMITIR: 3,
    CIERRES_MAX: 99,
    RECORRIDOS_POR_PERSONA: 200,
    LARGO_TITULO: 80,
    LARGO_DESCRIPCION: 300,
} as const;

/** Slug del recorrido: minúsculas, dígitos y guiones. Mismo patrón que el backend. */
export const ID_RECORRIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Texto de un recorrido. Solo español por ahora; el objeto deja lugar para otros
 * idiomas sin cambiar el modelo. Se muestra como texto plano: nunca se
 * interpreta como HTML (fallas 7 y 8).
 */
export interface Texto {
    readonly es: string;
}

/**
 * Página del manual a la que lleva "Leer más": su ruta dentro de
 * `src/manual/content`, sin `.md` (por ejemplo `modulos/firmas`). El build
 * comprueba que exista.
 */
export type ManualSlug = string;

/**
 * Quién ve el recorrido, por permiso y no por nombre de rol: los roles son de
 * cada empresa. `todos`: los tiene todos. `alguno`: al menos uno. `ninguno`: no
 * tiene ninguno (sirve para los recorridos de terreno; el administrador tiene
 * todos los permisos, así que queda fuera de esos).
 */
export interface VisibleSi {
    readonly todos?: readonly PermissionKey[];
    readonly alguno?: readonly PermissionKey[];
    readonly ninguno?: readonly PermissionKey[];
}

export interface Paso {
    /** Elemento a resaltar. Sin ancla, el paso se muestra centrado, sin resaltar nada. */
    readonly ancla?: AnclaKey;
    readonly titulo: Texto;
    readonly descripcion: Texto;
    readonly posicion?: Posicion;
    readonly accion?: AccionPaso;
    readonly manual?: ManualSlug;
}

export interface DefinicionRecorrido {
    readonly id: string;
    readonly tipo: TipoRecorrido;
    readonly pantalla: PantallaKey;
    readonly visibleSi: VisibleSi;
    readonly ambito: Ambito;
    /** Sube al cambiar el contenido. Una prueba del build lo exige. */
    readonly version: number;
    /** Si la versión nueva se vuelve a mostrar a quien ya vio la anterior. */
    readonly reiniciarAlPublicar: boolean;
    /** Fechas `AAAA-MM-DD` en hora de Chile (America/Santiago), inclusivas. */
    readonly vigenciaDesde?: string;
    readonly vigenciaHasta?: string;
    readonly estado: EstadoRecorrido;
    readonly titulo: Texto;
    readonly manual?: ManualSlug;
    readonly pasos: readonly Paso[];
}

/** Lo que hizo la persona al terminar un recorrido (lo emite el motor). */
export type EventoRecorrido = { tipo: 'cerrar' | 'omitir' | 'completar'; ultimoPaso: number };

/** Progreso de una persona en un recorrido, como lo devuelve `GET /ayuda/progreso`. */
export interface ProgresoRecorrido {
    readonly recorridoId: string;
    readonly version: number;
    readonly estado: EstadoProgreso;
    readonly ultimoPaso: number;
    readonly cierres: number;
    readonly actualizadoEn: string;
}
