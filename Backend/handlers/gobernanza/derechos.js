/**
 * Derechos del titular (Ley 21.719): la herramienta con que la constructora
 * —responsable del tratamiento— registra y responde las solicitudes de sus
 * trabajadores. Las reglas están en `lib/gobernanza/derechos.js`.
 *
 *   POST /gobernanza/solicitudes                    registrar (y bloquear si corresponde)
 *   GET  /gobernanza/solicitudes                    listar, con plazo vigente y alertas
 *   GET  /gobernanza/solicitudes/{id}               detalle con su historial
 *   POST /gobernanza/solicitudes/{id}/verificacion  registrar cómo se verificó la identidad
 *   POST /gobernanza/solicitudes/{id}/prorroga      registrar la prórroga (solo a tiempo)
 *   POST /gobernanza/solicitudes/{id}/exportacion   entregar la copia de una solicitud de acceso o portabilidad
 *   POST /gobernanza/solicitudes/{id}/respuesta     responder y cerrar (una rectificación acogida se aplica acá)
 *
 * La misma función atiende también, por prefijo, el autoservicio del titular
 * (`/gobernanza/mis-datos/...`, ver `titular.js`) y la consulta de la
 * auditoría (`/gobernanza/auditoria`, ver `auditoria.js`): agruparlas evita
 * sumar funciones al stack, que está cerca del límite de 500 recursos (D-16).
 *
 * ── Cada cambio es UNA transacción ──────────────────────────────────────────
 * La solicitud, el bloqueo de la persona y los eventos del historial se
 * escriben juntos: no puede quedar una solicitud sin su registro en el
 * historial, ni un bloqueo sin la solicitud que lo causa, ni un "bloqueo
 * aplicado" que en realidad no se aplicó.
 *
 * ── Lo inmutable ────────────────────────────────────────────────────────────
 * La fecha de recepción (y el vencimiento que se calcula de ella) se escriben
 * al crear y ninguna actualización los toca: todas las actualizaciones de este
 * archivo están en `ACTUALIZACIONES`, y una prueba verifica que ninguna los
 * nombre. Además el evento `solicitud` del historial —que nadie puede editar—
 * guarda la fecha original.
 *
 * Todo exige el permiso `empresa.derechos_titulares`, y el titular tiene que
 * ser de la empresa de la sesión.
 */

const { v4: uuidv4 } = require('uuid');
const { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created, cors } = require('../../lib/utils/response');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { PERMISSIONS } = require('../../lib/permissions');
const { PersonaService } = require('../../lib/services/PersonaService');
const D = require('../../lib/gobernanza/derechos');
const auditoria = require('../../lib/gobernanza/auditoria');
const cifradoCampo = require('../../lib/cifradoCampo');
const { llaveDeTenant, PROPOSITOS } = require('../../lib/llaveTenant');
const { registrarFallo } = require('../../lib/degradacion');

const personaService = new PersonaService();
const TABLA = () => process.env.GOBERNANZA_TABLE;
const HISTORIAL = () => process.env.GOBERNANZA_HISTORIAL_TABLE;
const PERSONAS = () => process.env.PERSONAS_TABLE;

const skSolicitud = (id) => `SOLICITUD#${id}`;

/**
 * Todas las actualizaciones de una solicitud. Ninguna nombra `recibidaEl`,
 * `registradaEl` ni `venceEl`: son inmutables (tests/derechos-api.test.js).
 */
const ACTUALIZACIONES = {
    verificacion: 'SET verificacion = :v, actualizadaEl = :ahora',
    prorroga: 'SET prorroga = :p, actualizadaEl = :ahora',
    respuesta: 'SET respuesta = :r, estado = :resuelta, actualizadaEl = :ahora',
    // Una rectificación acogida se aplica en la misma escritura que la
    // respuesta, y los valores propuestos dejan de existir en la solicitud.
    respuestaRectificacion: 'SET respuesta = :r, estado = :resuelta, ejecucion = :e, actualizadaEl = :ahora REMOVE cambiosCifrados',
    // Rechazada: tampoco se conservan los valores propuestos.
    respuestaSinCambios: 'SET respuesta = :r, estado = :resuelta, actualizadaEl = :ahora REMOVE cambiosCifrados',
    exportacion: 'SET ejecucion = :e, actualizadaEl = :ahora',
};

