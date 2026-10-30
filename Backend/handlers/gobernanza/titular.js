/**
 * Autoservicio del titular: "Mis datos y privacidad". Lo que cada persona hace
 * sobre SUS datos, sin pasar por nadie y sin permisos especiales: la sesión
 * dice quién es, y nada de lo que llegue en el cuerpo puede cambiar eso.
 *
 *   GET  /gobernanza/mis-datos/consentimientos               finalidades, estado e historial
 *   POST /gobernanza/mis-datos/consentimientos/{finalidad}   { accion: otorgar|revocar, version }
 *   POST /gobernanza/mis-datos/exportacion                   { password } → copia en JSON
 *   GET  /gobernanza/mis-datos/solicitudes                   las propias, con su etapa
 *   POST /gobernanza/mis-datos/solicitudes                   { derecho, detalle, cambios?, password }
 *
 * ── Verificación de identidad, proporcional al riesgo ──────────────────────
 *   - Consentimientos: basta la sesión. Revocar tiene que ser tan simple como
 *     otorgar, y ninguno de los dos entrega datos.
 *   - Exportar, rectificar, suprimir u oponerse: la sesión MÁS la contraseña
 *     escrita de nuevo. Una sesión olvidada abierta en un equipo de la obra no
 *     alcanza para llevarse los datos de alguien ni para cambiarlos. No se pide
 *     nada adicional (ni cédula, ni preguntas personales): sería recolectar más
 *     datos para proteger los que ya hay.
 *   - Tres contraseñas mal escritas en quince minutos cierran todas las
 *     sesiones de la cuenta (`lib/gobernanza/deteccion.js`).
 *
 * ── Exportaciones ──────────────────────────────────────────────────────────
 * Hasta tres por persona cada 24 horas: alcanza para cualquier uso legítimo y
 * corta la extracción repetida con una sesión robada. La cuarta se rechaza y
 * genera una alerta. Si la exportación no se puede registrar en la auditoría,
 * no se entrega.
 */

const { v4: uuidv4 } = require('uuid');
const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created } = require('../../lib/utils/response');
const { conSesion } = require('../../lib/auth/sesion');
const { PersonaService } = require('../../lib/services/PersonaService');
const credenciales = require('../../lib/credenciales');
const cifradoCampo = require('../../lib/cifradoCampo');
const C = require('../../lib/gobernanza/consentimiento');
const D = require('../../lib/gobernanza/derechos');
const auditoria = require('../../lib/gobernanza/auditoria');
const { exportarTitular, consentimientosDe, historialConsentimientosDe, solicitudesDe } = require('./exportar');

const personaService = new PersonaService();
const T = (env) => process.env[env];

const LIMITE_EXPORTACIONES = 3;
const VENTANA_EXPORTACIONES_MS = 24 * 3600000;
const DERECHOS_AUTOSERVICIO = [D.DERECHOS.RECTIFICACION, D.DERECHOS.SUPRESION, D.DERECHOS.OPOSICION, D.DERECHOS.BLOQUEO];
const CANAL = 'Autoservicio: Mis datos y privacidad';

const ESTADO_POR_CODIGO = {
    FINALIDAD_INVALIDA: 404, VERSION_DESACTUALIZADA: 409, YA_OTORGADO: 409, NO_OTORGADO: 409, CANAL_INVALIDO: 400,
    MENOR_DE_EDAD: 403, IDENTIDAD_REQUERIDA: 400, IDENTIDAD_NO_VERIFICADA: 403, DERECHO_INVALIDO: 400,
    SIN_CAMBIOS: 400, CAMPO_NO_RECTIFICABLE: 400, RUT_INVALIDO: 400, FECHA_INVALIDA: 400, NOMBRE_INVALIDO: 400,
    CAMBIO_CONCURRENTE: 409, LIMITE_EXPORTACIONES: 429, AUDITORIA_NO_DISPONIBLE: 503,
};
const fallo = (mensaje, codigo) => Object.assign(new Error(mensaje), { codigo });

