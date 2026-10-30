/**
 * Consentimiento por finalidad (Ley 19.628 modificada por la Ley 21.719, art.
 * 12). Reglas puras, sin AWS: `handlers/gobernanza/titular.js` las persiste y
 * el resto del sistema pregunta con `consentimientoVigente`.
 *
 * ── Cuándo aplica ──────────────────────────────────────────────────────────
 * Casi todo lo que Build & Serve trata de una persona tiene otra base de
 * licitud: la obligación legal del DS 44 y de la Ley 16.744 (acreditar la
 * entrega de EPP, las capacitaciones, las firmas, el registro de accidentes) o
 * la ejecución del contrato de trabajo (asignar a una obra). Pedir
 * consentimiento para eso sería engañoso: la persona no puede negarse sin dejar
 * de trabajar, y un consentimiento que no se puede negar no es libre. Esas
 * bases se declaran en `BASES_SIN_CONSENTIMIENTO` y se muestran al titular para
 * que sepa por qué no se le pregunta.
 *
 * Solo tres tratamientos dependen de la voluntad de la persona, y son los que
 * están en `FINALIDADES`. Cada uno se otorga y se revoca por separado: aceptar
 * uno no habilita ningún otro, porque cada pregunta del sistema nombra UNA
 * finalidad y la respuesta sale solo de esa.
 *
 * ── Qué se guarda ──────────────────────────────────────────────────────────
 * Por persona y finalidad, un registro con el estado actual (otorgado o
 * revocado), la versión exacta del texto que se le mostró, cuándo se otorgó,
 * cuándo se revocó y por qué canal. Cada cambio de estado deja además un evento
 * en el historial de gobernanza, que solo crece: con eso se reconstruye la
 * historia completa sin reescribir nada.
 *
 * La ficha de la persona lleva una copia mínima, `consentimientos`: el conjunto
 * de `finalidad@versión` vigentes. Se escribe en la MISMA transacción que el
 * registro y el evento, así que no puede quedar desalineada, y permite a
 * cualquier punto del sistema decidir sin una lectura extra.
 *
 * ── Versiones ──────────────────────────────────────────────────────────────
 * Si el texto informado cambia en algo sustantivo (otra finalidad, otro
 * destinatario, otro plazo), se publica una versión nueva. Un consentimiento
 * dado a la versión anterior deja de valer para lo nuevo: `consentimientoVigente`
 * exige la versión actual, y el titular tiene que volver a decidir.
 *
 * ── Menores de edad ────────────────────────────────────────────────────────
 * No hay flujo con representante legal porque el sistema no puede tener
 * titulares menores de 18 años: el DS N° 1 de 2021 del Ministerio del Trabajo
 * (reglamento del trabajo adolescente, Ley 21.271) califica como peligroso todo
 * trabajo en faenas de la construcción (art. 4, letra A, N° 31) y lo prohíbe a
 * cualquier menor de 18 (art. 2). En vez de suponerlo, se comprueba: si la ficha
 * trae una fecha de nacimiento de un menor, no se registra la persona
 * (`problemaEdadMinima`) ni se acepta su consentimiento.
 */

const ESTADOS = { OTORGADO: 'otorgado', REVOCADO: 'revocado' };
const EVENTOS = { OTORGADO: 'consentimiento_otorgado', REVOCADO: 'consentimiento_revocado' };
const CANALES = new Set(['web', 'app', 'presencial_asistido']);

/**
 * Finalidades que dependen del consentimiento. `versiones` guarda TODOS los
 * textos publicados: el historial cita la versión, y con esto se sabe qué decía
 * exactamente el texto que la persona aceptó.
 */
