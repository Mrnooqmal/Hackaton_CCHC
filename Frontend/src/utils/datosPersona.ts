/**
 * Catálogos de la ficha de una persona: se guardan como código y se muestran
 * con su etiqueta (H-15: la ficha mostraba `media_completa`, `hermano_hermana`).
 */

export const NIVEL_ESCOLAR_OPTIONS = [
    { value: '', label: 'Sin especificar' },
    { value: 'basica_incompleta', label: 'Básica incompleta' },
    { value: 'basica_completa', label: 'Básica completa' },
    { value: 'media_incompleta', label: 'Media incompleta' },
    { value: 'media_completa', label: 'Media completa' },
    { value: 'tecnica', label: 'Técnica / CFT / IP' },
    { value: 'universitaria', label: 'Universitaria' },
    { value: 'postgrado', label: 'Postgrado' },
];

export const RELACION_OPTIONS = [
    { value: '', label: 'Sin especificar' },
    { value: 'conyuge', label: 'Cónyuge / pareja' },
    { value: 'padre_madre', label: 'Padre / madre' },
    { value: 'hijo_hija', label: 'Hijo / hija' },
    { value: 'hermano_hermana', label: 'Hermano / hermana' },
    { value: 'amigo', label: 'Amigo / amiga' },
    { value: 'otro', label: 'Otro' },
];

/** Etiqueta de un código; un valor antiguo en texto libre se muestra tal cual. */
const etiqueta = (opciones: { value: string; label: string }[], v?: string | null) =>
    v ? (opciones.find((o) => o.value === v)?.label ?? v) : '';

export const nivelEscolarLabel = (v?: string | null) => etiqueta(NIVEL_ESCOLAR_OPTIONS, v);
export const relacionLabel = (v?: string | null) => etiqueta(RELACION_OPTIONS, v);

/** Opciones para un select que conserva un valor antiguo que no está en el catálogo. */
export const conValorActual = (opciones: { value: string; label: string }[], v?: string | null) =>
    v && !opciones.some((o) => o.value === v) ? [...opciones, { value: v, label: v }] : opciones;
