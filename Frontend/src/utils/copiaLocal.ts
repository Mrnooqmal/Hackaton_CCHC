/**
 * Copias locales de lo que hace falta para firmar sin red.
 *
 * La app abre sin señal (el service worker sirve la aplicación), pero las
 * pantallas piden sus datos a la API: sin red, la lista de actividades del día o
 * los documentos por firmar salían vacíos, y no había qué firmar aunque hubiera
 * vales. Al cargar con señal se guarda una copia; sin señal se muestra la copia,
 * diciendo de cuándo es.
 *
 * - Por empresa (`copiaLocal:<empresa>:<clave>`), como la cola de firmas.
 * - Solo lo que la pantalla necesita para firmar: quien la guarda elige los
 *   campos (nunca RUT, correo ni datos de salud).
 * - Se borra con el "Cerrar sesión" explícito, igual que los vales.
 */

const PREFIJO = 'copiaLocal:';

const empresa = (): string | null => {
    try { return localStorage.getItem('tenant_id'); } catch { return null; }
};

export const guardarCopia = (clave: string, datos: unknown): void => {
    const tenantId = empresa();
    if (!tenantId) return;
    try {
        localStorage.setItem(`${PREFIJO}${tenantId}:${clave}`, JSON.stringify({ guardadaEn: new Date().toISOString(), datos }));
    } catch {
        /* almacenamiento lleno o bloqueado: sin copia, sin red no habrá datos */
    }
};

export const leerCopia = <T>(clave: string): { guardadaEn: string; datos: T } | null => {
    const tenantId = empresa();
    if (!tenantId) return null;
    try {
        const crudo = localStorage.getItem(`${PREFIJO}${tenantId}:${clave}`);
        return crudo ? JSON.parse(crudo) : null;
    } catch {
        return null;
    }
};

/** "Cerrar sesión" explícito: todas las copias, de todas las empresas. */
export const borrarCopias = (): void => {
    try {
        const claves: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(PREFIJO)) claves.push(k);
        }
        claves.forEach((k) => localStorage.removeItem(k));
    } catch {
        /* sin almacenamiento */
    }
};

/** "a las 08:15" de una copia, para decir de cuándo es lo que se muestra. */
export const deCuando = (iso: string): string => {
    try { return new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; }
};