const FINALIDADES = {
    ficha_basica_salud: {
        nombre: 'Ficha básica de salud',
        dato: 'Alergias, enfermedades crónicas y otros antecedentes que declares en la Ficha Básica de Salud.',
        efectoRevocacion: 'Dejas de poder responder la ficha y tus respuestas dejan de mostrarse a la empresa. Puedes pedir además que se supriman.',
        versionActual: 'v1',
        versiones: {
            v1: {
                publicadaEl: '2026-10-29',
                texto: 'Autorizo a mi empleador a registrar en Build & Serve los antecedentes de salud que declare en la Ficha Básica de Salud '
                    + '(alergias, enfermedades crónicas y otros que yo indique), con la única finalidad de prestarme una atención adecuada ante '
                    + 'una emergencia en la obra. Solo podrá verlos el personal con permiso de vigilancia de salud de mi empleador, quedará '
                    + 'registro de cada acceso y no se comunicarán a terceros. Se conservan mientras dure mi vínculo laboral, salvo que revoque '
                    + 'esta autorización antes. Responder la ficha es voluntario y no afecta mi trabajo.',
            },
        },
    },
    foto_perfil: {
        nombre: 'Foto de perfil',
        dato: 'La fotografía que subas a tu perfil.',
        efectoRevocacion: 'Tu foto deja de mostrarse de inmediato y no se puede subir otra. Puedes pedir además que se suprima.',
        versionActual: 'v1',
        versiones: {
            v1: {
                publicadaEl: '2026-10-29',
                texto: 'Autorizo a mi empleador a mostrar en Build & Serve la fotografía que yo suba a mi perfil, para que mis compañeros y '
                    + 'jefaturas me reconozcan en las listas de la obra. No se usa para identificarme en firmas ni para reconocimiento facial. '
                    + 'Es voluntario: sin foto el sistema funciona igual.',
            },
        },
    },
    dictado_voz_ia: {
        nombre: 'Dictado por voz con inteligencia artificial',
        dato: 'El audio que grabes al dictar el relato de un incidente.',
        efectoRevocacion: 'El botón de dictado deja de funcionar para ti; puedes seguir escribiendo el relato.',
        versionActual: 'v1',
        versiones: {
            v1: {
                publicadaEl: '2026-10-29',
                texto: 'Autorizo que el audio que grabe al dictar el relato de un incidente se envíe a Google (servicio Gemini, con '
                    + 'servidores fuera de Chile) solo para convertirlo en texto. Build & Serve no guarda el audio; guarda únicamente el texto '
                    + 'que yo revise y envíe. Es voluntario: puedo escribir el relato sin dictarlo.',
            },
        },
    },
};

/**
 * Lo que se trata SIN consentimiento, y por qué. No se pregunta: se informa.
 */
const BASES_SIN_CONSENTIMIENTO = [
    { tratamiento: 'Ficha laboral, RUT, cargo y asignación a obras', base: 'Ejecución del contrato de trabajo y obligación legal (DS 44, Ley 16.744).' },
    { tratamiento: 'Firmas de documentos, entregas de EPP, capacitaciones y charlas', base: 'Obligación legal de acreditar la gestión preventiva (DS 44).' },
    { tratamiento: 'Vigilancia de salud ocupacional y restricciones laborales', base: 'Obligación legal (DS 44, arts. 67 a 69).' },
    { tratamiento: 'Registro de accidentes, incidentes y enfermedades profesionales', base: 'Obligación legal (Ley 16.744 y DS 44).' },
    { tratamiento: 'Registro de auditoría de accesos y operaciones', base: 'Deber de seguridad del responsable (Ley 21.719) y prevención de fraudes.' },
];

const error = (mensaje, codigo) => Object.assign(new Error(mensaje), { codigo });

const finalidad = (id) => FINALIDADES[id] || null;
const marca = (id, version) => `${id}@${version}`;

