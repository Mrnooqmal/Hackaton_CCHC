// Constancia de difusión de un documento (DS 44).
//
// El decreto no se conforma con que el documento exista: exige informarlo a
// quienes corresponde. El Art. 7 inc. 9 lo pide para la MIPER, el Art. 8 inc. 3
// para el Programa de Trabajo Preventivo y el Art. 57 inc. 2 para el Reglamento
// Interno, este último además con 30 días de anticipación a su entrada en
// vigencia.
//
// La plataforma no redacta ninguno de esos documentos. Lo que sí puede afirmar
// sin abrir el archivo es a quién se le informó y cuándo, y eso es exactamente
// lo que el fiscalizador pide ver.

import type { Document, DocumentDifusion } from '../api/documents.api';

/** Días de anticipación que el Art. 57 inc. 2 exige para el Reglamento Interno. */
export const DIAS_ANTICIPACION_REGLAMENTO = 30;

/** La difusión más reciente del documento, o null si nunca se difundió. */
export function ultimaDifusion(doc?: Pick<Document, 'difusiones'> | null): DocumentDifusion | null {
    const lista = doc?.difusiones;
    if (!Array.isArray(lista) || lista.length === 0) return null;
    return [...lista].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
}

/**
 * ¿Se informó a los representantes de las personas trabajadoras?
 *
 * Se mira `representantes` y no el total: avisar solo a la línea de mando es
 * justamente el incumplimiento que el FUF marca como parcial en los ítems 4 y 11.
 */
export function difundidoARepresentantes(doc?: Pick<Document, 'difusiones'> | null): boolean {
    return (ultimaDifusion(doc)?.totales?.representantes || 0) > 0;
}

/** Total de personas informadas en la última difusión. */
export function totalInformados(dif?: DocumentDifusion | null): number {
    if (!dif) return 0;
    const t = dif.totales;
    return (t?.mando || 0) + (t?.representantes || 0) + (t?.firmantes || 0);
}

export type EstadoPlazoReglamento =
    | 'sin_vigencia'   // nadie declaró desde cuándo rige: no hay plazo que medir
    | 'sin_difundir'   // rige (o regirá) pero nunca se informó
    | 'fuera_de_plazo' // se informó con menos de 30 días de anticipación
    | 'en_plazo';      // se informó con la anticipación que exige el Art. 57

/**
 * Art. 57 inc. 2: el Reglamento Interno debe enviarse a las personas
 * trabajadoras, al comité o delegado y a las organizaciones sindicales **30 días
 * antes** de empezar a regir.
 *
 * Se compara contra la fecha de difusión real y no contra la de subida: subir el
 * archivo no es informarlo, y era justamente esa confusión la que dejaba el ítem
 * 50 en verde sin serlo.
 */
export function estadoPlazoReglamento(
    doc?: Pick<Document, 'difusiones'> | null,
    fechaEntradaVigencia?: string | null,
): { estado: EstadoPlazoReglamento; diasAnticipacion: number | null } {
    if (!fechaEntradaVigencia) return { estado: 'sin_vigencia', diasAnticipacion: null };
    const vigencia = new Date(fechaEntradaVigencia);
    if (Number.isNaN(vigencia.getTime())) return { estado: 'sin_vigencia', diasAnticipacion: null };

    const dif = ultimaDifusion(doc);
    if (!dif) return { estado: 'sin_difundir', diasAnticipacion: null };

    const informado = new Date(dif.fecha);
    if (Number.isNaN(informado.getTime())) return { estado: 'sin_difundir', diasAnticipacion: null };

    const dias = Math.floor((vigencia.getTime() - informado.getTime()) / 86_400_000);
    return {
        estado: dias >= DIAS_ANTICIPACION_REGLAMENTO ? 'en_plazo' : 'fuera_de_plazo',
        diasAnticipacion: dias,
    };
}
