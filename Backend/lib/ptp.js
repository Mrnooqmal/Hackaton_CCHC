/**
 * Programa de Trabajo Preventivo (PTP) — DS 44 Art. 8.
 *
 * ESPEJO de Frontend/src/utils/ptp.ts — mantener ambos sincronizados.
 *
 * El PTP lo redacta la empresa y se sube al repositorio de la obra como
 * cualquier otro documento normativo: la plataforma lo guarda, lo asigna y lo
 * hace firmar, pero no lo genera ni conoce su contenido. Lo único que el sistema
 * sí puede afirmar sobre él son dos hechos verificables:
 *
 *   1. Si llegó dentro del plazo de 30 días desde la MIPER (Art. 8 inc. 1).
 *   2. Si lo firmó el representante legal designado (Art. 8 inc. 1).
 *
 * ⚠️ Este módulo NO tiene consumidor en el backend: el estado se deriva en el
 * cliente, que ya tiene los documentos cargados. Vive acá porque es la única
 * implementación con tests automatizados —el frontend no tiene runner— y porque
 * las alertas programadas de vencimiento, cuando se construyan, correrán en
 * Lambda y necesitarán exactamente esta lógica. Si se descarta esa idea, este
 * archivo y su test deberían borrarse junto con ella.
 */

/** Plazo del Art. 8 inc. 1: días corridos desde que se confecciona/actualiza la MIPER. */
const PLAZO_PTP_DIAS = 30;

/** Días corridos entre una fecha y ahora. Negativo si la fecha es futura. */
function diasCorridosDesde(iso, ahora = new Date()) {
    if (!iso) return null;
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) return null;
    return Math.floor((ahora.getTime() - fecha.getTime()) / 86400000);
}

/** Fecha en que un documento quedó en su estado actual (última publicación). */
const fechaDocumento = (doc) => doc?.publicadaEn || doc?.updatedAt || doc?.createdAt || null;

/** ¿El documento existe y tiene archivo cargado? Sin archivo no hay documento. */
const tieneArchivo = (doc) => Boolean(doc && (doc.s3Key || doc.archivoUrl));

/**
 * Estado del PTP frente al plazo del Art. 8. Se DERIVA de las fechas de los dos
 * documentos, sin campos declarados: nadie tiene que decir "este PTP viene de la
 * MIPER v2", porque el sistema no puede leer el PDF para verificarlo y un campo
 * así se desincroniza en cuanto alguien publica una MIPER desde otra pantalla.
 *
 * La regla es simple y comprobable: si la MIPER se revisó después de la última
 * versión del PTP, el PTP quedó atrás y el plazo corre desde esa revisión.
 *
 * @param {object|null} ptpDoc     Documento PROGRAMA_TRABAJO_PREVENTIVO de la obra.
 * @param {object|null} miperDoc   Documento MIPER de la obra.
 * @returns {{ estado, dias, diasRestantes, vencido, detalle }}
 *   estado: 'sin_miper' | 'faltante' | 'desactualizado' | 'vigente'
 */
function estadoPtp(ptpDoc, miperDoc, ahora = new Date()) {
    const sinMiper = {
        estado: 'sin_miper', dias: null, diasRestantes: null, vencido: false,
        detalle: 'El plazo empieza a correr cuando se carga la MIPER.',
    };
    if (!tieneArchivo(miperDoc)) return sinMiper;

    const fechaMiper = fechaDocumento(miperDoc);
    if (!fechaMiper) return sinMiper;

    const conPlazo = (detalle) => {
        const dias = diasCorridosDesde(fechaMiper, ahora);
        return {
            dias,
            diasRestantes: dias === null ? null : PLAZO_PTP_DIAS - dias,
            vencido: dias !== null && dias > PLAZO_PTP_DIAS,
            detalle,
        };
    };

    if (!tieneArchivo(ptpDoc)) {
        return { estado: 'faltante', ...conPlazo('Hay MIPER pero todavía no se ha cargado el programa de trabajo.') };
    }

    const fechaPtp = fechaDocumento(ptpDoc);
    if (fechaPtp && new Date(fechaPtp) < new Date(fechaMiper)) {
        return {
            estado: 'desactualizado',
            ...conPlazo('La MIPER se revisó después de la última versión del programa de trabajo.'),
        };
    }

    return {
        estado: 'vigente', dias: null, diasRestantes: null, vencido: false,
        detalle: 'El programa de trabajo es posterior a la última revisión de la MIPER.',
    };
}

/**
 * ¿Está aprobado por el representante legal (Art. 8 inc. 1)? Es la firma real
 * sobre el documento, no una declaración: se busca al representante legal
 * designado entre los firmantes del PTP.
 */
function aprobadoPorRepresentanteLegal(ptpDoc, representanteLegal) {
    if (!representanteLegal?.personaId) return false;
    return (ptpDoc?.firmas || []).some((f) => f.personaId === representanteLegal.personaId);
}

module.exports = {
    PLAZO_PTP_DIAS,
    diasCorridosDesde,
    estadoPtp,
    aprobadoPorRepresentanteLegal,
};