/** Edad cumplida en `ahora`, o null si la fecha no sirve. */
function edadEn(fechaNacimiento, ahora = new Date()) {
    if (!fechaNacimiento) return null;
    const f = new Date(`${String(fechaNacimiento).slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(f.getTime())) return null;
    let edad = ahora.getUTCFullYear() - f.getUTCFullYear();
    const m = ahora.getUTCMonth() - f.getUTCMonth();
    if (m < 0 || (m === 0 && ahora.getUTCDate() < f.getUTCDate())) edad -= 1;
    return edad;
}

/**
 * Problema con la edad de una persona que se registra o se rectifica, o null.
 * Sin fecha no hay nada que comprobar: es un dato opcional para el personal.
 */
function problemaEdadMinima(fechaNacimiento, ahora = new Date()) {
    if (!fechaNacimiento) return null;
    const edad = edadEn(fechaNacimiento, ahora);
    if (edad === null) return 'La fecha de nacimiento no es válida';
    if (edad < 0) return 'La fecha de nacimiento no puede ser futura';
    if (edad < 18) {
        return 'No se puede registrar a una persona menor de 18 años: el trabajo en faenas de construcción está prohibido para '
            + 'menores de edad (DS N° 1 de 2021 del Ministerio del Trabajo, art. 4, letra A, N° 31).';
    }
    if (edad > 100) return 'La fecha de nacimiento no es válida';
    return null;
}

/**
 * ¿Hay consentimiento vigente para ESTA finalidad, en su versión actual?
 * Recibe la persona (modelo o ítem): mira solo la copia mínima de la ficha.
 * No hay comodines ni herencia entre finalidades.
 */
function consentimientoVigente(persona, id) {
    const f = finalidad(id);
    if (!f || !persona) return false;
    const vigentes = persona.consentimientos instanceof Set
        ? persona.consentimientos
        : new Set(Array.isArray(persona.consentimientos) ? persona.consentimientos : []);
    return vigentes.has(marca(id, f.versionActual));
}

/** Lanza si no hay consentimiento vigente: para los puntos que tratan el dato. */
function exigirConsentimiento(persona, id) {
    if (!consentimientoVigente(persona, id)) {
        const f = finalidad(id);
        throw error(`Falta tu consentimiento para "${f ? f.nombre : id}". Puedes otorgarlo en Mis datos y privacidad.`, 'SIN_CONSENTIMIENTO');
    }
}

/**
 * Otorgar: valida y devuelve el registro nuevo. `actual` es el registro previo
 * de esa persona y finalidad, o null.
 *
 * Exige que quien otorga haya visto la versión ACTUAL del texto: si la pantalla
 * mostraba una versión anterior, se rechaza y hay que volver a leerla.
 */
function otorgar(actual, { finalidad: id, version, canal = 'web' }, persona, { ahora = new Date() } = {}) {
    const f = finalidad(id);
    if (!f) throw error('Finalidad no reconocida', 'FINALIDAD_INVALIDA');
    if (!persona?.personaId) throw error('Falta el titular', 'SIN_TITULAR');
    if (version !== f.versionActual) {
        throw error('El texto que aceptaste ya no es el vigente. Vuelve a leerlo antes de decidir.', 'VERSION_DESACTUALIZADA');
    }
    if (!CANALES.has(canal)) throw error('Canal no reconocido', 'CANAL_INVALIDO');
    const edad = edadEn(persona.fechaNacimiento, ahora);
    if (edad !== null && edad < 18) {
        // No debería existir (ver `problemaEdadMinima`), pero si existe no se le
        // pide consentimiento a un menor sin su representante.
        throw error('Una persona menor de 18 años no puede otorgar este consentimiento en el sistema.', 'MENOR_DE_EDAD');
    }
    if (actual?.estado === ESTADOS.OTORGADO && actual.version === version) {
        throw error('Este consentimiento ya está otorgado.', 'YA_OTORGADO');
    }
    return {
        personaId: persona.personaId,
        finalidad: id,
        version,
        estado: ESTADOS.OTORGADO,
        canal,
        otorgadoEl: ahora.toISOString(),
        revocadoEl: null,
        // La versión que se reemplaza, si había una: queda en el historial.
        versionAnterior: actual?.estado === ESTADOS.OTORGADO ? actual.version : null,
        actualizadoEl: ahora.toISOString(),
    };
}

/**
 * Revocar: tan simple como otorgar. Sin contraseña, sin justificar, sin pasar
 * por nadie. No borra el otorgamiento: lo cierra con su fecha.
 */
function revocar(actual, { canal = 'web' } = {}, { ahora = new Date() } = {}) {
    if (!actual || actual.estado !== ESTADOS.OTORGADO) {
        throw error('No hay un consentimiento otorgado que revocar.', 'NO_OTORGADO');
    }
    if (!CANALES.has(canal)) throw error('Canal no reconocido', 'CANAL_INVALIDO');
    return { ...actual, estado: ESTADOS.REVOCADO, revocadoEl: ahora.toISOString(), canalRevocacion: canal, actualizadoEl: ahora.toISOString() };
}

/**
 * Evento del historial. Solo identificadores, finalidad y versión: nunca el
 * dato que el consentimiento habilita.
 */
function evento(tenantId, personaId, tipo, datos, { ahora = new Date(), n = 0 } = {}) {
    if (!Object.values(EVENTOS).includes(tipo)) throw error(`Evento desconocido: ${tipo}`, 'EVENTO_INVALIDO');
    return {
        tenantId,
        // La finalidad va en la clave: dos decisiones sobre finalidades
        // distintas en el mismo milisegundo no chocan.
        sk: `CONS#${personaId}#${ahora.toISOString()}#${String(n).padStart(3, '0')}#${tipo}#${datos?.finalidad || '-'}`,
        personaId,
        tipo,
        en: ahora.toISOString(),
        por: { personaId },
        datos,
    };
}

/** Lo que ve el titular de cada finalidad: el texto vigente y su estado. */
function vistaTitular(registros) {
    const porFinalidad = new Map((registros || []).map((r) => [r.finalidad, r]));
    return Object.entries(FINALIDADES).map(([id, f]) => {
        const r = porFinalidad.get(id) || null;
        const vigente = r?.estado === ESTADOS.OTORGADO && r.version === f.versionActual;
        return {
            finalidad: id,
            nombre: f.nombre,
            dato: f.dato,
            efectoRevocacion: f.efectoRevocacion,
            version: f.versionActual,
            texto: f.versiones[f.versionActual].texto,
            estado: r ? r.estado : 'sin_decision',
            vigente,
            // Otorgado a una versión anterior: hay que volver a decidir.
            requiereRenovar: r?.estado === ESTADOS.OTORGADO && r.version !== f.versionActual,
            otorgadoEl: r?.otorgadoEl || null,
            revocadoEl: r?.revocadoEl || null,
            versionAceptada: r?.version || null,
        };
    });
}

module.exports = {
    ESTADOS, EVENTOS, FINALIDADES, BASES_SIN_CONSENTIMIENTO,
    finalidad, marca, edadEn, problemaEdadMinima, consentimientoVigente, exigirConsentimiento,
    otorgar, revocar, evento, vistaTitular,
};
