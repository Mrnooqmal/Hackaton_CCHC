/**
 * Copia mínima del usuario, para que la app siga abierta sin señal.
 *
 * Sin red nunca se cierra la sesión: `/auth/me` no se puede consultar, y antes eso
 * borraba el token. Recargar la página en modo avión dejaba a la persona fuera, sin
 * poder entrar ni firmar. Solo el servidor puede decir que una sesión terminó.
 *
 * Solo lo que las pantallas necesitan para firmar y mostrar el menú: nada de RUT,
 * correo, teléfono ni salud. Se borra con la sesión.
 */
const CLAVE = 'sesionLocal';
const CAMPOS = ['personaId', 'userId', 'tenantId', 'empresaId', 'nombre', 'apellido', 'apellidoPaterno', 'rol', 'permisos', 'cargo',
    'obraIds', 'asignaciones', 'habilitado', 'pinConfigurado', 'passwordTemporal', 'empresaNombre'];

export const guardarSesionLocal = (user: unknown): void => {
    try {
        const u = (user || {}) as Record<string, unknown>;
        const copia = Object.fromEntries(CAMPOS.filter((c) => u[c] !== undefined).map((c) => [c, u[c]]));
        localStorage.setItem(CLAVE, JSON.stringify(copia));
    } catch { /* sin almacenamiento */ }
};

export const leerSesionLocal = <T>(): T | null => {
    try {
        const crudo = localStorage.getItem(CLAVE);
        return crudo ? JSON.parse(crudo) as T : null;
    } catch {
        return null;
    }
};

export const borrarSesionLocal = (): void => {
    try { localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ }
};
