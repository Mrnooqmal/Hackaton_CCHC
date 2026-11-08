/**
 * Cola de firmas tomadas sin red, y vales de firma del equipo.
 *
 * ── Por empresa ──────────────────────────────────────────────────────────────
 * Todo se guarda separado por empresa (`firmasPendientes:<empresa>`,
 * `valesFirma:<empresa>`). Una firma tomada en una empresa la sincroniza una
 * sesión de esa empresa y nunca una de otra: en un equipo compartido pueden
 * entrar personas de empresas distintas.
 *
 * ── Qué sobrevive a qué ──────────────────────────────────────────────────────
 * - La COLA sobrevive a todo: al vencimiento de la sesión, a un 401 y al cierre
 *   de sesión. Son actos que ya ocurrieron en terreno; borrarlos destruye
 *   evidencia. Antes se borraba al caer la sesión, y un turno largo sin señal
 *   (la sesión dura 6 horas) perdía todas las firmas tomadas.
 * - Los VALES sobreviven al vencimiento de la sesión (el supervisor no pierde los
 *   de su cuadrilla a mitad de turno) y se borran con un "Cerrar sesión"
 *   explícito: son credenciales de un solo uso a nombre de quienes los
 *   desbloquearon, y el equipo puede pasar a otras manos.
 *
 * ── Vales cifrados con el PIN ────────────────────────────────────────────────
 * Los vales se guardan cifrados con una llave derivada del PIN de la persona
 * (utils/valesCifrados). Sin red, tomar un vale exige el PIN; cinco PIN
 * equivocados seguidos en este equipo borran los vales de esa persona, y hay que
 * volver a habilitarla con señal. Ese contador vive en el mismo almacenamiento:
 * frena a quien prueba PIN dentro de la app, no a quien copió el almacenamiento
 * (a ese lo frena el servidor, ver valesCifrados).
 *
 * Funciones sobre un almacenamiento (por omisión `localStorage`) para que se
 * puedan probar sin navegador (Backend/tests/cola-firmas.test.js y
 * vales-cifrados.test.js).
 */

import { abrirLlave, descifrarVale, type ValesCifrados } from './valesCifrados';

export type TipoFirma = 'documento' | 'actividad' | 'encuesta';

export interface FirmaPendiente {
    /** Identifica la firma en el equipo; viaja como `idFirmaLocal` (reintento idempotente). */
    id: string;
    tenantId: string;
    type: TipoFirma;
    targetId: string;
    targetTitle: string;
    workerId: string;
    workerName: string;
    /** Vale de un solo uso. Reemplaza al PIN, que no se guarda nunca. */
    vale: string;
    /** Cuándo se firmó en terreno, según el reloj del equipo (dato declarado). */
    timestamp: string;
    surveyAnswers?: unknown[];
}

export interface ValesDePersona {
    personaId: string;
    /** Obra del turno: los vales sirven para esa obra y para lo que no tiene obra. */
    obraId: string;
    /** Los vales, cifrados con el PIN (nunca en claro). */
    cifrado: ValesCifrados;
    expiraEn: string;
    /** PIN equivocados seguidos en este equipo. Al llegar a MAX_INTENTOS_EQUIPO se borran los vales. */
    intentosFallidos?: number;
}

/** Lo que las pantallas ven de los vales de una persona: cuántos, de qué obra, hasta cuándo. */
export interface ResumenVales {
    personaId: string;
    obraId: string;
    expiraEn: string;
    cantidad: number;
}

/** Firma que el servidor rechazó al sincronizar: se avisa con nombre hasta que alguien la vea. */
export interface FirmaRechazada {
    id: string;
    workerName: string;
    targetTitle: string;
    motivo: string;
    en: string;
}

/** PIN equivocados seguidos, en este equipo, antes de borrar los vales de la persona. */
export const MAX_INTENTOS_EQUIPO = 5;

