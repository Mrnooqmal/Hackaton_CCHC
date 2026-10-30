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
const { validateRut } = require('../utils/validation');
const { problemaEdadMinima } = require('./consentimiento');

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

/**
 * Etapas del flujo de una solicitud. No se guardan: se calculan de las fechas
 * que sí se guardan (`etapaDe`), así no puede haber una etapa que contradiga
 * lo ocurrido.
 *
 *   recibida    llegó y quedó registrada, con su fecha de recepción
 *   verificada  se comprobó que quien la presenta es el titular; queda en
 *               evaluación de quien tiene el permiso de derechos
 *   respondida  se decidió (acogida, en parte o rechazada) con fundamento;
 *               falta ejecutar (una supresión espera su lote de dos personas)
 *   cerrada     respondida y, si correspondía, ejecutada
 */
const ETAPAS = { RECIBIDA: 'recibida', VERIFICADA: 'verificada', RESPONDIDA: 'respondida', CERRADA: 'cerrada' };

/**
 * Cómo se verificó la identidad. Proporcional al riesgo y sin guardar el
 * documento: se registra el método, nunca el número de cédula ni una copia.
 *   sesion_y_contrasena  el titular la presentó desde su sesión y volvió a
 *                        escribir su contraseña (autoservicio)
 *   presencial_cedula    se presentó con su cédula ante quien la recibió
 *   correo_registrado    llegó desde el correo que la ficha ya tenía
 *   otro                 con una observación obligatoria
 */
const METODOS_VERIFICACION = ['sesion_y_contrasena', 'presencial_cedula', 'correo_registrado', 'otro'];

/** Derechos que, acogidos, exigen ejecutar algo además de responder. */
const EXIGEN_EJECUCION = new Set([DERECHOS.RECTIFICACION, DERECHOS.SUPRESION]);

/**
 * Lo que el titular puede pedir rectificar con una solicitud (lo revisa quien
 * tiene el permiso). El resto de su perfil de contacto (teléfono, correo,
 * contacto de emergencia, foto) lo corrige directamente en su perfil.
 */
const CAMPOS_RECTIFICABLES = ['nombre', 'apellidoPaterno', 'apellidoMaterno', 'rut', 'fechaNacimiento'];
const NOMBRE_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]{1,60}$/;
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
    VERIFICACION: 'verificacion',
    EJECUCION: 'ejecucion',
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

/**
 * Verificación de identidad de una solicitud registrada. Una vez, antes de
 * responder, y sin guardar el documento que se exhibió.
 */
function verificar(s, { metodo, observacion }, actor, { ahora = new Date() } = {}) {
    if (s.estado !== ESTADOS.ABIERTA) throw error('La solicitud ya está resuelta', 'SOLICITUD_CERRADA');
    if (s.verificacion) throw error('La identidad ya se verificó', 'YA_VERIFICADA');
    if (!METODOS_VERIFICACION.includes(metodo)) throw error('Método de verificación no reconocido', 'METODO_INVALIDO');
    const obs = String(observacion || '').trim();
    if (metodo === 'otro' && obs.length < 10) throw error('Describe cómo se verificó la identidad (al menos 10 caracteres)', 'OBSERVACION_REQUERIDA');
    // Sin números de documento: la observación es para el método, no para
    // copiar la cédula.
    if (/\d{7,}/.test(obs.replace(/[.\-\s]/g, ''))) {
        throw error('No anotes números de documento: basta con decir cómo se verificó.', 'OBSERVACION_CON_DOCUMENTO');
    }
    return {
        metodo,
        observacion: obs.slice(0, 300) || null,
        verificadaEl: ahora.toISOString(),
        por: actor ? { personaId: actor.personaId, nombre: actor.nombre || null } : { sistema: true },
    };
}

/** Etapa actual, calculada de lo registrado. */
function etapaDe(s) {
    if (!s) return null;
    if (s.respuesta) {
        const acogida = s.respuesta.resultado !== RESULTADOS.RECHAZADA;
        const pendiente = acogida && EXIGEN_EJECUCION.has(s.derecho) && !s.ejecucion;
        return pendiente ? ETAPAS.RESPONDIDA : ETAPAS.CERRADA;
    }
    return s.verificacion ? ETAPAS.VERIFICADA : ETAPAS.RECIBIDA;
}

/**
 * Valida los cambios que el titular pide en una rectificación, contra su ficha
 * actual. Devuelve `{ campo: valorNuevo }` normalizado, o lanza con el primer
 * problema. Lo que no está en `CAMPOS_RECTIFICABLES` se rechaza (no se ignora):
 * el titular tiene que saber que eso no se pidió.
 */
function validarCambios(cambios, actual, { ahora = new Date() } = {}) {
    if (!cambios || typeof cambios !== 'object' || Array.isArray(cambios)) throw error('Indica qué datos quieres corregir', 'SIN_CAMBIOS');
    const resultado = {};
    for (const [campo, crudo] of Object.entries(cambios)) {
        if (!CAMPOS_RECTIFICABLES.includes(campo)) {
            throw error(`"${campo}" no se rectifica con una solicitud. El teléfono, el correo y el contacto de emergencia los corriges en tu perfil.`, 'CAMPO_NO_RECTIFICABLE');
        }
        const valor = String(crudo ?? '').trim();
        let normal = valor;
        if (campo === 'rut') {
            const v = validateRut(valor);
            if (!v.valid) throw error('El RUT no es válido', 'RUT_INVALIDO');
            normal = v.formatted;
        } else if (campo === 'fechaNacimiento') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw error('La fecha de nacimiento debe tener el formato AAAA-MM-DD', 'FECHA_INVALIDA');
            const problema = problemaEdadMinima(valor, ahora);
            if (problema) throw error(problema, 'FECHA_INVALIDA');
        } else if (campo === 'apellidoMaterno' && valor === '') {
            normal = '';
        } else if (!NOMBRE_RE.test(valor)) {
            throw error(`"${campo}" solo admite letras, espacios, apóstrofo y guion, hasta 60 caracteres`, 'NOMBRE_INVALIDO');
        }
        const previo = campo === 'rut' ? validateRut(actual?.rut).formatted : String(actual?.[campo] ?? '');
        if (normal === previo) throw error(`"${campo}" ya tiene ese valor`, 'SIN_CAMBIOS');
        resultado[campo] = normal;
    }
    if (!Object.keys(resultado).length) throw error('Indica qué datos quieres corregir', 'SIN_CAMBIOS');
    return resultado;
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
    // Acoger sin saber quién pide es entregar o cambiar datos de una persona a
    // cualquiera que diga ser ella. Rechazar sí se puede: "no se pudo verificar
    // la identidad" es un fundamento válido.
    if (resultado !== RESULTADOS.RECHAZADA && !s.verificacion) {
        throw error('Antes de acoger una solicitud hay que registrar cómo se verificó la identidad del titular.', 'SIN_VERIFICACION');
    }
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
    DERECHOS, EXIGEN_BLOQUEO, EXIGEN_EJECUCION, ESTADOS, ETAPAS, RESULTADOS, EVENTOS, CONFIG, METODOS_VERIFICACION, CAMPOS_RECTIFICABLES,
    configDesdeEntorno, nuevaSolicitud, prorrogar, responder, verificar, etapaDe, validarCambios, alertasDe, evento, plazoVigente, sumarDias,
};
