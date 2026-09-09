/**
 * Distribución documental — a quién se informó un documento y cuándo.
 *
 * ESPEJO de Frontend/src/utils/distribucion.ts.
 *
 * EXTIENDE el mecanismo que ya existe (`Document.difusiones[]`, escrito por
 * EventBus al publicar una versión) en vez de crear uno paralelo. Esa constancia
 * automática responde a los ítems 4 y 11: al publicar, se informa a la línea de
 * mando y a los representantes. Lo que le faltaba para el Art. 57 inc. 2 es poder
 * registrar un envío DECLARADO por el usuario, con destinatario tipificado,
 * medio, evidencia y una regla de anticipación.
 *
 * Por eso una entrada de `difusiones[]` ahora puede ser de dos orígenes:
 *   - `automatica`: la generó el sistema al publicar. Trae `destinatarios` y
 *     `totales` por grupo de rol.
 *   - `manual`: la declaró alguien. Trae `destinatarioTipo`, `medio` y evidencia.
 * Ninguna reemplaza a la otra y ambas cuentan como haber informado.
 *
 * ES GENÉRICO A PROPÓSITO: los ítems 4, 11, 25, 37 y 51 exigen el mismo hecho
 * (documento + destinatarios + fecha) con distintos destinatarios y plazos. El
 * ítem 50 es el primer consumidor; los demás se enganchan pasando otra lista de
 * destinatarios exigidos.
 *
 * NO valida que el envío haya ocurrido ni que la evidencia lo demuestre. Registra
 * lo que se declara, con su fecha y su respaldo.
 */

const DESTINATARIO = {
    PERSONAS_TRABAJADORAS: 'PersonaTrabajadora',
    COMITE_PARITARIO: 'ComiteParitario',
    DELEGADO_SST: 'DelegadoSST',
    ORGANIZACION_SINDICAL: 'OrganizacionSindical',
    LINEA_MANDO: 'LineaMando',
    DEPARTAMENTO_PREVENCION: 'DepartamentoPrevencion',
};

const DESTINATARIO_LABEL = {
    PersonaTrabajadora: 'Personas trabajadoras',
    ComiteParitario: 'Comité Paritario',
    DelegadoSST: 'Delegado de SST',
    OrganizacionSindical: 'Organizaciones sindicales',
    LineaMando: 'Línea de mando',
    DepartamentoPrevencion: 'Departamento de Prevención',
};

const MEDIO = {
    CORREO: 'Correo',
    ENTREGA: 'Entrega',
    PLATAFORMA: 'Plataforma',
    OTRO: 'Otro',
};

/** Art. 57 inc. 2: días CORRIDOS de anticipación a la entrada en vigencia. */
const DIAS_ANTICIPACION_REGLAMENTO = 30;

/**
 * Destinatarios que exige el Art. 57 inc. 2 para el Reglamento Interno.
 * El comité y el delegado son alternativos: basta el que exista en el ámbito.
 */
const DESTINATARIOS_REGLAMENTO = [
    DESTINATARIO.PERSONAS_TRABAJADORAS,
    DESTINATARIO.COMITE_PARITARIO,
    DESTINATARIO.ORGANIZACION_SINDICAL,
];

const ESTADO_DESTINATARIO = {
    ENVIADO: 'Enviado',
    FUERA_DE_PLAZO: 'FueraDePlazo',
    PENDIENTE: 'Pendiente',
    NO_APLICA: 'NoAplica',
};

const esManual = (d) => d?.origen === 'manual';