export interface Almacen {
    getItem(clave: string): string | null;
    setItem(clave: string, valor: string): void;
    removeItem(clave: string): void;
    readonly length: number;
    key(indice: number): string | null;
}

const PREFIJO_COLA = 'firmasPendientes:';
const PREFIJO_VALES = 'valesFirma:';
const PREFIJO_RECHAZADAS = 'firmasRechazadas:';
/** Claves anteriores, sin empresa. Ver `retirarClavesAnteriores`. */
const CLAVES_ANTERIORES = ['pendingOfflineSignatures', 'offlineVales'];

const porDefecto = (): Almacen => window.localStorage;

const leerJson = <T>(almacen: Almacen, clave: string): T[] => {
    try {
        const crudo = almacen.getItem(clave);
        const valor = crudo ? JSON.parse(crudo) : [];
        return Array.isArray(valor) ? valor : [];
    } catch {
        return [];
    }
};

const escribirJson = (almacen: Almacen, clave: string, valor: unknown[]): void => {
    try {
        if (valor.length === 0) almacen.removeItem(clave);
        else almacen.setItem(clave, JSON.stringify(valor));
    } catch {
        /* almacenamiento lleno o bloqueado */
    }
};

const clavesConPrefijo = (almacen: Almacen, prefijo: string): string[] => {
    const claves: string[] = [];
    for (let i = 0; i < almacen.length; i++) {
        const k = almacen.key(i);
        if (k && k.startsWith(prefijo)) claves.push(k);
    }
    return claves;
};

// ─── Cola ────────────────────────────────────────────────────────────────────

export const leerCola = (tenantId: string | null, almacen: Almacen = porDefecto()): FirmaPendiente[] =>
    tenantId ? leerJson<FirmaPendiente>(almacen, PREFIJO_COLA + tenantId).filter((f) => f.tenantId === tenantId) : [];

export const agregarACola = (firma: FirmaPendiente, almacen: Almacen = porDefecto()): boolean => {
    if (!firma.tenantId) return false;
    const cola = leerCola(firma.tenantId, almacen);
    if (cola.some((f) => f.id === firma.id)) return true;
    escribirJson(almacen, PREFIJO_COLA + firma.tenantId, [...cola, firma]);
    // Se relee: si el almacenamiento está lleno, la firma NO quedó guardada y
    // quien llama tiene que decirlo en vez de darla por tomada.
    return leerCola(firma.tenantId, almacen).some((f) => f.id === firma.id);
};

export const quitarDeCola = (tenantId: string, id: string, almacen: Almacen = porDefecto()): void => {
    escribirJson(almacen, PREFIJO_COLA + tenantId, leerCola(tenantId, almacen).filter((f) => f.id !== id));
};

// ─── Vales ───────────────────────────────────────────────────────────────────

const cantidadDe = (v: Partial<ValesDePersona>): number =>
    v && v.cifrado && Array.isArray(v.cifrado.vales) ? v.cifrado.vales.length : 0;

/**
 * Los vales vigentes de la empresa. Los vencidos se descartan (no sirven para una
 * firma nueva), y también los que no vienen cifrados: los de antes de cifrar.
 */
export const leerVales = (tenantId: string | null, almacen: Almacen = porDefecto(), ahora = Date.now()): ValesDePersona[] =>
    tenantId
        ? leerJson<ValesDePersona>(almacen, PREFIJO_VALES + tenantId)
            .filter((v) => new Date(v.expiraEn).getTime() > ahora && cantidadDe(v) > 0)
        : [];

const escribirVales = (tenantId: string, lista: ValesDePersona[], almacen: Almacen) =>
    escribirJson(almacen, PREFIJO_VALES + tenantId, lista.filter((v) => cantidadDe(v) > 0));

/** Reemplaza los vales de una persona en la empresa (los recién emitidos). */
export const guardarValesDe = (tenantId: string, entrada: ValesDePersona, almacen: Almacen = porDefecto()): void => {
    const lista = leerVales(tenantId, almacen).filter((v) => v.personaId !== entrada.personaId);
    escribirJson(almacen, PREFIJO_VALES + tenantId, [...lista, entrada]);
};

