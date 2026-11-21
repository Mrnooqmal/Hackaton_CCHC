export interface DatosAcceso {
    tieneAccesoWeb?: boolean;
    activacionPendiente?: boolean;
    passwordTemporal?: boolean;
    passwordTemporalVence?: string | null;
}

export type EstadoAcceso = 'sin-acceso' | 'pendiente' | 'temporal-vigente' | 'temporal-vencida' | 'activo';

export const pendienteDeActivacion = (p: DatosAcceso): boolean =>
    Boolean(p.activacionPendiente) || (Boolean(p.passwordTemporal) && !p.passwordTemporalVence);

export function estadoAcceso(p: DatosAcceso, ahora: Date = new Date()): EstadoAcceso {
    if (!p.tieneAccesoWeb) return 'sin-acceso';
    if (!pendienteDeActivacion(p)) return 'activo';
    if (!p.passwordTemporal || !p.passwordTemporalVence) return 'pendiente';
    return new Date(p.passwordTemporalVence).getTime() > ahora.getTime() ? 'temporal-vigente' : 'temporal-vencida';
}

export const horaCorta = (iso: string): string =>
    new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

export function textoEstadoAcceso(p: DatosAcceso, ahora: Date = new Date()): string {
    switch (estadoAcceso(p, ahora)) {
        case 'sin-acceso': return 'Sin acceso a la plataforma.';
        case 'activo': return 'Activo: eligió su contraseña.';
        case 'pendiente': return 'Pendiente de activación. No puede entrar hasta que se active su acceso.';
        case 'temporal-vigente': return `Activado: su contraseña temporal vence a las ${horaCorta(p.passwordTemporalVence as string)}. Debe entrar y elegir su contraseña antes.`;
        case 'temporal-vencida': return 'La contraseña temporal venció sin usarse. Hay que activar su acceso de nuevo.';
    }
}
