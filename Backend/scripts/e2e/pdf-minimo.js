/**
 * PDF de una página, armado a mano, para los datos de ejemplo de dev.
 *
 * ── Por qué a mano, y no con una librería ────────────────────────────────────
 *
 * El backend no tiene ninguna dependencia para generar PDF (`PdfStampingService`
 * estampa anexos sobre un PDF que ya existe) y sumar una para sembrar datos de
 * prueba sería cargar el paquete de producción con algo que solo usa un script
 * de dev. Un PDF de una página con una línea de texto son cuarenta líneas de
 * código y cero dependencias.
 *
 * El archivo tiene que ser un PDF de verdad, no un archivo con otro nombre: el
 * documento se abre desde la aplicación, y un adjunto roto se confunde con un
 * error del visor. Lleva su tabla `xref` con los desplazamientos correctos, que
 * es lo que un lector estricto necesita.
 */

/** Escapa lo que no puede ir crudo dentro de una cadena literal de PDF. */
const escapar = (t) => String(t).replace(/([\\()])/g, '\\$1');

/**
 * Las fuentes base de PDF usan Latin-1, así que los acentos se escriben como
 * octales de un byte. Lo que no entra en Latin-1 se reemplaza, en vez de salir
 * como basura en la página.
 */
const aLatin1 = (t) => [...String(t)].map((c) => {
    const n = c.codePointAt(0);
    if (n < 128) return c;
    if (n <= 255) return `\\${n.toString(8).padStart(3, '0')}`;
    return '?';
}).join('');

/**
 * @param {string} titulo línea principal, en grande.
 * @param {string[]} lineas líneas siguientes, en cuerpo chico.
 * @returns {Buffer} el PDF completo.
 */
function pdfDeUnaPagina(titulo, lineas = []) {
    const texto = [
        'BT /F1 15 Tf 56 772 Td (' + aLatin1(escapar(titulo)) + ') Tj ET',
        ...lineas.map((l, i) => `BT /F1 10 Tf 56 ${740 - i * 16} Td (${aLatin1(escapar(l))}) Tj ET`),
    ].join('\n');

    const objetos = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
            + '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        `<< /Length ${Buffer.byteLength(texto, 'latin1')} >>\nstream\n${texto}\nendstream`,
    ];

    let cuerpo = '%PDF-1.4\n';
    const desplazamientos = [];
    objetos.forEach((o, i) => {
        desplazamientos.push(Buffer.byteLength(cuerpo, 'latin1'));
        cuerpo += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });

    const inicioXref = Buffer.byteLength(cuerpo, 'latin1');
    // La entrada cero es obligatoria y siempre libre.
    let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
    for (const d of desplazamientos) xref += `${String(d).padStart(10, '0')} 00000 n \n`;

    const cola = `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\n`
        + `startxref\n${inicioXref}\n%%EOF\n`;

    return Buffer.from(cuerpo + xref + cola, 'latin1');
}

module.exports = { pdfDeUnaPagina };