export type MotivoSinVale = 'sin_vales' | 'otra_obra' | 'pin_incorrecto' | 'bloqueado';

/**
 * Toma un vale de la persona para firmar algo de `obraId` (null si es de la
 * empresa), con su PIN, y lo quita del equipo: un vale, una firma.
 *
 * - Vales de otra obra: no toma ninguno (el servidor lo rechazaría al
 *   sincronizar y la firma se perdería; mejor decirlo en el momento).
 * - PIN que no pasa la comprobación: no hay firma, y cuenta. Al quinto seguido
 *   se borran los vales de la persona (`bloqueado`).
 * - PIN que pasa: el contador vuelve a cero y se entrega el vale descifrado.
 *
 * Derivar la llave tarda (PBKDF2): mientras tanto otra firma pudo tomar un vale,
 * o la persona pudo habilitarse de nuevo. Por eso, después de derivar, se relee
 * el almacenamiento y se escribe sin más esperas.
 */
export const tomarVale = async (
    tenantId: string | null,
    personaId: string,
    obraId: string | null,
    pin: string,
    almacen: Almacen = porDefecto(),
): Promise<{ vale: string } | { motivo: MotivoSinVale; quedan?: number }> => {
    if (!tenantId) return { motivo: 'sin_vales' };
    const antes = leerVales(tenantId, almacen).find((v) => v.personaId === personaId);
    if (!antes) return { motivo: 'sin_vales' };
    if (obraId && antes.obraId !== obraId) return { motivo: 'otra_obra' };

    let llave;
    try {
        llave = await abrirLlave(pin || '', antes.cifrado);
    } catch {
        return { motivo: 'sin_vales' };
    }

    // Desde aquí, sin esperas hasta escribir.
    const lista = leerVales(tenantId, almacen);
    const entrada = lista.find((v) => v.personaId === personaId);
    if (!entrada || entrada.cifrado.sal !== antes.cifrado.sal || cantidadDe(entrada) === 0) return { motivo: 'sin_vales' };

    if (!llave) {
        const fallos = (entrada.intentosFallidos || 0) + 1;
        if (fallos >= MAX_INTENTOS_EQUIPO) {
            escribirVales(tenantId, lista.filter((v) => v.personaId !== personaId), almacen);
            return { motivo: 'bloqueado' };
        }
        entrada.intentosFallidos = fallos;
        escribirVales(tenantId, lista, almacen);
        return { motivo: 'pin_incorrecto', quedan: MAX_INTENTOS_EQUIPO - fallos };
    }

    const cifrado = entrada.cifrado.vales.shift();
    entrada.intentosFallidos = 0;
    escribirVales(tenantId, lista, almacen);
    if (!cifrado) return { motivo: 'sin_vales' };
    return { vale: await descifrarVale(llave, cifrado) };
};

/**
 * Cuántos vales vigentes tiene la persona en el equipo. Con `obraId`, solo
 * cuentan si son de esa obra: los de otra obra no sirven para firmar ahí.
 */
export const valesDisponibles = (
    tenantId: string | null,
    personaId: string,
    almacen: Almacen = porDefecto(),
    obraId: string | null = null,
): number => {
    const entrada = leerVales(tenantId, almacen).find((v) => v.personaId === personaId);
    if (!entrada || (obraId && entrada.obraId !== obraId)) return 0;
    return cantidadDe(entrada);
};

/** Los vales vigentes de la persona en el equipo (cuántos, de qué obra, hasta cuándo), o null. */
export const valesDePersona = (tenantId: string | null, personaId: string, almacen: Almacen = porDefecto()): ResumenVales | null => {
    const v = leerVales(tenantId, almacen).find((x) => x.personaId === personaId);
    return v ? { personaId: v.personaId, obraId: v.obraId, expiraEn: v.expiraEn, cantidad: cantidadDe(v) } : null;
};