/** Días corridos entre el envío y la entrada en vigencia. Negativo si se envió después. */
function diasAnticipacion(fechaEnvio, fechaVigencia) {
    if (!fechaEnvio || !fechaVigencia) return null;
    const a = new Date(fechaEnvio);
    const b = new Date(fechaVigencia);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Estado de UN destinatario frente a un documento.
 *
 * `NoAplica` es siempre DERIVADO: o el ámbito no tiene ese órgano, o la entidad
 * declaró que no hay organizaciones sindicales. Nunca queda `Pendiente` algo que
 * no se puede cumplir, porque eso es un incumplimiento imposible de cerrar.
 *
 * @param {object} p
 * @param {string} p.tipo            Destinatario evaluado.
 * @param {Array}  p.difusiones      `Document.difusiones[]`.
 * @param {boolean} p.existeEnAmbito Si el destinatario existe (comité, delegado, sindicato).
 * @param {string} [p.razonNoAplica]
 * @param {string} [p.fechaVigencia] Si se entrega, se exige la anticipación.
 * @param {number} [p.diasExigidos]
 */
function estadoDestinatario({
    tipo, difusiones = [], existeEnAmbito = true, razonNoAplica = null,
    fechaVigencia = null, diasExigidos = null,
}) {
    if (!existeEnAmbito) {
        return {
            tipo, estado: ESTADO_DESTINATARIO.NO_APLICA, envio: null, dias: null,
            detalle: razonNoAplica || `No existe ${DESTINATARIO_LABEL[tipo] || tipo} en este ámbito.`,
        };
    }

    // El envío más reciente a ese destinatario. La constancia automática cuenta
    // para la línea de mando y los representantes, que es a quienes informa.
    const candidatos = (difusiones || []).filter((d) => {
        if (esManual(d)) return d.destinatarioTipo === tipo;
        if (tipo === DESTINATARIO.LINEA_MANDO) return (d.totales?.mando || 0) > 0;
        if (tipo === DESTINATARIO.COMITE_PARITARIO || tipo === DESTINATARIO.DELEGADO_SST
            || tipo === DESTINATARIO.DEPARTAMENTO_PREVENCION) {
            return (d.totales?.representantes || 0) > 0;
        }
        return false;
    });
    if (candidatos.length === 0) {
        return {
            tipo, estado: ESTADO_DESTINATARIO.PENDIENTE, envio: null, dias: null,
            detalle: 'Sin constancia de envío.',
        };
    }

    const envio = [...candidatos].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
    if (!fechaVigencia || !diasExigidos) {
        return {
            tipo, estado: ESTADO_DESTINATARIO.ENVIADO, envio, dias: null,
            detalle: `Informado el ${String(envio.fecha).slice(0, 10)}.`,
        };
    }

    const dias = diasAnticipacion(envio.fecha, fechaVigencia);
    if (dias === null) {
        return { tipo, estado: ESTADO_DESTINATARIO.ENVIADO, envio, dias: null, detalle: 'Fecha de envío no comparable.' };
    }
    // Enviado con menos anticipación de la exigida NO es cumplimiento: el
    // Art. 57 pide que el envío sea previo, no que exista.
    return dias >= diasExigidos
        ? { tipo, estado: ESTADO_DESTINATARIO.ENVIADO, envio, dias, detalle: `Enviado con ${dias} días de anticipación.` }
        : {
            tipo, estado: ESTADO_DESTINATARIO.FUERA_DE_PLAZO, envio, dias,
            detalle: dias >= 0
                ? `Enviado con ${dias} días de anticipación; se exigen ${diasExigidos}.`
                : `Enviado ${Math.abs(dias)} días DESPUÉS de entrar en vigencia.`,
        };
}

/**
 * Estado agregado de la distribución de un documento.
 *
 * `exigidos` sale del denominador cuando un destinatario no aplica, igual que en
 * el motor de completitud: no se castiga por no informar a quien no existe.
 */
function evaluarDistribucion({
    difusiones = [], destinatariosExigidos = [], existencia = {}, razones = {},
    fechaVigencia = null, diasExigidos = null,
}) {
    const detalle = destinatariosExigidos.map((tipo) => estadoDestinatario({
        tipo, difusiones,
        existeEnAmbito: existencia[tipo] !== false,
        razonNoAplica: razones[tipo] || null,
        fechaVigencia, diasExigidos,
    }));

    const exigibles = detalle.filter((d) => d.estado !== ESTADO_DESTINATARIO.NO_APLICA);
    const enviados = exigibles.filter((d) => d.estado === ESTADO_DESTINATARIO.ENVIADO).length;
    const fueraDePlazo = exigibles.filter((d) => d.estado === ESTADO_DESTINATARIO.FUERA_DE_PLAZO).length;

    return {
        detalle,
        exigibles: exigibles.length,
        excluidos: detalle.length - exigibles.length,
        enviados,
        fueraDePlazo,
        completa: exigibles.length > 0 && enviados === exigibles.length,
        // Se distingue de `completa`: informar tarde a todos no es lo mismo que no
        // informar, y el FUF lo marca parcial, no incumplido.
        parcial: exigibles.length > 0 && enviados < exigibles.length && (enviados + fueraDePlazo) > 0,
    };
}

module.exports = {
    DESTINATARIO, DESTINATARIO_LABEL, MEDIO, ESTADO_DESTINATARIO,
    DIAS_ANTICIPACION_REGLAMENTO, DESTINATARIOS_REGLAMENTO,
    diasAnticipacion, estadoDestinatario, evaluarDistribucion,
};
