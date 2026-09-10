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

/** Total de personas informadas en la última difusión. Solo las automáticas
 *  cuentan personas: una constancia declarada registra un destinatario, no una
 *  nómina, y sumar cero ahí diría que no se informó a nadie. */
export function totalInformados(dif?: DocumentDifusion | null): number {
    if (!dif) return 0;
    const t = dif.totales;
    return (t?.mando || 0) + (t?.representantes || 0) + (t?.firmantes || 0);
}

export const DESTINATARIO_LABEL: Record<string, string> = {
    PersonaTrabajadora: 'Personas trabajadoras',
    ComiteParitario: 'Comité Paritario',
    DelegadoSST: 'Delegado de SST',
    OrganizacionSindical: 'Organizaciones sindicales',
    LineaMando: 'Línea de mando',
    DepartamentoPrevencion: 'Departamento de Prevención',
};

export const MEDIO_LABEL: Record<string, string> = {
    Correo: 'Correo electrónico',
    Entrega: 'Entrega en mano',
    Plataforma: 'Plataforma',
    Otro: 'Otro medio',
};

/**
 * Cómo se describe una constancia, sea automática o declarada.
 *
 * Las dos formas conviven en `difusiones[]` y no se describen igual: la
 * automática informó a una nómina, la manual a un destinatario tipificado por un
 * medio. Contarle personas a una constancia manual daría "informado a 0", que es
 * lo contrario de lo que dice.
 */
export function descripcionDifusion(dif?: DocumentDifusion | null): { texto: string; titulo: string } | null {
    if (!dif) return null;
    const fecha = String(dif.fecha).slice(0, 10);
    if (dif.origen === 'manual') {
        const quien = DESTINATARIO_LABEL[dif.destinatarioTipo || ''] || dif.destinatarioTipo || 'destinatario';
        const medio = MEDIO_LABEL[dif.medio || ''] || dif.medio || null;
        return {
            texto: `Informado a ${quien} el ${fecha}`,
            titulo: `Constancia declarada${medio ? ` · ${medio}` : ''}${dif.observacion ? ` · ${dif.observacion}` : ''}`,
        };
    }
    const t = dif.totales;
    return {
        texto: `Informado a ${totalInformados(dif)} el ${fecha}`,
        titulo: `Informado el ${fecha} · ${t?.mando || 0} de la línea de mando, ${t?.representantes || 0} representantes, ${t?.firmantes || 0} firmantes`,
    };
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