// ─── Firmas rechazadas al sincronizar ────────────────────────────────────────

/**
 * Una firma que el servidor rechazó (por ejemplo, la del 1 de 256 PIN
 * equivocados que pasa la comprobación) ya no se puede enviar. Se anota con el
 * nombre de la persona para que alguien le pida firmar de nuevo, y queda hasta
 * que alguien de la empresa lo vea. Como la cola, sobrevive al cierre de sesión.
 */
export const anotarRechazada = (tenantId: string, r: FirmaRechazada, almacen: Almacen = porDefecto()): void => {
    const lista = leerJson<FirmaRechazada>(almacen, PREFIJO_RECHAZADAS + tenantId).filter((x) => x.id !== r.id);
    escribirJson(almacen, PREFIJO_RECHAZADAS + tenantId, [...lista, r]);
};

export const leerRechazadas = (tenantId: string | null, almacen: Almacen = porDefecto()): FirmaRechazada[] =>
    tenantId ? leerJson<FirmaRechazada>(almacen, PREFIJO_RECHAZADAS + tenantId) : [];

export const olvidarRechazadas = (tenantId: string, almacen: Almacen = porDefecto()): void => {
    try { almacen.removeItem(PREFIJO_RECHAZADAS + tenantId); } catch { /* sin almacenamiento */ }
};

/** "Cerrar sesión" explícito: se borran los vales de todas las empresas. La cola NO. */
export const borrarTodosLosVales = (almacen: Almacen = porDefecto()): void => {
    for (const k of clavesConPrefijo(almacen, PREFIJO_VALES)) almacen.removeItem(k);
};

// ─── Resumen del equipo y claves anteriores ──────────────────────────────────

/** Cuánto hay en el equipo, en todas las empresas: para avisar antes de cerrar sesión. */
export const resumenDelEquipo = (almacen: Almacen = porDefecto(), ahora = Date.now()): { vales: number; firmas: number } => {
    let vales = 0;
    let firmas = 0;
    for (const k of clavesConPrefijo(almacen, PREFIJO_VALES)) {
        vales += leerJson<ValesDePersona>(almacen, k)
            .filter((v) => new Date(v.expiraEn).getTime() > ahora)
            .reduce((n, v) => n + cantidadDe(v), 0);
    }
    for (const k of clavesConPrefijo(almacen, PREFIJO_COLA)) firmas += leerJson(almacen, k).length;
    return { vales, firmas };
};

/**
 * Quita las claves de antes de separar por empresa. Lo que pudiera quedar en
 * ellas ya no se puede sincronizar: la firma sin conexión nunca se habilitó en
 * una pantalla, y los vales que se emitieron en pruebas vencieron hace más de los
 * 30 días que el servidor acepta (al 7 de noviembre de 2026 no queda ningún vale
 * en ningún ambiente).
 */
export const retirarClavesAnteriores = (almacen: Almacen = porDefecto()): void => {
    for (const k of CLAVES_ANTERIORES) {
        try { almacen.removeItem(k); } catch { /* sin almacenamiento */ }
    }
    // Vales en claro (de antes de cifrar con el PIN, solo existieron en dev):
    // se descartan. Nunca se cifran después: no hay PIN con qué hacerlo.
    for (const k of clavesConPrefijo(almacen, PREFIJO_VALES)) {
        const lista = leerJson<Record<string, unknown>>(almacen, k);
        const cifrados = lista.filter((v) => v && typeof v === 'object' && 'cifrado' in v && !('vales' in v));
        if (cifrados.length !== lista.length) escribirJson(almacen, k, cifrados);
    }
};

/** Identificador de una firma en el equipo. */
export const nuevoIdFirma = (): string => {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `firma_${crypto.randomUUID()}`;
    } catch { /* sin crypto */ }
    return `firma_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
};
