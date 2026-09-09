/**
 * Requisitos del FUF que cubre el módulo de estructura preventiva.
 *
 * ESPEJO de Frontend/src/utils/completitudEstructura.ts.
 *
 * Éste es el "único lugar donde se vincula requisito del FUF con evidencia" que
 * pide la sección 10.4 del encargo: el panel y el export leen exactamente estas
 * definiciones, así que no pueden discrepar. Otros módulos aportarán las suyas
 * con la misma forma; el motor (lib/completitud.js) no conoce el dominio de nadie.
 *
 * Cada definición dice CÓMO se acredita el ítem, no qué debería contener el
 * documento: el contenido es responsabilidad de quien lo sube.
 */

const C = require('./completitud');
const EP = require('./estructura-preventiva');

const { ESTADO_REQUISITO: E, BLOQUE_FUF: B } = C;

/** Órgano vigente del tipo pedido, si existe. */
const vigente = (ctx, tipo) => (ctx.organos || []).find(
    (o) => o.tipo === tipo && EP.estadoOrgano(o, ctx.ahora) === EP.ESTADO_ORGANO.VIGENTE
);

/** Órgano del tipo pedido en cualquier estado (para distinguir vencido de ausente). */
const cualquiera = (ctx, tipo) => (ctx.organos || []).find((o) => o.tipo === tipo);

/** Estado del órgano como requisito: vigente cumple, vencido no es lo mismo que ausente. */
function estadoOrganoRequisito(ctx, tipo, { obligatorio }) {
    if (!obligatorio) {
        const v = vigente(ctx, tipo);
        // Constituido sin estar obligado: cuenta como cumplido, y el export lo
        // rotula voluntario. Su ausencia previa nunca fue incumplimiento.
        if (v) return { estado: E.CUMPLIDO, detalle: 'Constituido de forma voluntaria.' };
        return { estado: E.NO_APLICA, detalle: 'No exigible con la dotación de este ámbito.' };
    }
    const v = vigente(ctx, tipo);
    if (v) return { estado: E.CUMPLIDO, detalle: `Vigente desde ${String(v.fechaConstitucion || v.fechaEleccionODesignacion).slice(0, 10)}.` };
    const previo = cualquiera(ctx, tipo);
    if (previo) return { estado: E.VENCIDO, detalle: 'El mandato venció o el órgano fue disuelto y no se ha renovado.' };
    return { estado: E.PENDIENTE, detalle: 'Obligatorio según la dotación y aún no constituido.' };
}

/** Documento adjunto del órgano por su clave. */
const docOrgano = (ctx, tipo, clave) => {
    const o = vigente(ctx, tipo) || cualquiera(ctx, tipo);
    const documentoId = o?.documentos?.[clave];
    if (!documentoId) return null;
    return (ctx.documentos || []).find((d) => d.documentId === documentoId) || { documentId, s3Key: 'vinculado' };
};

/** Cuando el órgano no existe, sus requisitos derivados no aplican todavía. */
const sinOrgano = (ctx, tipo, obligatorio) => {
    if (vigente(ctx, tipo)) return null;
    return obligatorio
        ? { estado: E.PENDIENTE, detalle: 'Depende de un órgano que aún no se constituye.' }
        : { estado: E.NO_APLICA, detalle: 'No exigible con la dotación de este ámbito.' };
};

/**
 * Definiciones. `ctx` trae: obligaciones, organos, reuniones, documentos,
 * dotacion y ahora.
 */
