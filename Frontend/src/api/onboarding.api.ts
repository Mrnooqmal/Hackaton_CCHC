import { apiRequest } from './client';

/**
 * Alta de una empresa con licencia de un solo uso.
 *
 * Las dos rutas son públicas y no llevan sesión: quien las usa todavía no puede
 * tenerla, porque su empresa no existe. La credencial es el token del enlace que
 * le llegó por correo.
 */

export interface LicenciaValida {
    valida: true;
    /** Fijado al emitir la licencia. El formulario lo muestra y NO lo deja editar. */
    email: string;
    prellenado: {
        nombre: string | null;
        rutEmpresa: string | null;
    };
    expiraEn: string;
}

export interface OnboardingData {
    token: string;
    empresa: {
        nombre: string;
        rutEmpresa: string;
    };
    admin: {
        rut: string;
        nombre: string;
        apellidoPaterno: string;
        apellidoMaterno: string;
        password: string;
        confirmarPassword: string;
    };
}

export interface OnboardingResultado {
    message: string;
    empresa: { nombre: string; rutEmpresa: string };
    administrador: { rut: string; email: string };
}

export const onboardingApi = {
    /** Devuelve solo lo necesario para dibujar el formulario. */
    validarLicencia: (token: string) =>
        apiRequest<LicenciaValida>(`/onboarding/licencia/${encodeURIComponent(token)}`),

    /**
     * Crea la empresa y su administrador, y consume la licencia.
     *
     * No devuelve sesión a propósito: la primera se abre en el login, con la
     * contraseña que la persona acaba de elegir.
     */
    completar: (data: OnboardingData) =>
        apiRequest<OnboardingResultado>('/onboarding/completar', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
};
