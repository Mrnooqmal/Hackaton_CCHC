const MB = 1024 * 1024;

export const tamanoLegible = (bytes: number) => (bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export const fechaCorta = (aaaammdd: string) => {
    const [a, m, d] = aaaammdd.split('-').map(Number);
    return a && m && d ? new Date(a, m - 1, d).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : aaaammdd;
};
