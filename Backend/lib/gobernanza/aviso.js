/**
 * Aviso de privacidad para el titular (Ley 19.628 modificada por la Ley 21.719:
 * deber de información). Reglas puras, sin AWS.
 *
 * Lo que la persona tiene que poder saber, antes de que se recojan sus datos y
 * en cualquier momento después: quién es el responsable, quién los trata por su
 * cuenta y dónde, qué datos y para qué, con qué base, cuánto tiempo se guardan,
 * qué derechos tiene, cómo ejercerlos, en qué plazos, y que puede reclamar ante
 * la Agencia de Protección de Datos Personales.
 *
 * No se escribe a mano: las categorías, finalidades y plazos salen del
 * inventario de datos (`inventario.js`), que también recorre la retención y
 * genera el registro de tratamientos; las bases y los consentimientos, de
 * `consentimiento.js`; los plazos de los derechos, de `derechos.js`. Si alguno
 * cambia, el aviso cambia con él. Lo único propio de aquí es la lista de
 * encargados y dónde están, que no vive en ningún otro lugar del código.
 *
 * Hasta el 8 de noviembre de 2026 el titular veía las bases y los
 * consentimientos, pero no que sus datos se alojan en Estados Unidos, cuánto se
 * guardan ni que puede reclamar ante la Agencia.
 */

const { FUENTES, CLASE, AL_VENCER } = require('./inventario');
const { FINALIDADES, BASES_SIN_CONSENTIMIENTO } = require('./consentimiento');
const { CONFIG, TRATAMIENTOS_OPONIBLES } = require('./derechos');

/** Cambia cuando cambia algo sustantivo que no sale de las fuentes (por ejemplo, un encargado). */
const VERSION_AVISO = '2026-11-08';

const PLAZO = {
    [CLASE.EVIDENCIA]: '5 años desde el término de la relación laboral',
    [CLASE.CONVENIENCIA]: 'Hasta que la persona pida suprimirlo, o mientras exista su ficha',
    [CLASE.OPERACIONAL]: 'Mientras sirve para que el sistema funcione (horas o días)',
};

const QUE_PASA = {
    [AL_VENCER.SUPRIMIR]: 'Se suprime',
    [AL_VENCER.ANONIMIZAR]: 'Se anonimiza (se conserva el hecho para los indicadores)',
    [AL_VENCER.GRUPAL]: 'Se conserva completo hasta que vence el plazo del último involucrado; después se suprime',
    [AL_VENCER.EMPRESA]: 'No vence por personas (es de la empresa)',
    [AL_VENCER.TTL]: 'Vence solo (uso o fecha de expiración)',
};

/**
 * Quién trata los datos por cuenta del responsable, y dónde. Cada uno que está
 * fuera de Chile es una transferencia internacional y se informa como tal.
 */
const ENCARGADOS = [
    {
        quien: 'Build & Serve',
        que: 'Opera la plataforma por encargo de tu empleador. No usa tus datos para fines propios.',
        donde: 'Chile',
        transferenciaInternacional: false,
    },
    {
        quien: 'Amazon Web Services (AWS)',
        que: 'Aloja la plataforma: la base de datos, los archivos y los registros, cifrados con llaves propias de la plataforma.',
        donde: 'Estados Unidos (región us-east-1, Virginia del Norte)',
        transferenciaInternacional: true,
    },
    {
        quien: 'Amazon Simple Email Service (AWS)',
        que: 'Envía los correos de la plataforma: avisos, recuperación de contraseña y respuestas a tus solicitudes.',
        donde: 'Estados Unidos',
        transferenciaInternacional: true,
    },
    {
        quien: 'Google (servicio Gemini)',
        que: 'Convierte en texto el audio del dictado por voz. Solo recibe audio si autorizas el dictado; Build & Serve no guarda el audio.',
        donde: 'Fuera de Chile',
        transferenciaInternacional: true,
        soloConConsentimiento: 'dictado_voz_ia',
    },
];

/**
 * Lo que queda en el equipo (teléfono o computador) donde se firma sin señal.
 * No está en el inventario porque no vive en el servidor: lo guardan
 * Frontend/src/utils/colaFirmas.ts y copiaLocal.ts.
 */
