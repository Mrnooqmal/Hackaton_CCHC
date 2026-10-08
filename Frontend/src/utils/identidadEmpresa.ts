/**
 * Identidad visual de la empresa (logo y color principal): lo que comparten
 * Mi Empresa y el alta por onboarding.
 */

// Paleta sugerida: colores de marca legibles con texto blanco (contraste AA ≥ 4.5).
export const SUGGESTED_COLORS = [
    { hex: '#006edc', label: 'Azul CChC' },
    { hex: '#df3601', label: 'Naranja' },
    { hex: '#c81e1e', label: 'Rojo' },
    { hex: '#047857', label: 'Verde' },
    { hex: '#7c3aed', label: 'Violeta' },
    { hex: '#b45309', label: 'Ámbar' },
    { hex: '#0e7490', label: 'Cian' },
];

/** Máximo que acepta el servidor para el logo. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Reduce el logo a 120 px de alto (lo que ocupa en el header) y lo pasa a PNG. */
export function compressLogo(dataUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const MAX_H = 120;
            const scale = Math.min(1, MAX_H / img.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

// Cada empresa se reconoce por un monograma de color estable (derivado de su
// id): el login todavía no conoce su logo, pero sí puede distinguirlas.
const MONOGRAMA_COLORES = ['#003b75', '#0f766e', '#9a3412', '#5b21b6', '#1e40af', '#166534'];
const SUFIJOS_SOCIETARIOS = new Set(['spa', 'ltda', 'sa', 's.a.', 'eirl', 'limitada']);

export function monograma(nombre: string): string {
    const palabras = nombre.split(/\s+/).filter((w) => w && !SUFIJOS_SOCIETARIOS.has(w.toLowerCase()));
    return (palabras.slice(0, 2).map((w) => w[0]).join('') || nombre.slice(0, 2)).toUpperCase();
}

export function colorMonograma(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return MONOGRAMA_COLORES[h % MONOGRAMA_COLORES.length];
}
