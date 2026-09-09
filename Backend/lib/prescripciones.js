/**
 * Prescripciones de medidas — DS 44 Art. 70 (ítem 58 del FUF).
 *
 * ESPEJO de Frontend/src/utils/prescripciones.ts.
 *
 * La norma obliga a IMPLEMENTAR las medidas que ordenen los fiscalizadores, el
 * Organismo Administrador, el Departamento de Prevención o el comité paritario.
 * Por eso es el único de estos ítems que necesita seguimiento de estado: recibir
 * la prescripción no cierra nada.
 *
 * NO SE PARSEA NI SE VERIFICA NADA: el sistema registra lo que el usuario declara,
 * con el documento que la origina y la evidencia de haberla implementado. Que esa
 * evidencia demuestre la implementación es responsabilidad de quien la sube.
 *
 * RELACIÓN CON LOS ACUERDOS DEL COMITÉ: el encargo anterior decidió no modelar los
 * acuerdos como entidad porque son contenido del acta, y esa decisión se mantiene.
 * La única conexión es OPT IN: desde una reunión se puede crear una prescripción de
 * origen ComiteParitario si se le quiere hacer seguimiento formal. No se generan
 * solas, no se lee el acta, y un acta sin prescripciones sigue siendo válida.
 */

const ORIGEN_PRESCRIPCION = {
    ORGANISMO_FISCALIZADOR: 'OrganismoFiscalizador',
    ORGANISMO_ADMINISTRADOR: 'OrganismoAdministrador',
    DEPARTAMENTO_PREVENCION: 'DepartamentoPrevencion',
    COMITE_PARITARIO: 'ComiteParitario',
};

const ORIGEN_LABEL = {
    OrganismoFiscalizador: 'Organismo fiscalizador',
    OrganismoAdministrador: 'Organismo Administrador (Ley 16.744)',
    DepartamentoPrevencion: 'Departamento de Prevención de Riesgos',
    ComiteParitario: 'Comité Paritario',
};

const ESTADO_PRESCRIPCION = {
    PENDIENTE: 'Pendiente',
    IMPLEMENTADA: 'Implementada',
    VENCIDA: 'Vencida',
};

/**
 * Estado DERIVADO de una prescripción.
 *
 * `Vencida` nunca se marca a mano (anti contradicción 3): sale de comparar el
 * plazo con la fecha. Si se pudiera marcar, el estado dejaría de ser un hecho
 * verificable y pasaría a ser una opinión.
 */
function estadoPrescripcion(p, ahora = new Date()) {
    if (!p) return null;
    if (p.fechaImplementacion && p.evidenciaImplementacionDocumentoId) {
        return ESTADO_PRESCRIPCION.IMPLEMENTADA;
    }
    if (p.plazoImplementacion) {
        const plazo = new Date(p.plazoImplementacion);
        if (!Number.isNaN(plazo.getTime()) && plazo.getTime() < ahora.getTime()) {
            return ESTADO_PRESCRIPCION.VENCIDA;
        }
    }
    return ESTADO_PRESCRIPCION.PENDIENTE;
}

/**
 * Validaciones de dominio al crear o actualizar. Van acá y no en el formulario:
 * la misma regla debe sostenerse si se llama la API directo.
 */
function validarPrescripcion(p, ahora = new Date()) {
    const errores = [];

    if (!Object.values(ORIGEN_PRESCRIPCION).includes(p?.origen)) {
        errores.push(`Origen inválido. Válidos: ${Object.values(ORIGEN_PRESCRIPCION).join(', ')}`);
    }
    if (!p?.descripcion || !String(p.descripcion).trim()) {
        errores.push('La descripción de la medida es obligatoria.');
    }

    // Anti contradicción 5: ninguna fecha puede ser futura.
    const noFutura = (valor, nombre) => {
        if (!valor) return;
        const f = new Date(valor);
        if (Number.isNaN(f.getTime())) errores.push(`${nombre} no es una fecha válida.`);
        else if (f.getTime() > ahora.getTime()) errores.push(`${nombre} no puede ser futura.`);
    };
    if (!p?.fechaPrescripcion) errores.push('La fecha de la prescripción es obligatoria.');
    noFutura(p?.fechaPrescripcion, 'La fecha de la prescripción');
    noFutura(p?.fechaImplementacion, 'La fecha de implementación');

    // Anti contradicción 2: Implementada exige evidencia Y fecha, las dos.
    const pretendeImplementada = p?.fechaImplementacion || p?.evidenciaImplementacionDocumentoId;
    if (pretendeImplementada) {
        if (!p.evidenciaImplementacionDocumentoId) {
            errores.push('No se puede dar por implementada sin evidencia adjunta.');
        }
        if (!p.fechaImplementacion) {
            errores.push('No se puede dar por implementada sin fecha de implementación.');
        }
        if (p.fechaImplementacion && p.fechaPrescripcion
            && new Date(p.fechaImplementacion) < new Date(p.fechaPrescripcion)) {
            errores.push('La implementación no puede ser anterior a la prescripción.');
        }
    }

    return errores;
}

/** Resumen para el panel: cuántas hay en cada estado. */
function resumirPrescripciones(lista, ahora = new Date()) {
    const conEstado = (lista || []).map((p) => ({ ...p, estado: estadoPrescripcion(p, ahora) }));
    return {
        total: conEstado.length,
        pendientes: conEstado.filter((p) => p.estado === ESTADO_PRESCRIPCION.PENDIENTE).length,
        implementadas: conEstado.filter((p) => p.estado === ESTADO_PRESCRIPCION.IMPLEMENTADA).length,
        vencidas: conEstado.filter((p) => p.estado === ESTADO_PRESCRIPCION.VENCIDA).length,
        prescripciones: conEstado,
    };
}

module.exports = {
    ORIGEN_PRESCRIPCION, ORIGEN_LABEL, ESTADO_PRESCRIPCION,
    estadoPrescripcion, validarPrescripcion, resumirPrescripciones,
};