/** Estado HTTP de cada rechazo de las reglas. */
const ESTADO_POR_CODIGO = {
    SIN_TITULAR: 400, DERECHO_INVALIDO: 400, CANAL_REQUERIDO: 400, RECEPCION_REQUERIDA: 400, RECEPCION_FUTURA: 400,
    PRORROGA_SIN_FECHA: 400, PRORROGA_FUTURA: 400, PRORROGA_INVALIDA: 400, MOTIVO_REQUERIDO: 400,
    RESULTADO_INVALIDO: 400, FUNDAMENTO_REQUERIDO: 400,
    METODO_INVALIDO: 400, OBSERVACION_REQUERIDA: 400, OBSERVACION_CON_DOCUMENTO: 400, CAMPOS_ACEPTADOS: 400,
    SIN_CAMBIOS: 400, CAMPO_NO_RECTIFICABLE: 400, RUT_INVALIDO: 400, FECHA_INVALIDA: 400, NOMBRE_INVALIDO: 400,
    PRORROGA_TARDIA: 409, PRORROGA_USADA: 409, SOLICITUD_CERRADA: 409, CAMBIO_CONCURRENTE: 409,
    YA_VERIFICADA: 409, SIN_VERIFICACION: 409, RUT_DUPLICADO: 409, NO_EXPORTABLE: 409,
    AUDITORIA_NO_DISPONIBLE: 503,
};
const fallo = (mensaje, codigo) => Object.assign(new Error(mensaje), { codigo });
const actorAuditoria = (sesion) => ({ id: sesion.personaId, tipo: 'persona', rol: sesion.rol });

const nombreDe = (p) => [p?.nombre, p?.apellidoPaterno || p?.apellido].filter(Boolean).join(' ').trim() || null;

/** Eventos del historial como operaciones de la transacción: solo se agregan. */
const aHistorial = (eventos) => eventos.map((ev) => ({
    Put: { TableName: HISTORIAL(), Item: ev, ConditionExpression: 'attribute_not_exists(sk)' },
}));

/** Lo que el historial guarda de una solicitud: fechas y decisión, no el detalle. */
const resumenSolicitud = (s) => ({
    personaId: s.personaId, derecho: s.derecho, canal: s.canal,
    recibidaEl: s.recibidaEl, registradaEl: s.registradaEl, venceEl: s.venceEl,
});

async function obtener(tenantId, solicitudId) {
    const r = await docClient.send(new GetCommand({ TableName: TABLA(), Key: { tenantId, sk: skSolicitud(solicitudId) }, ConsistentRead: true }));
    return r.Item || null;
}

async function historialDe(tenantId, solicitudId) {
    const items = [];
    let desde;
    do {
        const r = await docClient.send(new QueryCommand({
            TableName: HISTORIAL(), KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
            ExpressionAttributeValues: { ':t': tenantId, ':p': `HIST#${solicitudId}#` }, ExclusiveStartKey: desde,
        }));
        items.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);
    return items;
}

/** Lo que ve quien gestiona: plazo, alertas y etapa; nunca el sobre cifrado. */
const conPlazo = (s, ahora, config) => {
    const { cambiosCifrados, ...resto } = s;
    return { ...resto, plazoVigente: D.plazoVigente(s).toISOString(), alertas: D.alertasDe(s, { ahora, config }), etapa: D.etapaDe(s) };
};

