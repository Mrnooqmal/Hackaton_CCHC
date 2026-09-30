/**
 * Derechos del titular (Ley 21.719): solicitudes, plazos, prórroga y bloqueo
 * temporal. Reglas puras, sin AWS; `handlers/gobernanza/derechos.js` las usa.
 *
 * ── Quién es quién ─────────────────────────────────────────────────────────
 * La constructora es la RESPONSABLE del tratamiento de los datos de sus
 * trabajadores; la plataforma, la ENCARGADA. Por eso el canal por el que llega
 * una solicitud lo decide la constructora, y el sistema solo lo registra.
 *
 * ── Plazos (configurables, no fijos: pendientes de confirmación legal) ─────
 *   - Respuesta: `plazoRespuestaDias` (30) días corridos desde la RECEPCIÓN.
 *   - Prórroga: una sola vez, `prorrogaDias` (30) más, y SOLO si se comunica
 *     antes de que venza el primer plazo. El sistema no permite registrarla
 *     después: una prórroga tardía no vale, y registrarla como si valiera
 *     sería fabricar evidencia de cumplimiento.
 *   - Bloqueo temporal: al pedir rectificación, supresión u oposición, los datos
 *     quedan bloqueados para tratamiento dentro de `bloqueoDiasHabiles` (2)
 *     días hábiles, sin borrarlos, hasta que se resuelva. El sistema lo aplica
 *     al registrar la solicitud, así que el plazo se cumple con holgura; el
 *     vencimiento se calcula igual para poder demostrarlo.
 *
 * ── La fecha de recepción ──────────────────────────────────────────────────
 * El plazo parte cuando LLEGA la solicitud, no cuando se ingresa al sistema:
 * una carta recibida el lunes e ingresada el miércoles ya lleva dos días. Por
 * eso la registra quien la ingresa. Y no se puede editar después: moverla
 * movería el plazo. No puede ser futura. Puede ser antigua: una solicitud que ya
 * venció cuando se ingresa se registra igual, con su fecha real, y aparece
 * vencida desde el primer día. Esconderla o correr su fecha sería peor.
 *
 * Los días hábiles excluyen sábados y domingos, no los feriados (mismo supuesto
 * que `lib/utils/fechaChile.js`): el plazo calculado llega antes que el real,
 * así que el error cae del lado seguro.
 */

const { sumarDiasHabiles } = require('../utils/fechaChile');

const DERECHOS = {
    ACCESO: 'acceso',
    RECTIFICACION: 'rectificacion',
    SUPRESION: 'supresion',
    OPOSICION: 'oposicion',
    PORTABILIDAD: 'portabilidad',
    BLOQUEO: 'bloqueo',
};

/** Los derechos que obligan a bloquear los datos mientras se resuelven. */
const EXIGEN_BLOQUEO = new Set([DERECHOS.RECTIFICACION, DERECHOS.SUPRESION, DERECHOS.OPOSICION, DERECHOS.BLOQUEO]);

const ESTADOS = { ABIERTA: 'abierta', RESUELTA: 'resuelta' };
const RESULTADOS = { ACOGIDA: 'acogida', ACOGIDA_PARCIAL: 'acogida_parcial', RECHAZADA: 'rechazada' };

/** Qué queda en el historial. Solo crece: cada evento es un ítem nuevo, nunca se edita. */
const EVENTOS = {
    SOLICITUD: 'solicitud',
    BLOQUEO: 'bloqueo',
    PRORROGA: 'prorroga',
    RESPUESTA: 'respuesta',
    DESBLOQUEO: 'desbloqueo',
    SUPRESION: 'supresion',
    ALERTA: 'alerta',
};

const CONFIG = { plazoRespuestaDias: 30, prorrogaDias: 30, bloqueoDiasHabiles: 2, alertaDiasAntes: 5 };

const configDesdeEntorno = (env = process.env) => ({
    plazoRespuestaDias: Number(env.GOBERNANZA_PLAZO_RESPUESTA_DIAS || CONFIG.plazoRespuestaDias),
    prorrogaDias: Number(env.GOBERNANZA_PRORROGA_DIAS || CONFIG.prorrogaDias),
    bloqueoDiasHabiles: Number(env.GOBERNANZA_BLOQUEO_DIAS_HABILES || CONFIG.bloqueoDiasHabiles),
    alertaDiasAntes: Number(env.GOBERNANZA_ALERTA_DIAS_ANTES || CONFIG.alertaDiasAntes),
});

const DIA = 86400000;
const sumarDias = (fecha, dias) => new Date(new Date(fecha).getTime() + dias * DIA);

