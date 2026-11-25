export interface DatosAcceso {
    tieneAccesoWeb?: boolean;
    activacionPendiente?: boolean;
    credencialInicial?: boolean;
    passwordTemporal?: boolean;
    passwordTemporalVence?: string | null;
}

export type EstadoAcceso =
    | 'sin-acceso'
    | 'pendiente'
    | 'inicial-vigente'
    | 'inicial-vencida'
    | 'temporal-vigente'
    | 'temporal-vencida'
    | 'restablecida-vigente'
    | 'restablecida-vencida'
    | 'activo';

export const pendienteDeActivacion = (p: DatosAcceso): boolean =>
    Boolean(p.activacionPendiente) || (Boolean(p.passwordTemporal) && !p.passwordTemporalVence);

export function estadoAcceso(p: DatosAcceso, ahora: Date = new Date()): EstadoAcceso {
    if (!p.tieneAccesoWeb) return 'sin-acceso';
    if (!pendienteDeActivacion(p)) {
        if (!p.passwordTemporal || !p.passwordTemporalVence) return 'activo';
        return new Date(p.passwordTemporalVence).getTime() > ahora.getTime() ? 'restablecida-vigente' : 'restablecida-vencida';
    }
    if (!p.passwordTemporal || !p.passwordTemporalVence) return 'pendiente';
    const vigente = new Date(p.passwordTemporalVence).getTime() > ahora.getTime();
    if (p.credencialInicial) return vigente ? 'inicial-vigente' : 'inicial-vencida';
    return vigente ? 'temporal-vigente' : 'temporal-vencida';
}

export const reactivable = (estado: EstadoAcceso): boolean =>
    estado === 'pendiente' || estado === 'inicial-vigente' || estado === 'inicial-vencida' || estado === 'temporal-vencida';

export const horaCorta = (iso: string): string =>
    new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

export const fechaCorta = (iso: string): string =>
    new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });

export function textoEstadoAcceso(p: DatosAcceso, ahora: Date = new Date()): string {
    switch (estadoAcceso(p, ahora)) {
        case 'sin-acceso': return 'Sin acceso a la plataforma.';
        case 'activo': return 'Activo: eligió su contraseña.';
        case 'pendiente': return 'Pendiente de activación. No puede entrar hasta que se active o se reactive su acceso.';
        case 'inicial-vigente': return `Todavía no entra. Puede entrar con los cuatro primeros dígitos de su RUT hasta el ${fechaCorta(p.passwordTemporalVence as string)} (7 días desde el registro o la última reactivación).`;
        case 'inicial-vencida': return 'Pasaron 7 días sin que entrara y su contraseña inicial venció. Reactiva su acceso inicial o actívalo en terreno.';
        case 'temporal-vigente': return `Activado: su contraseña temporal vence a las ${horaCorta(p.passwordTemporalVence as string)}. Debe entrar y elegir su contraseña antes.`;
        case 'temporal-vencida': return 'La contraseña temporal venció sin usarse. Activa su acceso de nuevo o reactiva su acceso inicial.';
        case 'restablecida-vigente': return `Su contraseña fue restablecida: la temporal vence el ${fechaCorta(p.passwordTemporalVence as string)} a las ${horaCorta(p.passwordTemporalVence as string)}. Al entrar con ella elige una nueva.`;
        case 'restablecida-vencida': return 'La contraseña temporal del restablecimiento venció sin usarse. Restablécela de nuevo.';
    }
}