const DEFINICIONES_ESTRUCTURA = [
    {
        id: 'FUF-30', item: 30, bloque: B.ORGANIZACION, ambito: 'ambos',
        titulo: 'Comité Paritario constituido cuando corresponde',
        evaluar: (ctx) => estadoOrganoRequisito(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO, {
            obligatorio: ctx.obligaciones?.[EP.TIPO_ORGANO.COMITE_PARITARIO]?.obligatorio,
        }),
    },
    {
        id: 'FUF-31', item: 31, bloque: B.ORGANIZACION, ambito: 'ambos',
        titulo: 'Curso de orientación en prevención de los integrantes electos',
        evaluar: (ctx) => {
            const obligatorio = ctx.obligaciones?.[EP.TIPO_ORGANO.COMITE_PARITARIO]?.obligatorio;
            const bloqueo = sinOrgano(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO, obligatorio);
            if (bloqueo) return bloqueo;

            const o = vigente(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO);
            const electos = (ctx.miembros || []).filter(
                (m) => m.organoId === o.organoId && m.estamento === EP.ESTAMENTO.TRABAJADORES
            );
            if (electos.length === 0) return { estado: E.PENDIENTE, detalle: 'Sin integrantes electos registrados.' };

            const acreditados = electos.filter((m) => m.acreditacion?.realizada).length;
            if (acreditados === electos.length) return { estado: E.CUMPLIDO, detalle: 'Todos los electos acreditados.' };

            // Pasado el primer semestre del mandato el plazo del Art. 32 venció.
            const limite = EP.fechaLimiteCursoOpr(o.fechaEleccionODesignacion);
            const vencido = limite && new Date(limite).getTime() < (ctx.ahora || new Date()).getTime();
            return {
                estado: vencido ? E.VENCIDO : (acreditados > 0 ? E.PARCIAL : E.PENDIENTE),
                detalle: `${acreditados} de ${electos.length} electos con el curso acreditado.`,
            };
        },
    },
    {
        id: 'FUF-32', item: 32, bloque: B.ORGANIZACION, ambito: 'ambos',
        titulo: 'Acta de constitución registrada en la Dirección del Trabajo',
        evaluar: (ctx) => {
            const obligatorio = ctx.obligaciones?.[EP.TIPO_ORGANO.COMITE_PARITARIO]?.obligatorio;
            const bloqueo = sinOrgano(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO, obligatorio);
            if (bloqueo) return bloqueo;

            const doc = docOrgano(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO, 'comprobanteDT');
            if (doc) return { estado: E.CUMPLIDO, detalle: 'Comprobante de registro cargado.' };

            // El plazo se calcula excluyendo solo fin de semana (ver fechaChile.js):
            // llega antes que el real, así que avisa temprano y nunca tarde.
            const o = vigente(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO);
            const limite = ctx.limiteRegistroDT || null;
            const vencido = limite && new Date(limite).getTime() < (ctx.ahora || new Date()).getTime();
            return {
                estado: vencido ? E.VENCIDO : E.PENDIENTE,
                detalle: vencido
                    ? `El plazo de ${EP.DIAS_HABILES_REGISTRO_DT} días hábiles desde la elección (${String(o.fechaEleccionODesignacion).slice(0, 10)}) ya pasó.`
                    : 'Pendiente de registrar en la Dirección del Trabajo.',
            };
        },
    },
    {
        id: 'FUF-33', item: 33, bloque: B.ORGANIZACION, ambito: 'ambos',
        titulo: 'Facilidades para el funcionamiento del comité',
        evaluar: () => ({
            estado: E.FUERA_DE_ALCANCE,
            detalle: 'Se acredita con la regularidad de las actas y entregas, no con evidencia propia.',
        }),
    },
    {
        id: 'FUF-34', item: 34, bloque: B.ORGANIZACION, ambito: 'ambos',
        titulo: 'Reuniones ordinarias mensuales y extraordinarias',
        evaluar: (ctx) => {
            const obligatorio = ctx.obligaciones?.[EP.TIPO_ORGANO.COMITE_PARITARIO]?.obligatorio;
            const bloqueo = sinOrgano(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO, obligatorio);
            if (bloqueo) return bloqueo;

            const o = vigente(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO);
            const ahora = ctx.ahora || new Date();
            // Solo cuentan las ordinarias cuyo mes ya transcurrió: la del mes en
            // curso todavía puede realizarse.
            const debidas = (ctx.reuniones || []).filter(
                (r) => r.organoId === o.organoId
                    && r.tipo === EP.TIPO_REUNION.ORDINARIA
                    && new Date(r.fechaProgramada).getTime() < ahora.getTime()
            );
            if (debidas.length === 0) return { estado: E.PENDIENTE, detalle: 'Aún no vence ninguna reunión ordinaria.' };

            const realizadas = debidas.filter((r) => r.estado === EP.ESTADO_REUNION.REALIZADA).length;
            if (realizadas === debidas.length) return { estado: E.CUMPLIDO, detalle: `${realizadas} de ${debidas.length} reuniones con acta.` };
            return {
                estado: realizadas > 0 ? E.PARCIAL : E.VENCIDO,
                detalle: `${debidas.length - realizadas} reunión(es) ordinaria(s) sin acta.`,
            };
        },
    },
    {
        id: 'FUF-35', item: 35, bloque: B.ORGANIZACION, ambito: 'ambos',
        titulo: 'Actas de reunión con materias, acuerdos y plazos',
        evaluar: (ctx) => {
            const obligatorio = ctx.obligaciones?.[EP.TIPO_ORGANO.COMITE_PARITARIO]?.obligatorio;
            const bloqueo = sinOrgano(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO, obligatorio);
            if (bloqueo) return bloqueo;

            const o = vigente(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO);
            const realizadas = (ctx.reuniones || []).filter(
                (r) => r.organoId === o.organoId && r.estado === EP.ESTADO_REUNION.REALIZADA
            );
            if (realizadas.length === 0) return { estado: E.PENDIENTE, detalle: 'Aún no hay reuniones realizadas.' };
            // El sistema garantiza que TODA reunión realizada tiene acta adjunta
            // (no se puede marcar realizada sin ella). Que el acta consigne las
            // materias, los acuerdos y sus plazos es contenido del documento y
            // responsabilidad de quien lo redacta: no se verifica.
            const conActa = realizadas.filter((r) => r.actaDocumentoId).length;
            return conActa === realizadas.length
                ? { estado: E.CUMPLIDO, detalle: `${conActa} acta(s) adjunta(s).` }
                : { estado: E.PARCIAL, detalle: `${realizadas.length - conActa} reunión(es) realizada(s) sin acta.` };
        },
    },
    {
        id: 'FUF-37', item: 37, bloque: B.ORGANIZACION, ambito: 'ambos',
        titulo: 'Documentación preventiva entregada al comité',
        evaluar: (ctx) => {
            const obligatorio = ctx.obligaciones?.[EP.TIPO_ORGANO.COMITE_PARITARIO]?.obligatorio;
            const bloqueo = sinOrgano(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO, obligatorio);
            if (bloqueo) return bloqueo;
            // Este encargo solo garantiza que el comité EXISTA y sea consultable
            // como destinatario asignable. La distribución documental y su acuse
            // son de otro encargo (sección 7).
            const o = vigente(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO);
            const integrantes = (ctx.miembros || []).filter((m) => m.organoId === o.organoId).length;
            return integrantes > 0
                ? { estado: E.CUMPLIDO, detalle: `Comité consultable como destinatario, con ${integrantes} integrante(s).` }
                : { estado: E.PARCIAL, detalle: 'Comité constituido sin integrantes registrados.' };
        },
    },
    {
        id: 'FUF-36', item: 36, bloque: B.ORGANIZACION, ambito: 'ambos',
        titulo: 'Acuerdos comunicados por escrito a la entidad empleadora',
        evaluar: (ctx) => {
            const obligatorio = ctx.obligaciones?.[EP.TIPO_ORGANO.COMITE_PARITARIO]?.obligatorio;
            const bloqueo = sinOrgano(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO, obligatorio);
            if (bloqueo) return bloqueo;

            const o = vigente(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO);
            const realizadas = (ctx.reuniones || []).filter(
                (r) => r.organoId === o.organoId && r.estado === EP.ESTADO_REUNION.REALIZADA
            );
            if (realizadas.length === 0) return { estado: E.PENDIENTE, detalle: 'Aún no hay reuniones realizadas.' };

            const comunicadas = realizadas.filter((r) => r.comunicacionAcuerdosDocumentoId).length;
            if (comunicadas === realizadas.length) return { estado: E.CUMPLIDO, detalle: 'Todas las reuniones con acuerdos comunicados.' };
            return {
                estado: comunicadas > 0 ? E.PARCIAL : E.PENDIENTE,
                detalle: `${comunicadas} de ${realizadas.length} reuniones con la comunicación adjunta.`,
            };
        },
    },
    {
        id: 'FUF-38', item: 38, bloque: B.ORGANIZACION, ambito: 'ambos',
        titulo: 'Programa de trabajo del comité vigente',
        evaluar: (ctx) => {
            const obligatorio = ctx.obligaciones?.[EP.TIPO_ORGANO.COMITE_PARITARIO]?.obligatorio;
            const bloqueo = sinOrgano(ctx, EP.TIPO_ORGANO.COMITE_PARITARIO, obligatorio);
            if (bloqueo) return bloqueo;

            const docs = (ctx.documentos || []).filter((d) => d.tipo === 'PROGRAMA_TRABAJO_CPHS');
            const r = EP.estadoDocumentoPeriodico(docs, EP.periodoAnual(ctx.ahora), ctx.ahora);
            if (r.estado === 'Cargado') return { estado: E.CUMPLIDO, detalle: `Programa del período ${r.periodo} cargado.` };
            return {
                estado: r.estado === 'Vencido' ? E.VENCIDO : E.PENDIENTE,
                detalle: `Sin programa de trabajo para el período ${r.periodo}.`,
            };
        },
    },
    {
        id: 'FUF-39', item: 39, bloque: B.ORGANIZACION, ambito: 'ambos',
        titulo: 'Delegado de Seguridad y Salud en el Trabajo',
        evaluar: (ctx) => estadoOrganoRequisito(ctx, EP.TIPO_ORGANO.DELEGADO_SST, {
            obligatorio: ctx.obligaciones?.[EP.TIPO_ORGANO.DELEGADO_SST]?.obligatorio,
        }),
    },
    {
        id: 'FUF-40', item: 40, bloque: B.ORGANIZACION, ambito: 'ambos',
        titulo: 'Elección del delegado cada 2 años con acta de asamblea',
        evaluar: (ctx) => {
            const obligatorio = ctx.obligaciones?.[EP.TIPO_ORGANO.DELEGADO_SST]?.obligatorio;
            const bloqueo = sinOrgano(ctx, EP.TIPO_ORGANO.DELEGADO_SST, obligatorio);
            if (bloqueo) return bloqueo;
            const doc = docOrgano(ctx, EP.TIPO_ORGANO.DELEGADO_SST, 'actaAsamblea');
            return doc
                ? { estado: E.CUMPLIDO, detalle: 'Acta de asamblea cargada.' }
                : { estado: E.PARCIAL, detalle: 'Delegado vigente, falta el acta de asamblea.' };
        },
    },
    {
        id: 'FUF-41', item: 41, bloque: B.ORGANIZACION, ambito: 'empresa',
        titulo: 'Departamento de Prevención dirigido por experto inscrito',
        evaluar: (ctx) => {
            const obligatorio = ctx.obligaciones?.[EP.TIPO_ORGANO.DEPARTAMENTO_PREVENCION]?.obligatorio;
            const base = estadoOrganoRequisito(ctx, EP.TIPO_ORGANO.DEPARTAMENTO_PREVENCION, { obligatorio });
            if (base.estado !== E.CUMPLIDO) return base;
            const doc = docOrgano(ctx, EP.TIPO_ORGANO.DEPARTAMENTO_PREVENCION, 'registroSeremi');
            return doc
                ? { estado: E.CUMPLIDO, detalle: 'Departamento con registro Seremi del experto.' }
                : { estado: E.PARCIAL, detalle: 'Departamento constituido, falta el registro Seremi del experto.' };
        },
    },
    ...[42, 43, 44, 45].map((item) => ({
        id: `FUF-${item}`, item, bloque: B.ORGANIZACION, ambito: 'empresa',
        titulo: 'Medios, funciones, categoría y asistencia del Departamento de Prevención',
        evaluar: () => ({ estado: E.FUERA_DE_ALCANCE, detalle: 'Fuera del alcance de este módulo.' }),
    })),
    {
        id: 'FUF-46', item: 46, bloque: B.REGISTROS, ambito: 'empresa',
        titulo: 'Registros e indicadores del Departamento de Prevención',
        evaluar: (ctx) => evaluarRegistros(ctx, 'extendido'),
    },
    {
        id: 'FUF-47', item: 47, bloque: B.REGISTROS, ambito: 'empresa',
        titulo: 'Registros mínimos sin obligación de Departamento de Prevención',
        evaluar: (ctx) => evaluarRegistros(ctx, 'minimo'),
    },
    {
        id: 'FUF-48', item: 48, bloque: B.ORGANIZACION, ambito: 'empresa',
        titulo: 'Encargado de gestión del riesgo capacitado por el Organismo Administrador',
        evaluar: (ctx) => {
            const ob = ctx.obligaciones?.[EP.TIPO_ORGANO.ENCARGADO_GESTION_RIESGO];
            if (!ob?.aplica) {
                return { estado: E.NO_APLICA, detalle: 'Con más de 100 personas corresponde Departamento de Prevención.' };
            }
            const v = vigente(ctx, EP.TIPO_ORGANO.ENCARGADO_GESTION_RIESGO);
            // El Art. 65 no obliga a designarlo: si no hay, no es incumplimiento.
            if (!v) return { estado: E.NO_APLICA, detalle: 'Figura disponible; la entidad no ha designado encargado.' };
            const doc = docOrgano(ctx, EP.TIPO_ORGANO.ENCARGADO_GESTION_RIESGO, 'capacitacionOAL');
            return doc
                ? { estado: E.CUMPLIDO, detalle: 'Encargado designado y capacitado.' }
                : { estado: E.PARCIAL, detalle: 'Encargado designado, falta el certificado de capacitación del OAL.' };
        },
    },
];

