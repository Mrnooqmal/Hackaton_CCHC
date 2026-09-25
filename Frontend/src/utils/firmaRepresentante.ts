/**
 * Documentos que firma el representante legal.
 *
 * ESPEJO de Backend/lib/services/FirmaRepresentanteService.js — mantener
 * sincronizados. El DS 44 exige una sola: la aprobación del Programa de Trabajo
 * Preventivo (Art. 8 inc. 1, ítem 9 del FUF). El backend asigna la firma sola al
 * designar al representante y al cargar el programa; acá se usa para que la
 * pantalla nunca diga "no requiere firma" de un documento que sí la requiere.
 */
export const TIPOS_FIRMA_REPRESENTANTE: ReadonlySet<string> = new Set(['PROGRAMA_TRABAJO_PREVENTIVO']);

/** Marca que el backend pone en la asignación hecha al representante. */
export const ROL_REPRESENTANTE = 'representante_legal';

export const requiereFirmaRepresentante = (tipo?: string | null) => Boolean(tipo && TIPOS_FIRMA_REPRESENTANTE.has(tipo));
