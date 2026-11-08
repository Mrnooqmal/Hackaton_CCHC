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
 * Funciones puras sobre un almacenamiento (por omisión `localStorage`) para que
 * se puedan probar sin navegador (Backend/tests/cola-firmas.test.js).
 */

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
    vales: string[];
    expiraEn: string;
}

export interface Almacen {
    getItem(clave: string): string | null;
    setItem(clave: string, valor: string): void;
    removeItem(clave: string): void;
    readonly length: number;
    key(indice: number): string | null;
}

const PREFIJO_COLA = 'firmasPendientes:';
const PREFIJO_VALES = 'valesFirma:';
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

/** Los vales vigentes de la empresa. Los vencidos se descartan: no sirven para una firma nueva. */
export const leerVales = (tenantId: string | null, almacen: Almacen = porDefecto(), ahora = Date.now()): ValesDePersona[] =>
    tenantId
        ? leerJson<ValesDePersona>(almacen, PREFIJO_VALES + tenantId)
            .filter((v) => new Date(v.expiraEn).getTime() > ahora && Array.isArray(v.vales) && v.vales.length > 0)
        : [];

/** Reemplaza los vales de una persona en la empresa (los recién emitidos). */
export const guardarValesDe = (tenantId: string, entrada: ValesDePersona, almacen: Almacen = porDefecto()): void => {
    const lista = leerVales(tenantId, almacen).filter((v) => v.personaId !== entrada.personaId);
    escribirJson(almacen, PREFIJO_VALES + tenantId, [...lista, entrada]);
};

/** Toma un vale de la persona y lo quita del equipo: un vale, una firma. */
export const tomarVale = (tenantId: string | null, personaId: string, almacen: Almacen = porDefecto()): string | null => {
    if (!tenantId) return null;
    const lista = leerVales(tenantId, almacen);
    const entrada = lista.find((v) => v.personaId === personaId);
    if (!entrada || entrada.vales.length === 0) return null;
    const vale = entrada.vales.shift() as string;
    escribirJson(almacen, PREFIJO_VALES + tenantId, lista.filter((v) => v.vales.length > 0));
    return vale;
};

export const valesDisponibles = (tenantId: string | null, personaId: string, almacen: Almacen = porDefecto()): number =>
    leerVales(tenantId, almacen).find((v) => v.personaId === personaId)?.vales.length ?? 0;

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
            .reduce((n, v) => n + (Array.isArray(v.vales) ? v.vales.length : 0), 0);
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
};

/** Identificador de una firma en el equipo. */
export const nuevoIdFirma = (): string => {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `firma_${crypto.randomUUID()}`;
    } catch { /* sin crypto */ }
    return `firma_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
};
