/**
 * Texto de un archivo, para leerlo en voz alta.
 *
 * Las empresas suben cualquier formato, así que esto decide por formato qué se
 * puede hacer y lo dice claro cuando no se puede:
 *
 *   - PDF con texto        → se extrae directo (unpdf, sin costo).
 *   - PDF escaneado        → `{ ocr: 'pdf' }`: quien llama lo manda a Textract.
 *   - JPG / PNG            → `{ ocr: 'imagen' }`: Textract, en el momento.
 *   - Word (.docx)         → mammoth.
 *   - Lo demás (.doc, Excel, etc.) → `{ noDisponible }`, con el motivo para la
 *     pantalla. Una planilla leída en voz alta ("B3, 45, C3…") no le sirve a
 *     nadie.
 *
 * Se lee el texto LITERAL, sin resumir ni "simplificar": la firma acredita que
 * la persona conoció ese documento, y lo que escucha tiene que ser lo que firma.
 */

const MOTIVOS = {
    formato: 'Este formato no se puede leer en voz alta. Súbelo en PDF o Word.',
    sinTexto: 'No se encontró texto para leer en este archivo.',
    muyLargo: 'El documento es demasiado largo para leerlo en voz alta.',
    ilegible: 'No se pudo abrir el archivo para leerlo.',
};

// ~150.000 caracteres son unas dos horas de audio: un reglamento interno
// completo cabe; un anexo de 300 páginas no tiene sentido escucharlo.
const MAX_CARACTERES = 150_000;

const extension = (clave) => (String(clave || '').split('?')[0].split('.').pop() || '').toLowerCase();

/**
 * Deja el texto listo para la voz: une las palabras cortadas al final de línea
 * ("preven-\nción"), quita las líneas que son solo un número de página y junta
 * los espacios.
 */
function limpiar(texto) {
    return String(texto || '')
        .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2')
        .split('\n')
        .filter((l) => !/^\s*(p[áa]gina\s*)?\d+(\s*(de|\/)\s*\d+)?\s*$/i.test(l))
        .join('\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Lo que se devuelve cuando ya hay texto: limpio, y rechazado si está vacío o es muy largo. */
function resultadoDeTexto(bruto) {
    const texto = limpiar(bruto);
    if (texto.replace(/\s/g, '').length < 3) return { noDisponible: MOTIVOS.sinTexto };
    if (texto.length > MAX_CARACTERES) return { noDisponible: MOTIVOS.muyLargo };
    return { texto };
}

/**
 * @param {Buffer} bytes
 * @param {string} clave - clave de S3 del archivo; de ahí sale la extensión.
 * @returns {Promise<{ texto: string } | { ocr: 'pdf' | 'imagen' } | { noDisponible: string }>}
 */
async function extraer(bytes, clave) {
    const ext = extension(clave);
    try {
        if (ext === 'pdf') {
            // ESM: desde CommonJS solo entra con import dinámico.
            const { extractText, getDocumentProxy } = await import('unpdf');
            const pdf = await getDocumentProxy(new Uint8Array(bytes));
            const { text } = await extractText(pdf, { mergePages: false });
            const bruto = (text || []).join('\n\n');
            // Un PDF escaneado trae páginas sin texto: imágenes. Se considera
            // escaneado si casi no hay letras por página.
            const letras = bruto.replace(/\s/g, '').length;
            if (letras < 20 * Math.max(1, (text || []).length)) return { ocr: 'pdf' };
            return resultadoDeTexto(bruto);
        }
        if (ext === 'docx') {
            const mammoth = require('mammoth');
            const { value } = await mammoth.extractRawText({ buffer: bytes });
            return resultadoDeTexto(value);
        }
        // Textract acepta JPEG y PNG (y TIFF, que no se sube).
        if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return { ocr: 'imagen' };
    } catch (err) {
        console.error('[lectura] No se pudo extraer el texto:', err?.name || err);
        return { noDisponible: MOTIVOS.ilegible };
    }
    return { noDisponible: MOTIVOS.formato };
}

/**
 * Texto de las líneas que devolvió Textract, en orden. Las páginas se separan
 * con una línea en blanco para que la voz haga una pausa.
 */
function textoDeTextract(bloques) {
    const lineas = [];
    let pagina = null;
    for (const b of bloques || []) {
        if (b.BlockType !== 'LINE' || !b.Text) continue;
        if (pagina !== null && b.Page !== pagina) lineas.push('');
        pagina = b.Page ?? pagina;
        lineas.push(b.Text);
    }
    return resultadoDeTexto(lineas.join('\n'));
}

/**
 * Corta el texto en trozos de hasta `max` caracteres, por oración si se puede:
 * Polly acepta 3.000 por llamada, y un corte a media palabra se escucha.
 */
function trocear(texto, max = 2800) {
    const trozos = [];
    let actual = '';
    const empujar = () => { if (actual.trim()) trozos.push(actual.trim()); actual = ''; };
    const oraciones = texto.match(/[^.!?;:\n]+[.!?;:\n]*\s*/g) || [texto];
    for (let o of oraciones) {
        while (o.length > max) {
            // Una "oración" sin puntos más larga que el máximo: se corta en el
            // último espacio que cabe.
            empujar();
            const corte = o.lastIndexOf(' ', max) > max / 2 ? o.lastIndexOf(' ', max) : max;
            trozos.push(o.slice(0, corte).trim());
            o = o.slice(corte);
        }
        if (actual.length + o.length > max) empujar();
        actual += o;
    }
    empujar();
    return trozos;
}

module.exports = { extraer, textoDeTextract, trocear, limpiar, extension, MOTIVOS, MAX_CARACTERES };