const EN_EL_EQUIPO = 'Para firmar sin señal, el equipo donde se habilita la firma guarda tu nombre y cargo, los documentos y actividades '
    + 'que tienes pendientes, las firmas que aún no se envían y vales de firma cifrados con tu PIN (nunca el PIN). Los vales vencen a '
    + 'las 12 horas; todo se borra al cerrar sesión a propósito en ese equipo, salvo las firmas por enviar, que se envían al volver la señal.';

const DERECHOS_INFORMADOS = [
    { derecho: 'Acceso y portabilidad', que: 'Saber qué datos tuyos se tratan y recibir una copia en un formato que puedas llevar a otro lugar.' },
    { derecho: 'Rectificación', que: 'Corregir datos inexactos o incompletos.' },
    { derecho: 'Supresión', que: 'Pedir que se borren. Lo que la ley obliga a conservar (por ejemplo, tus firmas del DS 44) se guarda bloqueado hasta que vence su plazo.' },
    {
        derecho: 'Oposición',
        que: 'Oponerte a un tratamiento que no se base en una obligación legal, en tu contrato ni en tu consentimiento: '
            + `${Object.values(TRATAMIENTOS_OPONIBLES).map((t) => t.nombre.toLowerCase()).join(', ')}. Si se acoge, ese tratamiento deja de hacerse hasta que retires tu oposición.`,
    },
    { derecho: 'Bloqueo temporal', que: 'Mientras se resuelve una rectificación, supresión u oposición, tus datos quedan bloqueados para su uso.' },
    { derecho: 'Revocar tus consentimientos', que: 'Retirar en cualquier momento lo que autorizaste, tan fácil como lo otorgaste.' },
];

/**
 * El aviso completo.
 *
 * @param {object} p
 * @param {string|null} p.empresa - nombre de la empresa responsable (de la sesión).
 * @param {object} [p.config] - plazos de los derechos (`derechos.configDesdeEntorno()`).
 */
function avisoDePrivacidad({ empresa = null, config = CONFIG } = {}) {
    return {
        version: VERSION_AVISO,
        responsable: {
            nombre: empresa || 'Tu empleador',
            rol: 'Responsable del tratamiento: decide qué datos tuyos se tratan y para qué.',
            contacto: 'Puedes ejercer tus derechos en Mis datos y privacidad, o ante tu empleador por el canal que haya dispuesto.',
        },
        encargados: ENCARGADOS.map((e) => ({ ...e })),
        tratamientos: FUENTES.map((f) => ({
            categoria: f.nombre,
            datos: f.datos,
            finalidad: f.finalidad,
            conservacion: PLAZO[f.clase] || 'Según su finalidad',
            alVencer: QUE_PASA[f.alVencer] || null,
            contieneSalud: Boolean(f.contieneSalud),
        })),
        bases: BASES_SIN_CONSENTIMIENTO.map((b) => ({ ...b })),
        consentimientos: Object.entries(FINALIDADES).map(([id, f]) => ({ finalidad: id, nombre: f.nombre, dato: f.dato })),
        enElEquipo: EN_EL_EQUIPO,
        datosSensibles: 'Algunos datos son sensibles (salud: vigilancia ocupacional, restricciones laborales, lesiones de un accidente y, si lo autorizas, la Ficha Básica de Salud). Solo los ve quien tiene permiso de vigilancia de salud, y cada acceso queda registrado.',
        derechos: DERECHOS_INFORMADOS.map((d) => ({ ...d })),
        plazos: {
            respuestaDias: config.plazoRespuestaDias,
            prorrogaDias: config.prorrogaDias,
            bloqueoDiasHabiles: config.bloqueoDiasHabiles,
            texto: `Tu empleador tiene ${config.plazoRespuestaDias} días corridos para responder desde que recibe tu solicitud, `
                + `prorrogables una sola vez por ${config.prorrogaDias} días más si te lo comunica antes de que venza el primero. `
                + `Si pides rectificar, suprimir u oponerte, tus datos quedan bloqueados dentro de ${config.bloqueoDiasHabiles} días hábiles. `
                + 'Ejercer tus derechos es gratuito.',
        },
        reclamo: 'Si no te responden dentro del plazo, o no estás de acuerdo con la respuesta, puedes reclamar ante la Agencia de Protección de Datos Personales.',
    };
}

module.exports = { avisoDePrivacidad, VERSION_AVISO, ENCARGADOS, PLAZO, QUE_PASA };
