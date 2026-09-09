/**
 * EstructuraPreventivaService — órganos preventivos del DS 44.
 *
 * Persiste comité paritario, delegado SST, departamento de prevención y
 * encargado de gestión del riesgo, con sus integrantes y reuniones.
 *
 * Los UMBRALES y las validaciones de dominio NO viven acá: viven en
 * `lib/estructura-preventiva.js`, que es puro y corre igual en el cliente sin
 * conexión. Este servicio solo orquesta y guarda. Si alguna vez hay que decidir
 * si un órgano es obligatorio, se pregunta allá.
 *
 * MODELO DE DATOS — una sola tabla (`ESTRUCTURA_TABLE`) con prefijos en la sort
 * key, en vez de las tres que el encargo autorizaba como máximo:
 *
 *   PK `tenantId`  ·  SK `ORG#{organoId}`                 → el órgano
 *                     SK `MIE#{organoId}#{miembroId}`     → un integrante
 *                     SK `REU#{organoId}#{reunionId}`     → una reunión
 *
 * Razones: los integrantes y las reuniones no existen sin su órgano y nunca se
 * consultan fuera de él, así que separarlos en tablas propias solo agrega dos
 * roundtrips. Con esta forma, listar los órganos de un tenant es un Query con
 * `begins_with(sk, 'ORG#')` que NO arrastra las ~24 reuniones de cada mandato, y
 * abrir un órgano completo es un Query por prefijo. El órgano se obtiene además
 * por Get directo, sin índice secundario.
 *
 * FUERA DE ALCANCE: subcontratación (la dotación de una obra es la de la obra) y
 * validación de investiduras (que la persona designada sea realmente experto o
 * miembro es responsabilidad de la entidad empleadora, no del sistema).
 */

const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const EP = require('../estructura-preventiva');
const C = require('../completitud');
const { definicionesPara } = require('../completitud-estructura');
const { definicionesDocumentalesPara, componentesSgsst } = require('../completitud-documental');
const { sumarDiasHabiles } = require('../utils/fechaChile');
const PRE = require('../prescripciones');

const TABLE = process.env.ESTRUCTURA_TABLE || 'EstructuraPreventiva';

const skOrgano = (organoId) => `ORG#${organoId}`;
const skMiembro = (organoId, miembroId) => `MIE#${organoId}#${miembroId}`;
const skReunion = (organoId, reunionId) => `REU#${organoId}#${reunionId}`;
// Las prescripciones del Art. 70 no cuelgan de un órgano: son del ámbito. Viven
// en esta misma tabla con su propio prefijo para no crear una tabla más, que es
// el estándar que dejó el encargo anterior.
const skPrescripcion = (prescripcionId) => `PRE#${prescripcionId}`;

/** Adjunto tal como lo devuelve /uploads. Mismo shape que EppCatalogoService. */
const sanitizeAdjunto = (adj) => {
    if (!adj || typeof adj !== 'object') return null;
    const fileKey = String(adj.fileKey || adj.url || '').trim();
    if (!fileKey) return null;
    return {
        fileKey,
        nombre: String(adj.nombre || adj.fileName || 'documento').trim(),
        tipo: adj.tipo || adj.fileType || null,
        subidoEn: adj.subidoEn || new Date().toISOString(),
    };
};

class ErrorValidacion extends Error {
    constructor(errores) {
        super(Array.isArray(errores) ? errores.join(' ') : String(errores));
        this.name = 'ErrorValidacion';
        this.errores = Array.isArray(errores) ? errores : [errores];
        this.statusCode = 400;
    }
}

class EstructuraPreventivaService {

    // ─── Lectura ─────────────────────────────────────────────────────────────