async function transaccion(items) {
    try {
        await docClient.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (err) {
        if (err.name === 'TransactionCanceledException') {
            throw Object.assign(new Error('La solicitud cambió mientras se procesaba. Revisa su estado y vuelve a intentar.'), { codigo: 'CAMBIO_CONCURRENTE' });
        }
        throw err;
    }
}

// ─── Operaciones ────────────────────────────────────────────────────────────

/**
 * Escribe una solicitud nueva con su bloqueo (si corresponde) y sus eventos, en
 * una transacción. La usan el registro de quien gestiona y el autoservicio del
 * titular (`titular.js`).
 */
async function persistirSolicitud(tenantId, s, actor, { ahora }) {
    const solicitudId = s.solicitudId;
    const eventos = [D.evento(tenantId, solicitudId, D.EVENTOS.SOLICITUD, resumenSolicitud(s), actor, { ahora, n: 0 })];
    const items = [];
    if (s.verificacion) {
        eventos.push(D.evento(tenantId, solicitudId, D.EVENTOS.VERIFICACION, { metodo: s.verificacion.metodo }, actor, { ahora, n: 2 }));
    }

    if (s.bloqueo.exigido) {
        // El bloqueo se aplica en la misma escritura que registra la solicitud:
        // "aplicado" solo si de verdad quedó aplicado.
        s.bloqueo.aplicadoEl = ahora.toISOString();
        items.push({
            Update: {
                TableName: PERSONAS(),
                Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${s.personaId}` },
                UpdateExpression: 'ADD solicitudesBloqueo :s SET updatedAt = :ahora',
                ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeValues: { ':s': new Set([solicitudId]), ':ahora': ahora.toISOString() },
            },
        });
        eventos.push(D.evento(tenantId, solicitudId, D.EVENTOS.BLOQUEO,
            { personaId: s.personaId, plazoHasta: s.bloqueo.plazoHasta, aplicadoEl: s.bloqueo.aplicadoEl }, actor, { ahora, n: 1 }));
    }

    items.unshift({ Put: { TableName: TABLA(), Item: { tenantId, sk: skSolicitud(solicitudId), ...s }, ConditionExpression: 'attribute_not_exists(sk)' } });
    await transaccion([...items, ...aHistorial(eventos)]);
    return s;
}

async function registrar(event, sesion, body, actor, { ahora, config }) {
    const tenantId = sesion.tenantId;
    const titular = body.personaId ? await personaService.getById(body.personaId) : null;
    if (!titular || titular.tenantId !== tenantId) return error('La persona no es de esta empresa', 404);

    const s = D.nuevaSolicitud(body, actor, { ahora, config, solicitudId: uuidv4() });
    // La identidad se puede verificar al registrar (se presentó con su cédula)
    // o después, con su propia ruta.
    if (body.verificacion) s.verificacion = D.verificar(s, body.verificacion, actor, { ahora });
    await persistirSolicitud(tenantId, s, actor, { ahora });
    await auditoria.registrar({
        tenantId, operacion: 'derechos.solicitud', actor: actorAuditoria(sesion), recurso: { tipo: 'solicitud', id: s.solicitudId },
        titulares: [s.personaId], origen: auditoria.origenDe(event), detalle: { derecho: s.derecho, canal: 'registrada_por_la_empresa', verificada: Boolean(s.verificacion) },
    }, { ahora });
    return created(conPlazo(s, ahora, config));
}

async function verificarSolicitud(event, sesion, solicitudId, body, actor, { ahora, config }) {
    const tenantId = sesion.tenantId;
    const s = await obtener(tenantId, solicitudId);
    if (!s) return error('Solicitud no encontrada', 404);
    const v = D.verificar(s, body, actor, { ahora });
    await transaccion([
        {
            Update: {
                TableName: TABLA(), Key: { tenantId, sk: skSolicitud(solicitudId) },
                UpdateExpression: ACTUALIZACIONES.verificacion,
                ConditionExpression: 'estado = :abierta AND (attribute_not_exists(verificacion) OR verificacion = :nulo)',
                ExpressionAttributeValues: { ':v': v, ':ahora': ahora.toISOString(), ':abierta': D.ESTADOS.ABIERTA, ':nulo': null },
            },
        },
        ...aHistorial([D.evento(tenantId, solicitudId, D.EVENTOS.VERIFICACION, { metodo: v.metodo }, actor, { ahora })]),
    ]);
    await auditoria.registrar({
        tenantId, operacion: 'derechos.verificacion', actor: actorAuditoria(sesion), recurso: { tipo: 'solicitud', id: solicitudId },
        titulares: [s.personaId], origen: auditoria.origenDe(event), detalle: { metodo: v.metodo },
    }, { ahora });
    return success(conPlazo({ ...s, verificacion: v }, ahora, config));
}

// ─── Rectificación ──────────────────────────────────────────────────────────

/**
 * Qué escribir en la ficha para aplicar los cambios aceptados. Valida de nuevo
 * contra la ficha ACTUAL (pudo cambiar desde que se pidió) y, si cambia el RUT,
 * que no lo tenga otra persona de la empresa. No conserva los valores
 * anteriores: el sentido de rectificar es que el dato inexacto deje de
 * tratarse. Lo que queda es qué campos cambiaron, quién y cuándo.
 */
async function preparaRectificacion(tenantId, s, camposAceptados, { ahora }) {
    const propuestos = s.cambiosCifrados ? await cifradoCampo.descifrarSobre(s.cambiosCifrados) : null;
    if (!propuestos) throw fallo('La solicitud no trae los datos a corregir: hay que pedirle al titular que la presente de nuevo.', 'SIN_CAMBIOS');
    const aceptados = Array.isArray(camposAceptados) && camposAceptados.length ? camposAceptados : Object.keys(propuestos);
    if (aceptados.some((c) => !(c in propuestos))) throw fallo('Solo se pueden aceptar campos que el titular pidió corregir.', 'CAMPOS_ACEPTADOS');

    const persona = await personaService.getById(s.personaId);
    if (!persona || persona.tenantId !== tenantId) throw fallo('La persona no es de esta empresa', 'SIN_CAMBIOS');
    const cambios = D.validarCambios(Object.fromEntries(aceptados.map((c) => [c, propuestos[c]])), persona, { ahora });

    const sets = [];
    const valores = { ':ahora': ahora.toISOString() };
    const nombres = {};
    let rut = null;
    for (const [campo, valor] of Object.entries(cambios)) {
        if (campo === 'rut') {
            const otro = await personaService.getByRut(tenantId, valor);
            if (otro && otro.personaId !== persona.personaId) throw fallo('Ese RUT ya pertenece a otra persona de la empresa.', 'RUT_DUPLICADO');
            const llaveRut = await llaveDeTenant(tenantId, PROPOSITOS.RUT_PERSONAS);
            rut = { anteriorHmac: persona._rutHmac, nuevoHmac: await cifradoCampo.hmacRut(valor) };
            sets.push('rutCifrado = :rutCifrado', 'rutHmac = :rutHmac');
            valores[':rutCifrado'] = cifradoCampo.cifrarConLlaveDatos(valor, llaveRut);
            valores[':rutHmac'] = rut.nuevoHmac;
        } else {
            sets.push(`#${campo} = :${campo}`);
            nombres[`#${campo}`] = campo;
            valores[`:${campo}`] = valor;
        }
    }
    if ('apellidoPaterno' in cambios || 'apellidoMaterno' in cambios) {
        const pat = cambios.apellidoPaterno ?? persona.apellidoPaterno;
        const mat = cambios.apellidoMaterno ?? persona.apellidoMaterno;
        sets.push('#apellido = :apellido');
        nombres['#apellido'] = 'apellido';
        valores[':apellido'] = [pat, mat].filter(Boolean).join(' ');
    }
    sets.push('updatedAt = :ahora');
    return {
        campos: Object.keys(cambios).sort(),
        rut,
        op: {
            Update: {
                TableName: PERSONAS(), Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${persona.personaId}` },
                UpdateExpression: `SET ${sets.join(', ')}`, ConditionExpression: 'attribute_exists(PK)',
                ...(Object.keys(nombres).length ? { ExpressionAttributeNames: nombres } : {}),
                ExpressionAttributeValues: valores,
            },
        },
    };
}

/**
 * Otros módulos que dependen del dato rectificado. El incidente se vincula a la
 * persona afectada por el HMAC de su RUT: si el RUT cambia, se actualiza el
 * vínculo para que la retención y la supresión lo sigan encontrando. Los
 * nombres copiados en actas y documentos ya firmados NO se reescriben: son la
 * prueba de lo que se firmó (y su huella dejaría de calzar). Los listados y
 * todo tratamiento nuevo leen la ficha, que ya quedó corregida.
 */
async function propagarRectificacion(tenantId, rut) {
    if (!rut?.anteriorHmac || rut.anteriorHmac === rut.nuevoHmac) return { incidentesRevinculados: 0 };
    const { LECTURA, consultarTodo, completos } = require('./retencion')._interno;
    const claves = await consultarTodo({ TableName: process.env.INCIDENTS_TABLE, ...LECTURA.INCIDENTS_TABLE(tenantId) });
    const incidentes = (await completos('INCIDENTS_TABLE', claves)).filter((i) => i.afectadoRutHmac === rut.anteriorHmac);
    for (const i of incidentes) {
        await docClient.send(new UpdateCommand({
            TableName: process.env.INCIDENTS_TABLE, Key: { incidentId: i.incidentId },
            UpdateExpression: 'SET afectadoRutHmac = :n', ConditionExpression: 'afectadoRutHmac = :a',
            ExpressionAttributeValues: { ':n': rut.nuevoHmac, ':a': rut.anteriorHmac },
        }));
    }
    return { incidentesRevinculados: incidentes.length };
}

async function prorrogar(event, sesion, solicitudId, body, actor, { ahora, config }) {
    const tenantId = sesion.tenantId;
    const s = await obtener(tenantId, solicitudId);
    if (!s) return error('Solicitud no encontrada', 404);
    const p = D.prorrogar(s, body, actor, { ahora, config });
    await transaccion([
        {
            Update: {
                TableName: TABLA(), Key: { tenantId, sk: skSolicitud(solicitudId) },
                UpdateExpression: ACTUALIZACIONES.prorroga,
                // Sigue abierta, sin prórroga, y el primer plazo no ha vencido
                // AHORA (no cuando se leyó): la regla se repite en la escritura.
                ConditionExpression: 'estado = :abierta AND (attribute_not_exists(prorroga) OR prorroga = :nulo) AND venceEl >= :ahora',
                ExpressionAttributeValues: { ':p': p, ':ahora': ahora.toISOString(), ':abierta': D.ESTADOS.ABIERTA, ':nulo': null },
            },
        },
        ...aHistorial([D.evento(tenantId, solicitudId, D.EVENTOS.PRORROGA,
            { comunicadaEl: p.comunicadaEl, medio: p.medio, motivo: p.motivo, venceEl: p.venceEl, venceElOriginal: s.venceEl }, actor, { ahora })]),
    ]);
    await auditoria.registrar({
        tenantId, operacion: 'derechos.prorroga', actor: actorAuditoria(sesion), recurso: { tipo: 'solicitud', id: solicitudId },
        titulares: [s.personaId], origen: auditoria.origenDe(event), detalle: { derecho: s.derecho },
    }, { ahora });
    return success(conPlazo({ ...s, prorroga: p }, ahora, config));
}

async function responder(event, sesion, solicitudId, body, actor, { ahora, config }) {
    const tenantId = sesion.tenantId;
    const s = await obtener(tenantId, solicitudId);
    if (!s) return error('Solicitud no encontrada', 404);
    const r = D.responder(s, body, actor, { ahora });
    const eventos = [D.evento(tenantId, solicitudId, D.EVENTOS.RESPUESTA,
        { resultado: r.resultado, fundamento: r.fundamento, medio: r.medio, dentroDePlazo: r.dentroDePlazo, plazoVigente: D.plazoVigente(s).toISOString() },
        actor, { ahora, n: 0 })];

    // Una rectificación acogida se aplica en la MISMA transacción que la
    // respuesta: no puede quedar "acogida" sin aplicar, ni aplicada sin respuesta.
    const rectifica = s.derecho === D.DERECHOS.RECTIFICACION && r.resultado !== D.RESULTADOS.RECHAZADA;
    const rect = rectifica ? await preparaRectificacion(tenantId, s, body.camposAceptados, { ahora }) : null;
    const ejecucion = rect ? { en: ahora.toISOString(), por: actor, detalle: { campos: rect.campos } } : null;
    if (rect) eventos.push(D.evento(tenantId, solicitudId, D.EVENTOS.EJECUCION, { campos: rect.campos }, actor, { ahora, n: 2 }));

    const expresion = rect ? ACTUALIZACIONES.respuestaRectificacion
        : (s.derecho === D.DERECHOS.RECTIFICACION ? ACTUALIZACIONES.respuestaSinCambios : ACTUALIZACIONES.respuesta);
    const items = [{
        Update: {
            TableName: TABLA(), Key: { tenantId, sk: skSolicitud(solicitudId) },
            UpdateExpression: expresion,
            ConditionExpression: 'estado = :abierta',
            ExpressionAttributeValues: {
                ':r': r, ':resuelta': D.ESTADOS.RESUELTA, ':abierta': D.ESTADOS.ABIERTA, ':ahora': ahora.toISOString(),
                ...(rect ? { ':e': ejecucion } : {}),
            },
        },
    }];
    if (rect) items.push(rect.op);

    // Una supresión acogida mantiene el bloqueo hasta que se ejecute (lote con
    // aprobación de dos personas). El resto lo levanta al responder.
    const suprimir = s.derecho === D.DERECHOS.SUPRESION && r.resultado !== D.RESULTADOS.RECHAZADA;
    if (s.bloqueo?.exigido && s.bloqueo.aplicadoEl && !suprimir) {
        items.push({
            Update: {
                TableName: PERSONAS(),
                Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${s.personaId}` },
                UpdateExpression: 'DELETE solicitudesBloqueo :s SET updatedAt = :ahora',
                ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeValues: { ':s': new Set([solicitudId]), ':ahora': ahora.toISOString() },
            },
        });
        eventos.push(D.evento(tenantId, solicitudId, D.EVENTOS.DESBLOQUEO, { personaId: s.personaId }, actor, { ahora, n: 1 }));
    }
    await transaccion([...items, ...aHistorial(eventos)]);
    await auditoria.registrar({
        tenantId, operacion: 'derechos.respuesta', actor: actorAuditoria(sesion), recurso: { tipo: 'solicitud', id: solicitudId },
        titulares: [s.personaId], origen: auditoria.origenDe(event), detalle: { derecho: s.derecho, resultado: r.resultado },
    }, { ahora });

    let propagacion = null;
    if (rect) {
        try {
            propagacion = await propagarRectificacion(tenantId, rect.rut);
        } catch (err) {
            // La ficha ya quedó corregida; lo que falló es actualizar el vínculo
            // en otros módulos. Se mide y queda en el historial para repetirlo.
            registrarFallo('derechos.propagar_rectificacion', err, { solicitudId });
            propagacion = { error: true };
        }
        await docClient.send(new TransactWriteCommand({ TransactItems: aHistorial([
            D.evento(tenantId, solicitudId, D.EVENTOS.EJECUCION, { propagacion }, actor, { ahora, n: 3 }),
        ]) })).catch((err) => registrarFallo('derechos.historial_propagacion', err, { solicitudId }));
        await auditoria.registrar({
            tenantId, operacion: 'derechos.rectificacion_aplicada', actor: actorAuditoria(sesion), recurso: { tipo: 'solicitud', id: solicitudId },
            titulares: [s.personaId], origen: auditoria.origenDe(event), detalle: { campos: rect.campos, ...(propagacion || {}) },
        }, { ahora });
    }
    const { cambiosCifrados, ...sinSobre } = s;
    return success(conPlazo({ ...sinSobre, respuesta: r, estado: D.ESTADOS.RESUELTA, ...(ejecucion ? { ejecucion } : {}), ...(propagacion ? { propagacion } : {}) }, ahora, config));
}

/**
 * Copia de los datos para una solicitud de acceso o portabilidad que llegó por
 * otro canal. Solo con la identidad verificada. Queda la ejecución en la
 * solicitud y en el historial; la auditoría es estricta (sin registro, no hay
 * entrega). Después, quien gestiona responde la solicitud como siempre.
 */
async function exportarParaSolicitud(event, sesion, solicitudId, actor, { ahora }) {
    const tenantId = sesion.tenantId;
    const s = await obtener(tenantId, solicitudId);
    if (!s) return error('Solicitud no encontrada', 404);
    if (![D.DERECHOS.ACCESO, D.DERECHOS.PORTABILIDAD].includes(s.derecho)) throw fallo('Solo una solicitud de acceso o portabilidad entrega una copia de los datos.', 'NO_EXPORTABLE');
    if (s.estado !== D.ESTADOS.ABIERTA) throw fallo('La solicitud ya está resuelta.', 'SOLICITUD_CERRADA');
    if (!s.verificacion) throw fallo('Antes de entregar los datos hay que registrar cómo se verificó la identidad del titular.', 'SIN_VERIFICACION');
    const titular = await personaService.getById(s.personaId);
    if (!titular || titular.tenantId !== tenantId) return error('La persona no es de esta empresa', 404);

    const { exportarTitular } = require('./exportar');
    const documento = await exportarTitular(tenantId, titular, { ahora });
    await auditoria.registrar({
        tenantId, operacion: 'derechos.exportacion', actor: actorAuditoria(sesion), recurso: { tipo: 'solicitud', id: solicitudId },
        titulares: [s.personaId], origen: auditoria.origenDe(event), detalle: { formato: documento.formato, canal: 'registrada_por_la_empresa' },
    }, { estricto: true, ahora });
    const ejecucion = { en: ahora.toISOString(), por: actor, detalle: { formato: documento.formato } };
    await transaccion([
        {
            Update: {
                TableName: TABLA(), Key: { tenantId, sk: skSolicitud(solicitudId) }, UpdateExpression: ACTUALIZACIONES.exportacion,
                ConditionExpression: 'estado = :abierta', ExpressionAttributeValues: { ':e': ejecucion, ':ahora': ahora.toISOString(), ':abierta': D.ESTADOS.ABIERTA },
            },
        },
        ...aHistorial([D.evento(tenantId, solicitudId, D.EVENTOS.EJECUCION, { formato: documento.formato }, actor, { ahora })]),
    ]);
    return success(documento);
}

async function listar(tenantId, query, { ahora, config }) {
    const items = [];
    let desde;
    do {
        const r = await docClient.send(new QueryCommand({
            TableName: TABLA(), KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
            ExpressionAttributeValues: { ':t': tenantId, ':p': 'SOLICITUD#' }, ExclusiveStartKey: desde,
        }));
        items.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);
    const filtradas = query.estado ? items.filter((s) => s.estado === query.estado) : items;
    const ordenadas = filtradas.map((s) => conPlazo(s, ahora, config)).sort((a, b) => a.plazoVigente.localeCompare(b.plazoVigente));
    return success({ solicitudes: ordenadas, total: ordenadas.length });
}

// ─── Ruteo ──────────────────────────────────────────────────────────────────

module.exports.atender = async (event, { ahora = new Date(), config = D.configDesdeEntorno() } = {}) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    if (method === 'OPTIONS') return cors();
    const ruta = event.rawPath || event.path || '';
    // Autoservicio del titular y auditoría: sus propias reglas de acceso.
    if (/^\/gobernanza\/mis-datos(\/|$)/.test(ruta)) return require('./titular').atender(event, { ahora, config });
    if (/^\/gobernanza\/auditoria(\/|$)/.test(ruta)) return require('./auditoria').atender(event, { ahora });
    const ses = conSesion(event);
    if (!ses.ok) return ses.respuesta;
    const sesion = ses.sesion;
    if (!sesionPuede(sesion, PERMISSIONS.EMPRESA_DERECHOS_TITULARES)) {
        return error('No tienes permiso para gestionar las solicitudes de los titulares', 403);
    }
    const tenantId = sesion.tenantId;
    const partes = (event.rawPath || event.path || '').replace(/^\/gobernanza\/?/, '').split('/').filter(Boolean);
    const [recurso, id, accion] = partes;
    if (recurso !== 'solicitudes') return error('Ruta no encontrada', 404);

    let body = {};
    if (method === 'POST') {
        try { body = JSON.parse(event.body || '{}'); } catch { return error('Cuerpo inválido', 400); }
    }

    try {
        if (method === 'GET' && !id) return await listar(tenantId, event.queryStringParameters || {}, { ahora, config });
        if (method === 'GET' && id && !accion) {
            const s = await obtener(tenantId, id);
            if (!s) return error('Solicitud no encontrada', 404);
            const historial = await historialDe(tenantId, id);
            // Para decidir una rectificación hay que ver qué se pide: solo acá,
            // solo a quien tiene el permiso, y descifrado en el momento.
            const cambiosPropuestos = s.cambiosCifrados ? await cifradoCampo.descifrarSobre(s.cambiosCifrados) : null;
            return success({ ...conPlazo(s, ahora, config), historial, cambiosPropuestos });
        }

        // Quién actúa sale de la sesión; su nombre, de su ficha.
        const yo = await personaService.getById(sesion.personaId).catch(() => null);
        const actor = { personaId: sesion.personaId, nombre: nombreDe(yo) };

        if (method === 'POST' && !id) return await registrar(event, sesion, body, actor, { ahora, config });
        if (method === 'POST' && id && accion === 'verificacion') return await verificarSolicitud(event, sesion, id, body, actor, { ahora, config });
        if (method === 'POST' && id && accion === 'prorroga') return await prorrogar(event, sesion, id, body, actor, { ahora, config });
        if (method === 'POST' && id && accion === 'exportacion') return await exportarParaSolicitud(event, sesion, id, actor, { ahora });
        if (method === 'POST' && id && accion === 'respuesta') return await responder(event, sesion, id, body, actor, { ahora, config });
        return error('Ruta no encontrada', 404);
    } catch (err) {
        const estado = ESTADO_POR_CODIGO[err.codigo];
        if (estado) return error(err.message, estado);
        throw err;
    }
};