const nombreDe = (p) => [p?.nombre, p?.apellidoPaterno || p?.apellido].filter(Boolean).join(' ').trim() || null;
const actorAuditoria = (sesion) => ({ id: sesion.personaId, tipo: 'persona', rol: sesion.rol });

async function transaccion(items) {
    try {
        await docClient.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (err) {
        if (err.name === 'TransactionCanceledException') throw fallo('Tus datos cambiaron mientras se procesaba la operación. Vuelve a intentarlo.', 'CAMBIO_CONCURRENTE');
        throw err;
    }
}
const aHistorial = (eventos) => eventos.map((ev) => ({ Put: { TableName: T('GOBERNANZA_HISTORIAL_TABLE'), Item: ev, ConditionExpression: 'attribute_not_exists(sk)' } }));

// ─── Verificación de identidad ──────────────────────────────────────────────

/**
 * Vuelve a pedir la contraseña. Cada resultado queda en la auditoría; los
 * fallidos alimentan la detección, que cierra las sesiones al tercero.
 */
async function verificarIdentidad(event, sesion, persona, password, motivo, { ahora }) {
    if (!password || typeof password !== 'string') throw fallo('Para continuar, vuelve a escribir tu contraseña.', 'IDENTIDAD_REQUERIDA');
    const { valido } = persona._passwordHash
        ? await credenciales.verificar(password, persona._passwordHash, persona.personaId)
        : { valido: false };
    await auditoria.registrar({
        tenantId: sesion.tenantId,
        operacion: valido ? 'identidad.verificada' : 'identidad.verificacion_fallida',
        resultado: valido ? 'exito' : 'denegado',
        actor: actorAuditoria(sesion),
        titulares: [persona.personaId],
        origen: auditoria.origenDe(event),
        detalle: { motivo },
    }, { ahora });
    if (!valido) throw fallo('La contraseña no es correcta.', 'IDENTIDAD_NO_VERIFICADA');
}

// ─── Consentimientos ────────────────────────────────────────────────────────

const skConsentimiento = (personaId, finalidad) => `CONSENT#${personaId}#${finalidad}`;

async function verConsentimientos(sesion) {
    const [registros, historial] = await Promise.all([
        consentimientosDe(sesion.tenantId, sesion.personaId),
        historialConsentimientosDe(sesion.tenantId, sesion.personaId),
    ]);
    return success({
        finalidades: C.vistaTitular(registros),
        basesSinConsentimiento: C.BASES_SIN_CONSENTIMIENTO,
        historial: historial.map((h) => ({ tipo: h.tipo, en: h.en, finalidad: h.datos?.finalidad, version: h.datos?.version })).sort((a, b) => b.en.localeCompare(a.en)),
    });
}

/**
 * Otorga o revoca. El registro, la copia mínima en la ficha y el evento del
 * historial se escriben en UNA transacción: no puede quedar un consentimiento
 * registrado que el resto del sistema no vea, ni al revés.
 */
async function cambiarConsentimiento(event, sesion, persona, finalidad, body, { ahora }) {
    const tenantId = sesion.tenantId;
    if (!C.finalidad(finalidad)) throw fallo('Finalidad no reconocida', 'FINALIDAD_INVALIDA');
    const sk = skConsentimiento(persona.personaId, finalidad);
    const actual = (await docClient.send(new GetCommand({ TableName: T('GOBERNANZA_TABLE'), Key: { tenantId, sk }, ConsistentRead: true }))).Item || null;

    let nuevo;
    let tipo;
    if (body.accion === 'otorgar') {
        nuevo = C.otorgar(actual, { finalidad, version: body.version, canal: body.canal || 'web' }, persona, { ahora });
        tipo = C.EVENTOS.OTORGADO;
    } else if (body.accion === 'revocar') {
        nuevo = C.revocar(actual, { canal: body.canal || 'web' }, { ahora });
        tipo = C.EVENTOS.REVOCADO;
    } else {
        return error('Indica si otorgas o revocas', 400);
    }

    // Copia mínima en la ficha: las marcas de las demás finalidades quedan
    // intactas; las de esta se reemplazan.
    const otras = (persona.consentimientos || []).filter((m) => !m.startsWith(`${finalidad}@`));
    const marcas = nuevo.estado === C.ESTADOS.OTORGADO ? [...otras, C.marca(finalidad, nuevo.version)] : otras;
    const fichaUpdate = marcas.length
        ? { UpdateExpression: 'SET consentimientos = :m, updatedAt = :ahora', ExpressionAttributeValues: { ':m': new Set(marcas), ':ahora': ahora.toISOString() } }
        : { UpdateExpression: 'REMOVE consentimientos SET updatedAt = :ahora', ExpressionAttributeValues: { ':ahora': ahora.toISOString() } };

    await transaccion([
        {
            Put: {
                TableName: T('GOBERNANZA_TABLE'),
                Item: { tenantId, sk, ...nuevo },
                // Nadie cambió el registro desde que se leyó.
                ConditionExpression: actual ? 'actualizadoEl = :previo' : 'attribute_not_exists(sk)',
                ...(actual ? { ExpressionAttributeValues: { ':previo': actual.actualizadoEl } } : {}),
            },
        },
        {
            Update: {
                TableName: T('PERSONAS_TABLE'), Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${persona.personaId}` },
                ConditionExpression: 'attribute_exists(PK)', ...fichaUpdate,
            },
        },
        ...aHistorial([C.evento(tenantId, persona.personaId, tipo, {
            finalidad, version: nuevo.version, canal: body.canal || 'web', ...(nuevo.versionAnterior ? { versionAnterior: nuevo.versionAnterior } : {}),
        }, { ahora })]),
    ]);

    await auditoria.registrar({
        tenantId, operacion: tipo === C.EVENTOS.OTORGADO ? 'consentimiento.otorgado' : 'consentimiento.revocado',
        actor: actorAuditoria(sesion), recurso: { tipo: 'consentimiento', id: finalidad }, titulares: [persona.personaId],
        origen: auditoria.origenDe(event), detalle: { finalidad, version: nuevo.version },
    }, { ahora });

    return success(C.vistaTitular([...(await consentimientosDe(tenantId, persona.personaId))]).find((f) => f.finalidad === finalidad));
}

// ─── Exportación ────────────────────────────────────────────────────────────

async function exportar(event, sesion, persona, body, { ahora }) {
    await verificarIdentidad(event, sesion, persona, body.password, 'exportacion', { ahora });

    // Límite diario, contado desde la propia auditoría (índice por actor).
    const recientes = await auditoria.recientesDe(sesion.personaId);
    const desde = ahora.getTime() - VENTANA_EXPORTACIONES_MS;
    const hechas = recientes.filter((e) => e.operacion === 'derechos.exportacion' && new Date(e.en).getTime() >= desde).length;
    if (hechas >= LIMITE_EXPORTACIONES) {
        await auditoria.registrar({
            tenantId: sesion.tenantId, operacion: 'derechos.exportacion_rechazada', resultado: 'denegado',
            actor: actorAuditoria(sesion), titulares: [persona.personaId], origen: auditoria.origenDe(event),
            detalle: { hechas, limite: LIMITE_EXPORTACIONES },
        }, { ahora });
        throw fallo(`Ya descargaste tus datos ${hechas} veces en las últimas 24 horas. Vuelve a intentarlo mañana.`, 'LIMITE_EXPORTACIONES');
    }

    const documento = await exportarTitular(sesion.tenantId, persona, { ahora });

    // El ejercicio del derecho queda registrado como una solicitud de
    // portabilidad ya verificada, respondida y ejecutada: aparece en "Mis
    // solicitudes" y en el panel de la empresa, con su historial.
    const solicitudId = uuidv4();
    const actor = { personaId: persona.personaId, nombre: nombreDe(persona) };
    const s = D.nuevaSolicitud({ personaId: persona.personaId, derecho: D.DERECHOS.PORTABILIDAD, canal: CANAL, recibidaEl: ahora.toISOString(), detalle: 'Descarga de una copia de sus datos.' }, actor, { ahora, solicitudId });
    s.verificacion = D.verificar(s, { metodo: 'sesion_y_contrasena' }, actor, { ahora });
    s.respuesta = D.responder(s, { resultado: D.RESULTADOS.ACOGIDA, fundamento: 'Se entregó una copia de los datos en formato JSON estructurado al titular, en el acto.', medio: 'Descarga desde la plataforma' }, actor, { ahora });
    s.estado = D.ESTADOS.RESUELTA;
    s.ejecucion = { en: ahora.toISOString(), por: actor, detalle: { formato: documento.formato, version: documento.version } };

    // Primero la auditoría, estricta: sin registro, no hay entrega.
    await auditoria.registrar({
        tenantId: sesion.tenantId, operacion: 'derechos.exportacion', actor: actorAuditoria(sesion),
        recurso: { tipo: 'solicitud', id: solicitudId }, titulares: [persona.personaId], origen: auditoria.origenDe(event),
        detalle: { secciones: Object.keys(documento.secciones).length, formato: documento.formato },
    }, { estricto: true, ahora });

    await transaccion([
        { Put: { TableName: T('GOBERNANZA_TABLE'), Item: { tenantId: sesion.tenantId, sk: `SOLICITUD#${solicitudId}`, ...s }, ConditionExpression: 'attribute_not_exists(sk)' } },
        ...aHistorial([
            D.evento(sesion.tenantId, solicitudId, D.EVENTOS.SOLICITUD, { personaId: s.personaId, derecho: s.derecho, canal: s.canal, recibidaEl: s.recibidaEl, registradaEl: s.registradaEl, venceEl: s.venceEl }, actor, { ahora, n: 0 }),
            D.evento(sesion.tenantId, solicitudId, D.EVENTOS.VERIFICACION, { metodo: s.verificacion.metodo }, actor, { ahora, n: 1 }),
            D.evento(sesion.tenantId, solicitudId, D.EVENTOS.RESPUESTA, { resultado: s.respuesta.resultado, dentroDePlazo: true }, actor, { ahora, n: 2 }),
            D.evento(sesion.tenantId, solicitudId, D.EVENTOS.EJECUCION, { formato: documento.formato }, actor, { ahora, n: 3 }),
        ]),
    ]);
    return success(documento);
}

// ─── Solicitudes ────────────────────────────────────────────────────────────

/** Lo que ve el titular de sus solicitudes: estado y decisión, sin datos internos. */
const vistaSolicitud = (s) => ({
    solicitudId: s.solicitudId,
    derecho: s.derecho,
    canal: s.canal,
    recibidaEl: s.recibidaEl,
    plazoVigente: D.plazoVigente(s).toISOString(),
    etapa: D.etapaDe(s),
    estado: s.estado,
    camposPedidos: s.camposPedidos || null,
    verificadaEl: s.verificacion?.verificadaEl || null,
    respuesta: s.respuesta ? { resultado: s.respuesta.resultado, fundamento: s.respuesta.fundamento, respondidaEl: s.respuesta.respondidaEl } : null,
    ejecutadaEl: s.ejecucion?.en || null,
});

async function misSolicitudes(sesion) {
    const lista = await solicitudesDe(sesion.tenantId, sesion.personaId);
    return success({ solicitudes: lista.map(vistaSolicitud).sort((a, b) => b.recibidaEl.localeCompare(a.recibidaEl)) });
}

async function nuevaSolicitud(event, sesion, persona, body, { ahora, config }) {
    if (!DERECHOS_AUTOSERVICIO.includes(body.derecho)) {
        throw fallo('Desde aquí puedes pedir rectificación, supresión, oposición o bloqueo. Para una copia de tus datos usa "Descargar mis datos".', 'DERECHO_INVALIDO');
    }
    // Las reglas se validan ANTES de pedir la contraseña: un error de forma no
    // debe contar como intento fallido de identidad.
    const cambios = body.derecho === D.DERECHOS.RECTIFICACION ? D.validarCambios(body.cambios, persona, { ahora }) : null;
    await verificarIdentidad(event, sesion, persona, body.password, `solicitud_${body.derecho}`, { ahora });

    const solicitudId = uuidv4();
    const actor = { personaId: persona.personaId, nombre: nombreDe(persona) };
    const s = D.nuevaSolicitud({ personaId: persona.personaId, derecho: body.derecho, canal: CANAL, recibidaEl: ahora.toISOString(), detalle: body.detalle }, actor, { ahora, config, solicitudId });
    s.verificacion = D.verificar(s, { metodo: 'sesion_y_contrasena' }, actor, { ahora });
    if (cambios) {
        // Los valores propuestos son datos personales: viajan cifrados y se
        // borran de la solicitud al resolverla. El historial guarda solo QUÉ
        // campos se pidieron.
        s.camposPedidos = Object.keys(cambios).sort();
        s.cambiosCifrados = await cifradoCampo.cifrarSobre(cambios);
    }

    const { persistirSolicitud } = require('./derechos')._interno;
    await persistirSolicitud(sesion.tenantId, s, actor, { ahora });
    await auditoria.registrar({
        tenantId: sesion.tenantId, operacion: 'derechos.solicitud', actor: actorAuditoria(sesion),
        recurso: { tipo: 'solicitud', id: solicitudId }, titulares: [persona.personaId], origen: auditoria.origenDe(event),
        detalle: { derecho: s.derecho, campos: s.camposPedidos || [], canal: 'autoservicio' },
    }, { ahora });
    return created(vistaSolicitud(s));
}

// ─── Ruteo ──────────────────────────────────────────────────────────────────

module.exports.atender = async (event, { ahora = new Date(), config = D.configDesdeEntorno() } = {}) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const ses = conSesion(event);
    if (!ses.ok) return ses.respuesta;
    const sesion = ses.sesion;
    const [, recurso, id] = (event.rawPath || '').replace(/^\/gobernanza\/?/, '').split('/').filter(Boolean);

    let body = {};
    if (method === 'POST') {
        try { body = JSON.parse(event.body || '{}'); } catch { return error('Cuerpo inválido', 400); }
    }

    try {
        // La persona sale de la sesión, y tiene que ser de la empresa de la sesión.
        const persona = await personaService.getById(sesion.personaId);
        if (!persona || persona.tenantId !== sesion.tenantId) return error('No se encontró tu ficha', 404);

        if (recurso === 'consentimientos' && method === 'GET' && !id) return await verConsentimientos(sesion);
        if (recurso === 'consentimientos' && method === 'POST' && id) return await cambiarConsentimiento(event, sesion, persona, id, body, { ahora });
        if (recurso === 'exportacion' && method === 'POST' && !id) return await exportar(event, sesion, persona, body, { ahora });
        if (recurso === 'solicitudes' && method === 'GET' && !id) return await misSolicitudes(sesion);
        if (recurso === 'solicitudes' && method === 'POST' && !id) return await nuevaSolicitud(event, sesion, persona, body, { ahora, config });
        return error('Ruta no encontrada', 404);
    } catch (err) {
        const estado = ESTADO_POR_CODIGO[err.codigo];
        if (estado) return error(err.message, estado);
        throw err;
    }
};

module.exports._interno = { LIMITE_EXPORTACIONES, verificarIdentidad };
