/**
 * Actividades como evidencia de un requisito del FUF.
 *
 * Varios ítems NO se acreditan con un PDF: la capacitación de 8 horas del Art. 16
 * y la de EPP del Art. 13 son actividades ejecutadas con asistentes firmados. El
 * motor de completitud no las veía, así que un ítem cumplido con una actividad
 * real aparecía pendiente.
 *
 * ESPEJO de la regla que ya aplicaba `ObraDetalle`, traída al servidor para que
 * el panel, el repositorio y el export la lean del mismo lugar.
 *
 * La plataforma NO cronometra la clase: la capacitación la puede dictar un OAL
 * externo sin pasar por el sistema. Se declara lo que dice el certificado y se
 * custodia el certificado.
 */

/**
 * Actividades que corresponden a un requisito.
 * El vínculo es por `subtipo`, con el título exacto como respaldo para las
 * actividades anteriores a que el backend persistiera el subtipo.
 */
function actividadesDe(actividades, { tipos = [], subtipo = null, titulo = null }) {
    return (actividades || []).filter((a) => {
        if (tipos.length > 0 && !tipos.includes(a.tipo)) return false;
        if (!subtipo) return true;
        return a.subtipo === subtipo || (titulo && a.titulo === titulo);
    });
}

/**
 * ¿La duración declarada alcanza el mínimo del decreto?
 *
 * `null` cuando el mínimo no está configurado: las actividades anteriores a esta
 * regla no traen duración, y exigirles algo sería culpar a la obra de una carencia
 * del sistema.
 */
function cumpleDuracion(actividad) {
    const cfg = actividad?.duracion;
    if (!cfg?.minimaMin || cfg.minimaMin <= 0) return null;
    const declarada = cfg.declaradaMin ?? null;
    return declarada === null ? false : declarada >= cfg.minimaMin;
}

/**
 * ¿Hay al menos una actividad que ACREDITE el requisito?
 *
 * Ejecutada = cerrada, con asistentes firmados y con las horas que exige el
 * decreto declaradas y alcanzadas. Un acta firmada por todos no acredita el
 * Art. 16 si nadie declaró cuánto duró.
 */
function actividadAcredita(actividad) {
    if (actividad?.estado !== 'completada') return false;
    if ((actividad?.asistentes?.length || 0) === 0) return false;
    const duracion = cumpleDuracion(actividad);
    return duracion === null || duracion === true;
}

/**
 * Estado del requisito según sus actividades.
 * `sinEjecutar` distingue "no se hizo" de "se hizo y le falta algo", que es la
 * diferencia entre Pendiente y Parcial.
 */
function estadoPorActividad(actividades, criterio) {
    const candidatas = actividadesDe(actividades, criterio);
    if (candidatas.length === 0) return { estado: 'faltante', candidatas, acreditan: [] };

    const acreditan = candidatas.filter(actividadAcredita);
    return {
        estado: acreditan.length > 0 ? 'completo' : 'incompleto',
        candidatas,
        acreditan,
    };
}

/** Por qué una actividad no acredita todavía. Se dice, no se deja adivinar. */
function motivoIncompleto(actividad) {
    if (actividad?.estado !== 'completada') return 'la actividad no está cerrada';
    if ((actividad?.asistentes?.length || 0) === 0) return 'no hay asistentes registrados';
    if (cumpleDuracion(actividad) === false) {
        const cfg = actividad.duracion;
        return cfg.declaradaMin === null || cfg.declaradaMin === undefined
            ? `faltan las horas declaradas (mínimo ${cfg.minimaMin} minutos)`
            : `las horas declaradas (${cfg.declaradaMin}) no alcanzan el mínimo de ${cfg.minimaMin}`;
    }
    return 'falta completar la actividad';
}

/**
 * Un requisito que admite DOS vías de acreditación.
 *
 * La capacitación se puede agendar en la plataforma —queda calendarizada,
 * vinculada al requisito, con asistentes que firman— o se puede cargar el
 * certificado de una capacitación dictada fuera del sistema. Las dos acreditan.
 *
 * Exigir la actividad dejaría afuera a quien capacitó con su Organismo
 * Administrador; exigir el documento haría inútil el módulo de actividades. El
 * sistema admite ambas y la responsabilidad de que lo cargado sea correcto es de
 * quien lleva la prevención, que es donde tiene que estar.
 *
 * `via` viaja al requisito para que la interfaz sepa qué mostrar: el enlace a la
 * actividad agendada, o el documento cargado, o las dos acciones si falta todo.
 */
function acreditacionDual({ actividades, documentos, criterio, tipos = [] }) {
    const porActividad = estadoPorActividad(actividades, criterio);
    const docs = (documentos || []).filter(
        (d) => tipos.includes(d.tipo) && (d.s3Key || d.archivoUrl));

    if (porActividad.estado === 'completo') {
        return { via: 'actividad', completo: true, actividades: porActividad.acreditan, documentos: docs };
    }
    if (docs.length > 0) {
        return { via: 'documento', completo: true, actividades: porActividad.candidatas, documentos: docs };
    }
    return {
        via: null,
        completo: false,
        // Una actividad empezada pero incompleta es distinto de no tener nada: la
        // interfaz puede llevar a terminarla en vez de pedir que se suba un PDF.
        parcial: porActividad.estado === 'incompleto',
        actividades: porActividad.candidatas,
        documentos: docs,
    };
}

module.exports = {
    actividadesDe, cumpleDuracion, actividadAcredita, estadoPorActividad,
    motivoIncompleto, acreditacionDual,
};