module.exports.handler = async (event) => module.exports.atender(event);

// ─── Aviso diario de plazos ─────────────────────────────────────────────────

const TEXTO_ALERTA = {
    por_vencer: (d) => `Quedan ${d} día(s) para responder una solicitud de un titular.`,
    vencida: () => 'Venció el plazo para responder una solicitud de un titular.',
    prorroga_posible: (d) => `Si hace falta prorrogar una solicitud, hay que comunicarlo al titular en los próximos ${d} día(s): después no vale.`,
    bloqueo_pendiente: () => 'Una solicitud exige bloquear los datos del titular y el bloqueo no está aplicado.',
};

/**
 * Por cada empresa, avisa a quienes tienen el permiso de derechos de los
 * titulares. Una vez por día y tipo (la clave queda en `alertas` de la
 * solicitud), y cada aviso queda en el historial: también es evidencia de que
 * el plazo se vigiló.
 */
module.exports.alertasDiarias = async ({ ahora = new Date(), config = D.configDesdeEntorno() } = {}) => {
    const { ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    const { InboxRepository } = require('../inbox-module/inbox.repository');
    const { TenantService } = require('../../lib/services/TenantService');
    const { personaPuede } = require('../../lib/permissions');
    const { registrarFallo } = require('../../lib/degradacion');
    const inbox = new InboxRepository();
    const tenantService = new TenantService();
    const resultado = { solicitudes: 0, avisos: 0, fallidos: 0 };

    let desde;
    const abiertas = [];
    do {
        const r = await docClient.send(new ScanCommand({
            TableName: TABLA(), FilterExpression: 'begins_with(sk, :p) AND estado = :abierta',
            ExpressionAttributeValues: { ':p': 'SOLICITUD#', ':abierta': D.ESTADOS.ABIERTA }, ExclusiveStartKey: desde,
        }));
        abiertas.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);

    const destinatarios = new Map();
    for (const s of abiertas) {
        resultado.solicitudes += 1;
        const pendientes = D.alertasDe(s, { ahora, config }).filter((a) => !s.alertas?.[a.clave]);
        if (!pendientes.length) continue;
        try {
            if (!destinatarios.has(s.tenantId)) {
                const [personas, tenant] = await Promise.all([personaService.listByTenant(s.tenantId), tenantService.getById(s.tenantId)]);
                const safe = tenant ? tenant.toSafeFormat() : null;
                destinatarios.set(s.tenantId, personas.filter((p) => personaPuede(p, safe, PERMISSIONS.EMPRESA_DERECHOS_TITULARES)).map((p) => p.personaId));
            }
            const ids = destinatarios.get(s.tenantId);
            for (const [n, a] of pendientes.entries()) {
                if (ids.length) {
                    await inbox.sendMessage({
                        senderId: 'system', senderName: 'Sistema', senderRol: 'system', recipientIds: ids,
                        type: 'alert', priority: a.tipo === 'vencida' || a.tipo === 'bloqueo_pendiente' ? 'urgent' : 'high',
                        subject: 'Solicitud de un titular: plazo', content: TEXTO_ALERTA[a.tipo](a.dias),
                        linkedEntity: { type: 'solicitud_titular', id: s.solicitudId },
                    });
                }
                await docClient.send(new UpdateCommand({
                    TableName: TABLA(), Key: { tenantId: s.tenantId, sk: s.sk },
                    UpdateExpression: 'SET alertas = if_not_exists(alertas, :vacio)',
                    ExpressionAttributeValues: { ':vacio': {} },
                }));
                await docClient.send(new UpdateCommand({
                    TableName: TABLA(), Key: { tenantId: s.tenantId, sk: s.sk },
                    UpdateExpression: 'SET alertas.#c = :en', ExpressionAttributeNames: { '#c': a.clave },
                    ExpressionAttributeValues: { ':en': ahora.toISOString() },
                }));
                await docClient.send(new TransactWriteCommand({ TransactItems: aHistorial([
                    D.evento(s.tenantId, s.solicitudId, D.EVENTOS.ALERTA, { tipo: a.tipo, dias: a.dias ?? null, avisados: ids.length }, null, { ahora, n }),
                ]) }));
                resultado.avisos += 1;
            }
        } catch (err) {
            resultado.fallidos += 1;
            registrarFallo('gobernanza.alertas', err, { tenantId: s.tenantId });
        }
    }
    console.log('[alertas-derechos]', JSON.stringify(resultado));
    return resultado;
};

module.exports._interno = { ACTUALIZACIONES, ESTADO_POR_CODIGO, persistirSolicitud, propagarRectificacion };
