import jsPDF from 'jspdf';
import type { NewSignature } from '../api/client';

const NAVY: [number, number, number] = [0, 40, 85];
const INK: [number, number, number] = [17, 17, 17];
const MUTED: [number, number, number] = [110, 110, 110];
const LINE: [number, number, number] = [220, 224, 230];
const SOFT: [number, number, number] = [244, 246, 249];
const OK: [number, number, number] = [22, 128, 61];
const WARN: [number, number, number] = [180, 83, 9];

const ESTADO_LABEL: Record<string, string> = {
    valida: 'Firma válida',
    disputada: 'Firma disputada',
    revocada: 'Firma revocada',
    pendiente: 'Firma pendiente',
};

const fechaHora = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const fecha = d.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
    const hora = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    return `${fecha} a las ${hora}`;
};

export interface DatosComprobante {
    firma: NewSignature;
    titulo: string;
    tipo: string;
    solicitante: string | null;
    /** Nombre a usar si la firma no trae el del firmante (p. ej. la sesión actual). */
    firmanteRespaldo?: string | null;
}

/**
 * Comprobante de firma electrónica en PDF. Se arma en el cliente con los mismos
 * datos que el detalle del historial: no hay un endpoint que emita la
 * constancia, y no se agrega nada que el backend no haya devuelto ya.
 */
export function construirComprobanteFirmaPdf({ firma, titulo, tipo, solicitante, firmanteRespaldo }: DatosComprobante): jsPDF {
    const doc = new jsPDF();
    const W = doc.internal.pageSize.width;
    const H = doc.internal.pageSize.height;
    const M = 20;
    const ancho = W - M * 2;

    // ── Cabecera ──
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 34, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Comprobante de firma electrónica', M, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text('Constancia de firma registrada en Build & Serve', M, 24);

    let y = 50;

    // ── Documento firmado ──
    doc.setTextColor(...MUTED);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text('DOCUMENTO FIRMADO', M, y);
    y += 7;
    doc.setTextColor(...INK);
    doc.setFontSize(14);
    const lineasTitulo = doc.splitTextToSize(titulo || 'Documento', ancho) as string[];
    doc.text(lineasTitulo, M, y);
    y += lineasTitulo.length * 6.5 + 2;

    // Estado
    const estado = firma.estado || 'valida';
    const color = estado === 'valida' ? OK : WARN;
    doc.setFontSize(9.5);
    doc.setTextColor(...color);
    doc.setDrawColor(...color);
    doc.setLineWidth(0.6);
    if (estado === 'valida') {
        // Visto bueno dibujado: la fuente estándar no trae el carácter ✓.
        doc.lines([[1.4, 1.6], [3, -3.6]], M, y - 1.4);
    } else {
        doc.circle(M + 2, y - 1.2, 1.6, 'S');
    }
    doc.text(ESTADO_LABEL[estado] || estado, M + 6, y);
    y += 10;

    // ── Datos ──
    const firmante = firma.workerNombre || firmanteRespaldo || '—';
    const filas: [string, string][] = [
        ['Firmante', firma.workerRut ? `${firmante} · RUT ${firma.workerRut}` : firmante],
        ['Fecha y hora', fechaHora(firma.timestamp || firma.createdAt)],
        ['Tipo', tipo || '—'],
        ['Solicitado por', solicitante || '—'],
        ['Método de validación', firma.metodoValidacion || 'PIN'],
    ];
    if (firma.ipAddress) filas.push(['Dirección IP', firma.ipAddress]);

    const colEtiqueta = 48;
    const altoFila = 10;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, y, W - M, y);
    filas.forEach(([etiqueta, valor]) => {
        const lineas = doc.splitTextToSize(valor, ancho - colEtiqueta) as string[];
        const alto = Math.max(altoFila, lineas.length * 5 + 5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...MUTED);
        doc.text(etiqueta, M, y + 6.5);
        doc.setFontSize(10);
        doc.setTextColor(...INK);
        doc.text(lineas, M + colEtiqueta, y + 6.5);
        y += alto;
        doc.line(M, y, W - M, y);
    });

    // ── Token de verificación ──
    y += 10;
    doc.setFillColor(...SOFT);
    doc.setDrawColor(...LINE);
    doc.roundedRect(M, y, ancho, 26, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text('TOKEN DE VERIFICACIÓN', M + 6, y + 8);
    doc.setFont('courier', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(firma.token || '—', M + 6, y + 17);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`ID de firma: ${firma.signatureId}`, M + 6, y + 22.5);
    y += 34;

    doc.setFontSize(8.5);
    const nota = doc.splitTextToSize(
        'Este comprobante resume una firma electrónica registrada de forma inmutable en la plataforma. '
        + 'El token de verificación permite a la empresa o a la autoridad fiscalizadora comprobar su autenticidad.',
        ancho,
    ) as string[];
    doc.text(nota, M, y);

    // ── Pie ──
    doc.setDrawColor(...LINE);
    doc.line(M, H - 18, W - M, H - 18);
    doc.setFontSize(7.5);
    doc.text(`Generado el ${fechaHora(new Date().toISOString())}`, M, H - 12);
    doc.text('Build & Serve', W - M, H - 12, { align: 'right' });

    return doc;
}

export function descargarComprobanteFirma(datos: DatosComprobante): void {
    construirComprobanteFirmaPdf(datos).save(`comprobante-firma-${datos.firma.token || datos.firma.signatureId}.pdf`);
}