const error = (mensaje, codigo) => Object.assign(new Error(mensaje), { codigo });

/**
 * Arma una solicitud nueva y valida lo que ingresa quien la registra.
 *
 * @param {object} d
 * @param {string} d.personaId - titular (persona de la empresa).
 * @param {string} d.derecho - uno de DERECHOS.
 * @param {string} d.canal - por dónde llegó (lo define la constructora).
 * @param {string} d.recibidaEl - ISO; cuándo LLEGÓ, no cuándo se ingresa.
 * @param {string} [d.detalle] - qué pide, en palabras del titular o de quien la recibe.
 * @param {object} actor - quién la ingresa: `{ personaId, nombre }` (sesión).
 */
function nuevaSolicitud(d, actor, { ahora = new Date(), config = CONFIG, solicitudId }) {
    if (!actor?.personaId) throw error('Falta quién registra la solicitud', 'SIN_ACTOR');
    if (!d?.personaId) throw error('Falta el titular de la solicitud', 'SIN_TITULAR');
    if (!Object.values(DERECHOS).includes(d.derecho)) throw error('Derecho no reconocido', 'DERECHO_INVALIDO');
    const canal = String(d.canal || '').trim();
    if (canal.length < 3 || canal.length > 120) throw error('Indica por qué canal llegó la solicitud', 'CANAL_REQUERIDO');
    const recibida = new Date(d.recibidaEl);
    if (!d.recibidaEl || Number.isNaN(recibida.getTime())) throw error('Indica cuándo llegó la solicitud', 'RECEPCION_REQUERIDA');
    if (recibida.getTime() > ahora.getTime() + 60000) throw error('La fecha de recepción no puede ser futura', 'RECEPCION_FUTURA');
    const detalle = String(d.detalle || '').trim().slice(0, 2000);

    const venceEl = sumarDias(recibida, config.plazoRespuestaDias);
    const exigeBloqueo = EXIGEN_BLOQUEO.has(d.derecho);
    return {
        solicitudId,
        personaId: d.personaId,
        derecho: d.derecho,
        canal,
        detalle,
        recibidaEl: recibida.toISOString(),
        registradaEl: ahora.toISOString(),
        registradaPor: { personaId: actor.personaId, nombre: actor.nombre || null },
        estado: ESTADOS.ABIERTA,
        venceEl: venceEl.toISOString(),
        prorroga: null,
        bloqueo: exigeBloqueo
            ? { exigido: true, plazoHasta: sumarDiasHabiles(recibida, config.bloqueoDiasHabiles), aplicadoEl: null }
            : { exigido: false },
        respuesta: null,
    };
}

/** Plazo vigente de respuesta: el original, o el prorrogado. */
const plazoVigente = (s) => new Date(s.prorroga?.venceEl || s.venceEl);

/**
 * Registra la prórroga. Una sola vez, y SOLO si se comunica antes de que venza
 * el primer plazo: tanto la fecha en que se comunicó como el momento en que se
 * registra tienen que ser anteriores al vencimiento original.
 */
function prorrogar(s, { comunicadaEl, motivo, medio }, actor, { ahora = new Date(), config = CONFIG } = {}) {
    if (s.estado !== ESTADOS.ABIERTA) throw error('La solicitud ya está resuelta', 'SOLICITUD_CERRADA');
    if (s.prorroga) throw error('La prórroga ya se usó: se puede prorrogar una sola vez', 'PRORROGA_USADA');
    const vence = new Date(s.venceEl);
    if (ahora > vence) {
        throw error('El primer plazo ya venció: la prórroga solo vale si se comunicó antes, y no se puede registrar después.', 'PRORROGA_TARDIA');
    }
    const comunicada = new Date(comunicadaEl);
    if (!comunicadaEl || Number.isNaN(comunicada.getTime())) throw error('Indica cuándo se comunicó la prórroga al titular', 'PRORROGA_SIN_FECHA');
    if (comunicada > ahora) throw error('La prórroga no puede estar comunicada en el futuro', 'PRORROGA_FUTURA');
    if (comunicada > vence) throw error('La prórroga se comunicó después del vencimiento: no vale', 'PRORROGA_TARDIA');
    if (comunicada < new Date(s.recibidaEl)) throw error('La prórroga no puede ser anterior a la solicitud', 'PRORROGA_INVALIDA');
    const m = String(motivo || '').trim();
    if (m.length < 10) throw error('Indica el motivo de la prórroga (al menos 10 caracteres)', 'MOTIVO_REQUERIDO');
    return {
        comunicadaEl: comunicada.toISOString(),
        registradaEl: ahora.toISOString(),
        medio: String(medio || '').trim().slice(0, 120) || null,
        motivo: m.slice(0, 1000),
        por: { personaId: actor.personaId, nombre: actor.nombre || null },
        venceEl: sumarDias(vence, config.prorrogaDias).toISOString(),
    };
}

