/**
 * El único escapado de HTML del backend.
 *
 * Todo texto que venga de una persona —nombres, descripciones de incidentes,
 * motivos, nombres de empresa, correos— y termine dentro de HTML pasa por acá:
 * informes que se guardan en S3 como evidencia, exportes que el navegador abre
 * con el origen de la aplicación y correos de SES.
 *
 * Escapa los cinco caracteres con significado en HTML, incluidas las dos
 * comillas, así que sirve igual dentro de texto que dentro de un atributo entre
 * comillas (`href="${escaparHtml(url)}"`). No sirve para meter texto dentro de
 * `<script>`, de `style` ni de una URL sin comillas: ahí no se interpola texto
 * de usuario, y la prueba `html-sin-escapar.test.js` vigila que siga así.
 *
 * Hasta el 28 de septiembre de 2026 había cuatro copias locales distintas, tres
 * sin la comilla simple, y varios lugares sin ninguna. El gemelo del frontend
 * (`Frontend/src/utils/escaparHtml.ts`) debe dar exactamente lo mismo; la
 * prueba los compara.
 */

const ENTIDADES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {unknown} valor  `null`/`undefined` → cadena vacía; lo demás, `String(valor)`. */
function escaparHtml(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (c) => ENTIDADES[c]);
}

module.exports = { escaparHtml };