    /** Órganos del tenant. `ambito`/`obraId` filtran en memoria: son decenas, no miles. */
    async listarOrganos(tenantId, { ambito = null, obraId = null } = {}) {
        if (!tenantId) throw new Error('tenantId es requerido');
        const res = await docClient.send(new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
            ExpressionAttributeValues: { ':t': tenantId, ':p': 'ORG#' },
        }));
        let organos = res.Items || [];
        if (ambito) organos = organos.filter((o) => o.ambito === ambito);
        if (obraId) organos = organos.filter((o) => o.obraId === obraId);
        return organos.map((o) => this._conEstadoDerivado(o));
    }

    /**
     * Un órgano con sus integrantes y reuniones.
     *
     * Son tres lecturas en paralelo y no una: DynamoDB no admite `OR` en la
     * condición de clave, así que los prefijos `MIE#` y `REU#` se consultan por
     * separado. Van en `Promise.all` para que cueste un solo roundtrip de latencia.
     */
    async getOrgano(tenantId, organoId) {
        if (!tenantId || !organoId) throw new Error('tenantId y organoId son requeridos');

        const porPrefijo = (prefijo) => docClient.send(new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
            ExpressionAttributeValues: { ':t': tenantId, ':p': prefijo },
        }));

        const [org, mie, reu] = await Promise.all([
            docClient.send(new GetCommand({ TableName: TABLE, Key: { tenantId, sk: skOrgano(organoId) } })),
            porPrefijo(`MIE#${organoId}#`),
            porPrefijo(`REU#${organoId}#`),
        ]);

        if (!org.Item) return null;
        return {
            ...this._conEstadoDerivado(org.Item),
            miembros: mie.Items || [],
            reuniones: (reu.Items || []).sort((a, b) =>
                String(a.periodoMes || a.fechaProgramada).localeCompare(String(b.periodoMes || b.fechaProgramada))),
        };
    }

    /** `estado` es DERIVADO: un mandato vencido lo está aunque nadie lo cierre. */
    _conEstadoDerivado(organo, ahora = new Date()) {
        return { ...organo, estado: EP.estadoOrgano(organo, ahora) };
    }

    // ─── Constitución ────────────────────────────────────────────────────────

    /**
     * Constituye un órgano. Valida las reglas de dominio de la sección 10 antes
     * de escribir, no solo en el formulario.
     *
     * El `origen` (obligatorio/voluntario) se calcula AQUÍ y queda histórico: si
     * la dotación cambia después, el órgano no cambia de origen, porque su
     * ausencia previa nunca fue un incumplimiento.
     */
    async constituirOrgano({
        tenantId, ambito, obraId = null, tipo,
        fechaEleccionODesignacion, fechaConstitucion = null, fechaTerminoMandato = null,
        miembros = [], dotacion = 0, hayCphsVigente = false, fechaCreacionAmbito = null,
        creadoPor = null, ahora = new Date(),
    }) {
        if (!tenantId) throw new Error('tenantId es requerido');
        if (!Object.values(EP.TIPO_ORGANO).includes(tipo)) throw new ErrorValidacion(`Tipo de órgano inválido: ${tipo}`);
        if (ambito === EP.AMBITO.OBRA && !obraId) throw new ErrorValidacion('Un órgano de ámbito obra requiere obraId.');

        // Regla 1: no coexisten dos órganos vigentes del mismo tipo en el ámbito.
        const existentes = await this.listarOrganos(tenantId, { ambito, obraId });
        const yaVigente = existentes.find((o) => o.tipo === tipo && o.estado === EP.ESTADO_ORGANO.VIGENTE);
        if (yaVigente) {
            throw new ErrorValidacion(
                'Ya existe un órgano vigente de este tipo en el ámbito. Disuélvelo o espera el término de su mandato antes de constituir uno nuevo.'
            );
        }

        // Mandato: 2 años por defecto, editable solo a la baja (lo valida validarFechasOrgano).
        const terminoCalculado = EP.tieneMandato(tipo)
            ? (fechaTerminoMandato || EP.fechaTerminoMandato(fechaEleccionODesignacion))
            : null;

        const errores = [
            ...EP.validarFechasOrgano({
                tipo, fechaEleccionODesignacion, fechaConstitucion,
                fechaTerminoMandato: terminoCalculado, fechaCreacionAmbito, ahora,
            }),
            ...EP.validarMiembros(miembros, tipo),
        ];
        if (errores.length > 0) throw new ErrorValidacion(errores);

        const organoId = uuidv4();
        const nowISO = ahora.toISOString();
        const obligaciones = EP.obligacionesDeAmbito({ dotacion, ambito, hayCphsVigente });
        const origen = EP.origenSegunObligacion(Boolean(obligaciones[tipo]?.obligatorio));

        const organo = {
            tenantId, sk: skOrgano(organoId), organoId,
            ambito, obraId: ambito === EP.AMBITO.OBRA ? obraId : null,
            tipo, origen,
            fechaEleccionODesignacion,
            fechaConstitucion: fechaConstitucion || null,
            fechaTerminoMandato: terminoCalculado,
            estado: EP.ESTADO_ORGANO.VIGENTE,
            // Dotación al momento de constituir: deja constancia de por qué el
            // origen quedó obligatorio o voluntario.
            dotacionAlConstituir: Number(dotacion) || 0,
            documentos: {},          // { [tipoDocumento]: documentId }
            comprobanteRegistroDT: null,
            creadoPor, createdAt: nowISO, updatedAt: nowISO,
        };
        await docClient.send(new PutCommand({ TableName: TABLE, Item: organo }));

        const miembrosGuardados = await this._guardarMiembros(tenantId, organoId, miembros, nowISO);
        const reuniones = EP.tieneMandato(tipo)
            ? await this.generarReunionesOrdinarias({
                tenantId, organoId,
                desde: fechaConstitucion || fechaEleccionODesignacion,
                hasta: terminoCalculado, creadoPor,
            })
            : [];

        return { ...organo, miembros: miembrosGuardados, reuniones };
    }

    async _guardarMiembros(tenantId, organoId, miembros, nowISO) {
        const guardados = [];
        for (const m of (miembros || [])) {
            const miembroId = m.miembroId || uuidv4();
            const item = {
                tenantId, sk: skMiembro(organoId, miembroId), miembroId, organoId,
                personaId: m.personaId,
                nombre: m.nombre || null,
                estamento: m.estamento || EP.ESTAMENTO.NO_APLICA,
                calidad: m.calidad || EP.CALIDAD.TITULAR,
                cargo: m.cargo || EP.CARGO_ORGANO.INTEGRANTE,
                origenDesignacion: m.origenDesignacion || null,
                // Art. 32 (OPR), Art. 65 (capacitación OAL) y Art. 55 (registro Seremi)
                // comparten el mismo patrón: un check más un documento. Sin flujo propio.
                acreditacion: {
                    realizada: Boolean(m.acreditacion?.realizada),
                    documentoId: m.acreditacion?.documentoId || null,
                    adjunto: sanitizeAdjunto(m.acreditacion?.adjunto),
                    fecha: m.acreditacion?.fecha || null,
                },
                fechaInicio: m.fechaInicio || nowISO,
                fechaTermino: m.fechaTermino || null,
                estado: 'activo',
                createdAt: nowISO, updatedAt: nowISO,
            };
            await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
            guardados.push(item);
        }
        return guardados;
    }

    /** Actualiza la acreditación de un integrante (curso OPR, OAL, registro Seremi). */
    async actualizarAcreditacion(tenantId, organoId, miembroId, acreditacion = {}) {
        if (!tenantId || !organoId || !miembroId) throw new Error('tenantId, organoId y miembroId son requeridos');
        const res = await docClient.send(new UpdateCommand({
            TableName: TABLE,
            Key: { tenantId, sk: skMiembro(organoId, miembroId) },
            UpdateExpression: 'SET acreditacion = :a, updatedAt = :u',
            ExpressionAttributeValues: {
                ':a': {
                    realizada: Boolean(acreditacion.realizada),
                    documentoId: acreditacion.documentoId || null,
                    adjunto: sanitizeAdjunto(acreditacion.adjunto),
                    fecha: acreditacion.fecha || null,
                },
                ':u': new Date().toISOString(),
            },
            ReturnValues: 'ALL_NEW',
        }));
        return res.Attributes;
    }

    // ─── Reuniones ───────────────────────────────────────────────────────────

    /**
     * Genera las ordinarias mensuales del mandato en estado `Programada`. Es lo
     * que permite medir la periodicidad del ítem 34: sin reuniones esperadas no
     * se puede saber cuál falta.
     */
    async generarReunionesOrdinarias({ tenantId, organoId, desde, hasta, creadoPor = null }) {
        const periodos = EP.generarPeriodosOrdinarios(desde, hasta);
        const nowISO = new Date().toISOString();
        const creadas = [];
        for (const p of periodos) {
            const reunionId = uuidv4();
            const item = {
                tenantId, sk: skReunion(organoId, reunionId), reunionId, organoId,
                tipo: EP.TIPO_REUNION.ORDINARIA,
                causalExtraordinaria: null,
                periodoMes: p.periodoMes,
                fechaProgramada: p.fechaProgramada,
                fechaRealizada: null,
                actaDocumentoId: null,
                comunicacionAcuerdosDocumentoId: null,
                comunicacionAcuerdosFecha: null,
                estado: EP.ESTADO_REUNION.PROGRAMADA,
                registradoPor: creadoPor,
                createdAt: nowISO, updatedAt: nowISO,
            };
            await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
            creadas.push(item);
        }
        return creadas;
    }

    /** Reunión extraordinaria (Art. 39): causal obligatoria, no cuenta para la periodicidad. */
    async crearReunionExtraordinaria({ tenantId, organoId, causal, fechaProgramada, registradoPor = null }) {
        if (!Object.values(EP.CAUSAL_EXTRAORDINARIA).includes(causal)) {
            throw new ErrorValidacion(
                `Causal inválida. Válidas: ${Object.values(EP.CAUSAL_EXTRAORDINARIA).join(', ')}`
            );
        }
        const reunionId = uuidv4();
        const nowISO = new Date().toISOString();
        const item = {
            tenantId, sk: skReunion(organoId, reunionId), reunionId, organoId,
            tipo: EP.TIPO_REUNION.EXTRAORDINARIA,
            causalExtraordinaria: causal,
            periodoMes: null,
            fechaProgramada: fechaProgramada || nowISO,
            fechaRealizada: null,
            actaDocumentoId: null,
            comunicacionAcuerdosDocumentoId: null,
            comunicacionAcuerdosFecha: null,
            estado: EP.ESTADO_REUNION.PROGRAMADA,
            registradoPor, createdAt: nowISO, updatedAt: nowISO,
        };
        await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
        return item;
    }

    /**
     * Marca una reunión como realizada. Regla 8: sin acta adjunta no se puede.
     * El CONTENIDO del acta (materias, acuerdos, plazos) es responsabilidad del
     * usuario: el sistema no lo desglosa ni lo verifica.
     */
    async registrarReunionRealizada({ tenantId, organoId, reunionId, fechaRealizada, actaDocumentoId, registradoPor = null, ahora = new Date() }) {
        const errores = EP.validarReunionRealizada({ fechaRealizada, actaDocumentoId, ahora });
        if (errores.length > 0) throw new ErrorValidacion(errores);

        const res = await docClient.send(new UpdateCommand({
            TableName: TABLE,
            Key: { tenantId, sk: skReunion(organoId, reunionId) },
            UpdateExpression: 'SET fechaRealizada = :f, actaDocumentoId = :a, estado = :e, registradoPor = :r, updatedAt = :u',
            ConditionExpression: 'attribute_exists(sk)',
            ExpressionAttributeValues: {
                ':f': fechaRealizada, ':a': actaDocumentoId,
                ':e': EP.ESTADO_REUNION.REALIZADA, ':r': registradoPor,
                ':u': ahora.toISOString(),
            },
            ReturnValues: 'ALL_NEW',
        }));
        return res.Attributes;
    }

    /** Ítem 36: comunicación escrita de los acuerdos a la entidad empleadora. */
    async registrarComunicacionAcuerdos({ tenantId, organoId, reunionId, documentoId, fecha = null }) {
        if (!documentoId) throw new ErrorValidacion('Se requiere el documento de la comunicación.');
        const res = await docClient.send(new UpdateCommand({
            TableName: TABLE,
            Key: { tenantId, sk: skReunion(organoId, reunionId) },
            UpdateExpression: 'SET comunicacionAcuerdosDocumentoId = :d, comunicacionAcuerdosFecha = :f, updatedAt = :u',
            ConditionExpression: 'attribute_exists(sk)',
            ExpressionAttributeValues: {
                ':d': documentoId, ':f': fecha || new Date().toISOString(), ':u': new Date().toISOString(),
            },
            ReturnValues: 'ALL_NEW',
        }));
        return res.Attributes;
    }

    /** Reagendar dentro del mes: la periodicidad es mensual, la fecha exacta no. */
    async reagendarReunion({ tenantId, organoId, reunionId, fechaProgramada }) {
        const nueva = new Date(fechaProgramada);
        if (Number.isNaN(nueva.getTime())) throw new ErrorValidacion('Fecha inválida.');
        const actual = await docClient.send(new GetCommand({
            TableName: TABLE, Key: { tenantId, sk: skReunion(organoId, reunionId) },
        }));
        if (!actual.Item) throw new ErrorValidacion('Reunión no encontrada.');
        if (actual.Item.periodoMes && !fechaProgramada.startsWith(actual.Item.periodoMes)) {
            throw new ErrorValidacion(
                `La reunión ordinaria de ${actual.Item.periodoMes} debe reagendarse dentro del mismo mes (Art. 39).`
            );
        }
        const res = await docClient.send(new UpdateCommand({
            TableName: TABLE,
            Key: { tenantId, sk: skReunion(organoId, reunionId) },
            UpdateExpression: 'SET fechaProgramada = :f, updatedAt = :u',
            ExpressionAttributeValues: { ':f': fechaProgramada, ':u': new Date().toISOString() },
            ReturnValues: 'ALL_NEW',
        }));
        return res.Attributes;
    }

    // ─── Documentos del órgano ───────────────────────────────────────────────

    /** Asocia un documento ya cargado al órgano (acta de constitución, comprobante DT…). */
    async vincularDocumento({ tenantId, organoId, clave, documentoId }) {
        if (!clave || !documentoId) throw new ErrorValidacion('Se requieren clave y documentoId.');
        const res = await docClient.send(new UpdateCommand({
            TableName: TABLE,
            Key: { tenantId, sk: skOrgano(organoId) },
            UpdateExpression: 'SET documentos.#k = :d, updatedAt = :u',
            ConditionExpression: 'attribute_exists(sk)',
            ExpressionAttributeNames: { '#k': clave },
            ExpressionAttributeValues: { ':d': documentoId, ':u': new Date().toISOString() },
            ReturnValues: 'ALL_NEW',
        }));
        return res.Attributes;
    }

    // ─── Disolución ──────────────────────────────────────────────────────────

    /**
     * Disuelve un órgano. Regla 11: sus reuniones futuras programadas se cancelan
     * para que dejen de generar alertas de "reunión sin acta" de un comité que ya
     * no existe. Las pasadas NO se tocan: son evidencia de lo que ocurrió.
     */
    async disolverOrgano({ tenantId, organoId, motivo = null, ahora = new Date() }) {
        const nowISO = ahora.toISOString();
        await docClient.send(new UpdateCommand({
            TableName: TABLE,
            Key: { tenantId, sk: skOrgano(organoId) },
            UpdateExpression: 'SET estado = :e, fechaDisolucion = :f, motivoDisolucion = :m, updatedAt = :u',
            ConditionExpression: 'attribute_exists(sk)',
            ExpressionAttributeValues: {
                ':e': EP.ESTADO_ORGANO.DISUELTO, ':f': nowISO, ':m': motivo, ':u': nowISO,
            },
        }));
        return this.cancelarReunionesFuturas({ tenantId, organoId, ahora });
    }

    async cancelarReunionesFuturas({ tenantId, organoId, ahora = new Date() }) {
        const res = await docClient.send(new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
            ExpressionAttributeValues: { ':t': tenantId, ':p': `REU#${organoId}#` },
        }));
        const futuras = (res.Items || []).filter((r) =>
            r.estado === EP.ESTADO_REUNION.PROGRAMADA
            && new Date(r.fechaProgramada).getTime() > ahora.getTime());

        for (const r of futuras) {
            await docClient.send(new UpdateCommand({
                TableName: TABLE,
                Key: { tenantId, sk: r.sk },
                UpdateExpression: 'SET estado = :e, updatedAt = :u',
                ExpressionAttributeValues: { ':e': EP.ESTADO_REUNION.NO_REALIZADA, ':u': ahora.toISOString() },
            }));
        }
        return { canceladas: futuras.length };
    }

    async eliminarOrgano(tenantId, organoId) {
        const completo = await this.getOrgano(tenantId, organoId);
        if (!completo) return false;
        const sks = [
            skOrgano(organoId),
            ...completo.miembros.map((m) => m.sk),
            ...completo.reuniones.map((r) => r.sk),
        ];
        for (const sk of sks) {
            await docClient.send(new DeleteCommand({ TableName: TABLE, Key: { tenantId, sk } }));
        }
        return true;
    }

    // ─── Resumen de ámbito (sección 3 y 7 del encargo) ───────────────────────

    /**
     * Fotografía del ámbito: dotación, obligación por figura, órganos existentes
     * y los destinatarios preventivos vigentes.
     *
     * Los `destinatarios` son lo único que la sección 7 pide exponer: los ítems
     * transversales (4, 11, 25, 50, 51, 58) solo necesitan poder asignar el
     * comité, el delegado o el DPR como receptores. La distribución documental,
     * los acuses y los plazos son de sus propios encargos.
     */
    async resumenAmbito({ tenantId, ambito, obraId = null, personas = [], dotacionDeclarada = null, dotacionObservacion = null, fechaCreacionAmbito = null, ahora = new Date() }) {
        const calculada = ambito === EP.AMBITO.OBRA
            ? EP.dotacionDeObra(personas, obraId)
            : EP.dotacionDeEmpresa(personas);

        const dot = EP.dotacionEfectiva({ calculada, declarada: dotacionDeclarada, observacion: dotacionObservacion });
        const organos = await this.listarOrganos(tenantId, { ambito, obraId });
        const cphsVigente = EP.hayCphsVigente(organos, ahora);
        const obligaciones = EP.obligacionesDeAmbito({ dotacion: dot.dotacion, ambito, hayCphsVigente: cphsVigente });

        const vigentes = organos.filter((o) => o.estado === EP.ESTADO_ORGANO.VIGENTE);
        const destinatarios = [];
        for (const o of vigentes) {
            const completo = await this.getOrgano(tenantId, o.organoId);
            destinatarios.push({
                organoId: o.organoId, tipo: o.tipo, ambito: o.ambito, obraId: o.obraId,
                personaIds: (completo?.miembros || []).map((m) => m.personaId).filter(Boolean),
            });
        }

        return {
            ambito, obraId,
            dotacion: dot,
            obligaciones,
            organos,
            destinatarios,
            registrosIndicadores: ambito === EP.AMBITO.EMPRESA
                ? EP.perfilRegistrosIndicadores(dot.dotacion)
                : null,
            fechaCreacionAmbito,
        };
    }

    // ─── Prescripciones de medidas (Art. 70, ítem 58) ────────────────────────

    /** Prescripciones del tenant, con su estado derivado del plazo. */
    async listarPrescripciones(tenantId, { obraId = null, ahora = new Date() } = {}) {
        if (!tenantId) throw new Error('tenantId es requerido');
        const res = await docClient.send(new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
            ExpressionAttributeValues: { ':t': tenantId, ':p': 'PRE#' },
        }));
        let lista = res.Items || [];
        // El ámbito obra incluye las de la empresa: una medida prescrita a la
        // entidad también obliga en la faena.
        if (obraId) lista = lista.filter((x) => !x.obraId || x.obraId === obraId);
        return PRE.resumirPrescripciones(lista, ahora).prescripciones
            .sort((a, b) => String(b.fechaPrescripcion).localeCompare(String(a.fechaPrescripcion)));
    }

    async crearPrescripcion({ tenantId, ahora = new Date(), ...datos }) {
        if (!tenantId) throw new Error('tenantId es requerido');
        const errores = PRE.validarPrescripcion(datos, ahora);
        if (errores.length > 0) throw new ErrorValidacion(errores);

        const prescripcionId = uuidv4();
        const nowISO = ahora.toISOString();
        const item = {
            tenantId, sk: skPrescripcion(prescripcionId), prescripcionId,
            obraId: datos.obraId || null,
            origen: datos.origen,
            fechaPrescripcion: datos.fechaPrescripcion,
            descripcion: String(datos.descripcion).trim(),
            plazoImplementacion: datos.plazoImplementacion || null,
            documentoPrescripcionId: datos.documentoPrescripcionId || null,
            // Conexión OPT IN con una reunión del comité: nunca automática.
            reunionOrigenId: datos.reunionOrigenId || null,
            fechaImplementacion: datos.fechaImplementacion || null,
            evidenciaImplementacionDocumentoId: datos.evidenciaImplementacionDocumentoId || null,
            registradoPor: datos.registradoPor || null,
            createdAt: nowISO, updatedAt: nowISO,
        };
        await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
        return { ...item, estado: PRE.estadoPrescripcion(item, ahora) };
    }

    /**
     * Actualiza una prescripción. El `estado` NO se recibe: se deriva. Marcar
     * "implementada" a mano sin evidencia es justamente lo que la validación impide.
     */
    async actualizarPrescripcion({ tenantId, prescripcionId, cambios = {}, ahora = new Date() }) {
        const actual = await docClient.send(new GetCommand({
            TableName: TABLE, Key: { tenantId, sk: skPrescripcion(prescripcionId) },
        }));
        if (!actual.Item) throw new ErrorValidacion('Prescripción no encontrada.');

        const CAMPOS = ['origen', 'fechaPrescripcion', 'descripcion', 'plazoImplementacion',
            'documentoPrescripcionId', 'fechaImplementacion', 'evidenciaImplementacionDocumentoId'];
        const propuesto = { ...actual.Item };
        for (const c of CAMPOS) if (cambios[c] !== undefined) propuesto[c] = cambios[c];

        const errores = PRE.validarPrescripcion(propuesto, ahora);
        if (errores.length > 0) throw new ErrorValidacion(errores);

        const sets = [];
        const vals = { ':u': ahora.toISOString() };
        const names = {};
        for (const c of CAMPOS) {
            if (cambios[c] === undefined) continue;
            sets.push(`#${c} = :${c}`);
            names[`#${c}`] = c;
            vals[`:${c}`] = cambios[c];
        }
        if (sets.length === 0) return { ...actual.Item, estado: PRE.estadoPrescripcion(actual.Item, ahora) };

        const res = await docClient.send(new UpdateCommand({
            TableName: TABLE, Key: { tenantId, sk: skPrescripcion(prescripcionId) },
            UpdateExpression: `SET ${sets.join(', ')}, updatedAt = :u`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: vals,
            ReturnValues: 'ALL_NEW',
        }));
        return { ...res.Attributes, estado: PRE.estadoPrescripcion(res.Attributes, ahora) };
    }

    async eliminarPrescripcion(tenantId, prescripcionId) {
        await docClient.send(new DeleteCommand({
            TableName: TABLE, Key: { tenantId, sk: skPrescripcion(prescripcionId) },
        }));
        return true;
    }

    // ─── Completitud del FUF (sección 8) ─────────────────────────────────────

    /**
     * Estado de los requisitos del FUF que cubre este módulo, para el ámbito.
     *
     * Devuelve lo MISMO que leerá el export: las definiciones de
     * `completitud-estructura.js` son el único lugar donde un ítem del FUF se
     * vincula con su evidencia, así que el panel y el expediente no pueden
     * discrepar.
     */
    async completitudAmbito({ tenantId, ambito, obraId = null, personas = [], documentos = [], dotacionDeclarada = null, reglas = {}, ahora = new Date() }) {
        const resumen = await this.resumenAmbito({
            tenantId, ambito, obraId, personas, dotacionDeclarada, ahora,
        });

        // Integrantes y reuniones de todos los órganos del ámbito, en paralelo.
        const completos = await Promise.all(
            resumen.organos.map((o) => this.getOrgano(tenantId, o.organoId))
        );
        const miembros = completos.flatMap((o) => o?.miembros || []);
        const reuniones = completos.flatMap((o) => o?.reuniones || []);

        // Plazo del Art. 36 sobre el comité vigente. Se calcula excluyendo solo
        // fin de semana: llega antes que el real, así que avisa temprano.
        const comite = resumen.organos.find(
            (o) => o.tipo === EP.TIPO_ORGANO.COMITE_PARITARIO && o.estado === EP.ESTADO_ORGANO.VIGENTE
        );
        const limiteRegistroDT = comite
            ? sumarDiasHabiles(comite.fechaEleccionODesignacion, EP.DIAS_HABILES_REGISTRO_DT)
            : null;

        // El ítem 58 necesita las prescripciones y el 50 los sindicatos: se cargan
        // acá para que las definiciones sigan siendo funciones puras del contexto.
        const prescripciones = await this.listarPrescripciones(tenantId, { obraId, ahora }).catch(() => []);

        const ctx = {
            ahora,
            dotacion: resumen.dotacion.dotacion,
            obligaciones: resumen.obligaciones,
            organos: completos.filter(Boolean),
            miembros, reuniones, documentos,
            prescripciones,
            organizacionesSindicales: reglas.organizacionesSindicales || [],
            sinOrganizacionesSindicales: reglas.sinOrganizacionesSindicales || null,
            limiteRegistroDT,
        };

        // Dos fuentes de definiciones, un solo motor: estructura preventiva
        // (ítems 30-48) y las documentales (1, 50, 58). Ninguna calcula por su
        // cuenta; ambas describen cómo se acredita su ítem.
        const evaluacion = C.evaluarCompletitud(
            [...definicionesPara(ambito), ...definicionesDocumentalesPara(ambito)],
            ctx
        );
        return {
            ambito, obraId,
            dotacion: resumen.dotacion,
            limiteRegistroDT,
            // Desglose del Art. 22 para la pantalla del SGSST. Sale del mismo
            // contexto que evaluó el ítem 1, así que el panel y el porcentaje del
            // formulario no pueden discrepar. Solo en empresa: el SGSST es de la
            // entidad empleadora, no de cada obra.
            sgsst: ambito === 'empresa' ? componentesSgsst(ctx) : null,
            // Los órganos viajan para que el export pueda rotular como VOLUNTARIO
            // el que se constituyó sin estar obligado: su ausencia previa nunca
            // fue un incumplimiento y el expediente tiene que decirlo.
            organos: resumen.organos,
            ...evaluacion,
            bloques: C.agruparPorBloque(evaluacion.requisitos),
        };
    }
}

module.exports = { EstructuraPreventivaService, ErrorValidacion, TABLE_ESTRUCTURA: TABLE };
