/**
 * Detección de eventos sospechosos sobre el registro de auditoría. Reglas
 * puras: reciben el evento recién registrado y los eventos recientes del mismo
 * actor, y dicen si hay que alertar. `lib/gobernanza/auditoria.js` las evalúa
 * después de cada registro y ejecuta lo que corresponda.
 *
 * ── Tres niveles, y quién pasa de uno a otro ───────────────────────────────
 *   SEÑAL       un evento suelto que por sí solo no dice nada (una contraseña
 *               mal escrita). Queda en el registro y nada más.
 *   ALERTA      se cruzó un umbral (cinco contraseñas mal escritas en quince
 *               minutos contra la misma cuenta). La genera esta función: queda
 *               un evento `alerta.<regla>`, una métrica en CloudWatch con su
 *               alarma y un aviso a quienes revisan la auditoría.
 *   INCIDENTE   lo declara una persona del equipo de respuesta después de
 *               analizar la alerta (docs/plan-respuesta-incidentes.md). El
 *               sistema no confirma incidentes solo: una alerta puede ser
 *               alguien que olvidó su contraseña.
 *
 * Las reglas cuentan por ACTOR (el índice `actorId-en-index` de la tabla de
 * auditoría responde eso sin recorrer la tabla). Para el ingreso fallido, el
 * actor es la cuenta atacada (`rut:<hmac>`): el atacante no tiene sesión, y lo
 * que interesa es cuántas veces se intentó contra la misma cuenta.
 */

const MIN = 60000;

const SEVERIDAD = { MEDIA: 'media', ALTA: 'alta' };

/**
 * Cada regla: a qué operación mira, ventana, umbral y qué hacer al cruzarlo.
 * `cuenta` decide qué se cuenta de cada evento (1 por evento, o los titulares
 * distintos para el acceso masivo a salud).
 */
const REGLAS = [
    {
        id: 'fuerza_bruta_cuenta',
        descripcion: 'Intentos reiterados de ingreso fallido contra una misma cuenta.',
        aplica: (ev) => ev.operacion === 'auth.ingreso_fallido',
        ventanaMs: 15 * MIN,
        umbral: 5,
        severidad: SEVERIDAD.ALTA,
        accion: null,
    },
    {
        id: 'verificacion_reiterada',
        descripcion: 'Contraseña mal ingresada varias veces al confirmar identidad para exportar o modificar datos: una sesión robada que intenta adivinarla.',
        aplica: (ev) => ev.operacion === 'identidad.verificacion_fallida',
        ventanaMs: 15 * MIN,
        umbral: 3,
        severidad: SEVERIDAD.ALTA,
        // Contención automática: se cierran todas las sesiones de la cuenta.
        // La persona legítima vuelve a entrar con su contraseña; quien tenía
        // solo la sesión, no.
        accion: 'revocar_sesiones',
    },
    {
        id: 'exportacion_reiterada',
        descripcion: 'Exportación de datos personales por sobre el límite diario.',
        aplica: (ev) => ev.operacion === 'derechos.exportacion_rechazada',
        ventanaMs: 24 * 60 * MIN,
        umbral: 1,
        severidad: SEVERIDAD.MEDIA,
        accion: null,
    },
    {
        id: 'acceso_masivo_salud',
        descripcion: 'Una cuenta accedió a datos de salud de muchas personas en poco tiempo.',
        // Los registros de acceso a salud (D-18) no llevan `operacion`: se
        // reconocen por `tipos`.
        aplica: (ev) => Array.isArray(ev.tipos) && ev.tipos.length > 0,
        ventanaMs: 60 * MIN,
        umbral: 30,
        cuenta: (eventos) => new Set(eventos.flatMap((e) => e.titulares || [])).size,
        severidad: SEVERIDAD.ALTA,
        accion: null,
    },
    {
        id: 'escalamiento_privilegios',
        descripcion: 'Se otorgó el rol de administrador o se cambiaron los permisos de los roles de la empresa.',
        aplica: (ev) => (ev.operacion === 'admin.cambio_rol' && ev.detalle?.rolNuevo === 'admin') || ev.operacion === 'admin.roles_empresa',
        ventanaMs: 60 * MIN,
        umbral: 1,
        severidad: SEVERIDAD.MEDIA,
        accion: null,
    },
];

const regla = (id) => REGLAS.find((r) => r.id === id) || null;

/**
 * Alertas que dispara `evento`, dados los eventos recientes del mismo actor
 * (incluido o no el propio evento: se deduplica por `eventoId`/`sk`).
 *
 * No repite una alerta: si ya hay una `alerta.<regla>` del mismo actor dentro
 * de la ventana, no se vuelve a generar. Una cuenta bajo ataque produce una
 * alerta por ventana, no una por intento.
 */
function evaluar(evento, recientes, { ahora = new Date() } = {}) {
    if (!evento || String(evento.operacion || '').startsWith('alerta.')) return [];
    const idDe = (e) => e.eventoId || e.sk;
    const todos = [...new Map([evento, ...(recientes || [])].map((e) => [idDe(e), e])).values()];
    const alertas = [];
    for (const r of REGLAS) {
        if (!r.aplica(evento)) continue;
        const desde = ahora.getTime() - r.ventanaMs;
        const enVentana = (e) => new Date(e.en).getTime() >= desde;
        const yaAlertada = todos.some((e) => e.operacion === `alerta.${r.id}` && enVentana(e));
        if (yaAlertada) continue;
        const coincidentes = todos.filter((e) => r.aplica(e) && enVentana(e));
        const conteo = r.cuenta ? r.cuenta(coincidentes) : coincidentes.length;
        if (conteo >= r.umbral) {
            alertas.push({ regla: r.id, descripcion: r.descripcion, severidad: r.severidad, conteo, umbral: r.umbral, ventanaMin: r.ventanaMs / MIN, accion: r.accion });
        }
    }
    return alertas;
}

module.exports = { REGLAS, SEVERIDAD, evaluar, regla };