/**
 * Ítems 46 y 47: EXCLUYENTES. El sistema exige uno u otro según la obligación
 * calculada; el que no corresponde sale del denominador en vez de penalizar.
 */
function evaluarRegistros(ctx, perfilEsperado) {
    const perfil = EP.perfilRegistrosIndicadores(ctx.dotacion || 0);
    if (perfil.perfil !== perfilEsperado) {
        return {
            estado: E.NO_APLICA,
            detalle: perfilEsperado === 'extendido'
                ? 'Sin obligación de Departamento de Prevención: corresponde el perfil mínimo (ítem 47).'
                : 'Con Departamento de Prevención obligatorio corresponde el perfil extendido (ítem 46).',
        };
    }
    const docs = (ctx.documentos || []).filter((d) => d.tipo === 'REGISTROS_INDICADORES_SST');
    const r = EP.estadoDocumentoPeriodico(docs, EP.periodoAnual(ctx.ahora), ctx.ahora);
    if (r.estado === 'Cargado') return { estado: E.CUMPLIDO, detalle: `Registros del período ${r.periodo} cargados.` };
    return {
        estado: r.estado === 'Vencido' ? E.VENCIDO : E.PENDIENTE,
        detalle: `Sin registros e indicadores para el período ${r.periodo} (${perfil.articulo}).`,
    };
}

/** Definiciones que aplican a un ámbito, ordenadas por número de ítem del FUF
 *  para que el panel y el export los recorran igual que el fiscalizador. */
const definicionesPara = (ambito) =>
    DEFINICIONES_ESTRUCTURA
        .filter((d) => d.ambito === 'ambos' || d.ambito === ambito)
        .sort((a, b) => (a.item || 0) - (b.item || 0));

module.exports = { DEFINICIONES_ESTRUCTURA, definicionesPara };
