/**
 * PdfStampingService
 *
 * Genera la versión "legalmente estampada" de un documento: toma el PDF
 * original (inmutable, tal como se subió) y le agrega un anexo de páginas al
 * final con el registro de firmas, agrupado por rol (trabajador / supervisor
 * / relator / etc). El PDF original nunca se modifica in-place; el anexo se
 * reconstruye completo cada vez a partir del array de firmas vigente.
 */

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../clients/s3');

const PAGE_SIZE = [595.28, 841.89]; // A4 en puntos
const MARGIN = 50;
const LINE_HEIGHT = 16;

const ROL_LABELS = {
    trabajador: 'Trabajadores',
    supervisor: 'Supervisores',
    relator: 'Relatores',
    documento: 'Firmantes',
    enrolamiento: 'Enrolamiento',
};

function labelPorRol(tipoFirma) {
    return ROL_LABELS[tipoFirma] || (tipoFirma ? tipoFirma[0].toUpperCase() + tipoFirma.slice(1) : 'Firmantes');
}

/** Agrupa firmas por tipoFirma, preservando el orden de aparición de cada grupo. */
function agruparPorRol(firmas) {
    const grupos = new Map();
    for (const firma of firmas) {
        const rol = firma.tipoFirma || 'documento';
        if (!grupos.has(rol)) grupos.set(rol, []);
        grupos.get(rol).push(firma);
    }
    return grupos;
}

class PdfStampingService {
    static async descargarOriginal(bucket, s3Key) {
        const result = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
        const chunks = [];
        for await (const chunk of result.Body) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }

    static async subirEstampado(bucket, s3Key, bytes) {
        await s3Client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: s3Key,
            Body: bytes,
            ContentType: 'application/pdf',
        }));
    }

    /**
     * Agrega al PDF un anexo "Registro de Firmas" agrupado por rol.
     *
     * @param {Buffer} pdfOriginalBytes - bytes del PDF original sin modificar
     * @param {Array} firmas - array de firmas embebidas del documento (ver
     *   FirmaService.toDocumentFirmaFormat), ya cargado fresco desde la BD
     * @param {Object} meta - { titulo } del documento, para el encabezado del anexo
     * @returns {Promise<Uint8Array>} bytes del PDF con el anexo agregado
     */
    static async estamparAnexo(pdfOriginalBytes, firmas, meta = {}) {
        const pdfDoc = await PDFDocument.load(pdfOriginalBytes);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        let page = pdfDoc.addPage(PAGE_SIZE);
        let y = PAGE_SIZE[1] - MARGIN;

        const nuevaPagina = () => {
            page = pdfDoc.addPage(PAGE_SIZE);
            y = PAGE_SIZE[1] - MARGIN;
        };

        const asegurarEspacio = (lineasRequeridas = 1) => {
            if (y - lineasRequeridas * LINE_HEIGHT < MARGIN) {
                nuevaPagina();
            }
        };

        page.drawText('Registro de Firmas Digitales', {
            x: MARGIN, y, size: 16, font: fontBold, color: rgb(0, 0, 0),
        });
        y -= LINE_HEIGHT * 1.5;

        if (meta.titulo) {
            page.drawText(`Documento: ${meta.titulo}`, { x: MARGIN, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
            y -= LINE_HEIGHT;
        }
        page.drawText(`Total de firmas: ${firmas.length}`, { x: MARGIN, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
        y -= LINE_HEIGHT * 1.5;

        const grupos = agruparPorRol(firmas);
        for (const [rol, firmasDelRol] of grupos) {
            asegurarEspacio(3);
            page.drawText(labelPorRol(rol), { x: MARGIN, y, size: 12, font: fontBold });
            y -= LINE_HEIGHT;

            page.drawText('Nombre', { x: MARGIN, y, size: 9, font: fontBold });
            page.drawText('RUT', { x: MARGIN + 180, y, size: 9, font: fontBold });
            page.drawText('Fecha / Hora', { x: MARGIN + 280, y, size: 9, font: fontBold });
            page.drawText('Método', { x: MARGIN + 400, y, size: 9, font: fontBold });
            y -= LINE_HEIGHT;

            for (const firma of firmasDelRol) {
                asegurarEspacio(1);
                page.drawText(String(firma.nombre || '').slice(0, 30), { x: MARGIN, y, size: 9, font });
                page.drawText(String(firma.rut || ''), { x: MARGIN + 180, y, size: 9, font });
                page.drawText(`${firma.fecha || ''} ${firma.horario || ''}`, { x: MARGIN + 280, y, size: 9, font });
                page.drawText(String(firma.tipoFirma || ''), { x: MARGIN + 400, y, size: 9, font });
                y -= LINE_HEIGHT;

                asegurarEspacio(1);
                page.drawText(`Token: ${firma.token || ''}`, { x: MARGIN + 15, y, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
                y -= LINE_HEIGHT * 0.9;
            }
            y -= LINE_HEIGHT * 0.5;
        }

        return pdfDoc.save();
    }
}

module.exports = { PdfStampingService };