/** La respuesta que cierra la solicitud. */
function responder(s, { resultado, fundamento, medio }, actor, { ahora = new Date() } = {}) {
    if (s.estado !== ESTADOS.ABIERTA) throw error('La solicitud ya está resuelta', 'SOLICITUD_CERRADA');
    if (!Object.values(RESULTADOS).includes(resultado)) throw error('Resultado no reconocido', 'RESULTADO_INVALIDO');
    const f = String(fundamento || '').trim();
    if (f.length < 20) throw error('La respuesta tiene que decir qué se hizo y con qué fundamento (al menos 20 caracteres)', 'FUNDAMENTO_REQUERIDO');
    return {
        resultado,
        fundamento: f.slice(0, 4000),
        medio: String(medio || '').trim().slice(0, 120) || null,
        respondidaEl: ahora.toISOString(),
        por: { personaId: actor.personaId, nombre: actor.nombre || null },
        dentroDePlazo: ahora <= plazoVigente(s),
    };
}

/**
 * Qué avisar hoy sobre una solicitud abierta: plazo por vencer, plazo vencido,
 * y bloqueo que no se aplicó dentro de su plazo. Cada aviso lleva una clave
 * para no repetirse el mismo día.
 */
function alertasDe(s, { ahora = new Date(), config = CONFIG } = {}) {
    if (s.estado !== ESTADOS.ABIERTA) return [];
    const alertas = [];
    const plazo = plazoVigente(s);
    const dias = Math.ceil((plazo.getTime() - ahora.getTime()) / DIA);
    const hoy = ahora.toISOString().slice(0, 10);
    if (dias < 0) alertas.push({ tipo: 'vencida', clave: `vencida:${hoy}`, dias });
    else if (dias <= config.alertaDiasAntes) alertas.push({ tipo: 'por_vencer', clave: `por_vencer:${hoy}`, dias });
    if (!s.prorroga && ahora <= new Date(s.venceEl) && dias <= config.alertaDiasAntes && dias >= 0) {
        // Último momento para comunicar la prórroga, si hace falta.
        alertas.push({ tipo: 'prorroga_posible', clave: `prorroga_posible:${hoy}`, dias });
    }
    if (s.bloqueo?.exigido && !s.bloqueo.aplicadoEl && s.bloqueo.plazoHasta && ahora > new Date(s.bloqueo.plazoHasta)) {
        alertas.push({ tipo: 'bloqueo_pendiente', clave: `bloqueo_pendiente:${hoy}` });
    }
    return alertas;
}

/**
 * Un evento del historial. Solo crece: la clave incluye el instante y un
 * contador, y se escribe con `attribute_not_exists`: no se puede pisar.
 * No lleva datos personales del titular más allá de su personaId: el detalle de
 * la solicitud vive en la solicitud, que se puede anonimizar al vencer; el
 * historial es la prueba de cumplimiento y se conserva.
 */
function evento(tenantId, solicitudId, tipo, datos, actor, { ahora = new Date(), n = 0 } = {}) {
    if (!Object.values(EVENTOS).includes(tipo)) throw error(`Evento desconocido: ${tipo}`, 'EVENTO_INVALIDO');
    return {
        tenantId,
        // Instante + contador + tipo: dos operaciones en el mismo milisegundo
        // (registrar y bloquear, responder y desbloquear) no chocan, y se leen en
        // el orden en que ocurrieron. El contador va ANTES del tipo: DynamoDB
        // ordena por esta clave, y con el tipo primero el bloqueo salía antes que
        // la solicitud que lo causó.
        sk: `HIST#${solicitudId}#${ahora.toISOString()}#${String(n).padStart(3, '0')}#${tipo}`,
        solicitudId,
        tipo,
        en: ahora.toISOString(),
        por: actor ? { personaId: actor.personaId, nombre: actor.nombre || null } : { sistema: true },
        datos: datos || {},
    };
}

module.exports = {
    DERECHOS, EXIGEN_BLOQUEO, ESTADOS, RESULTADOS, EVENTOS, CONFIG,
    configDesdeEntorno, nuevaSolicitud, prorrogar, responder, alertasDe, evento, plazoVigente, sumarDias,
};
