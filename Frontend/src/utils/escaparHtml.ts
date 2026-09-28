/**
 * El único escapado de HTML del frontend.
 *
 * Los informes imprimibles (Registro AT/EP, impresión de incidentes) se arman
 * como HTML y se abren en una pestaña que comparte el origen de la aplicación:
 * un `<script>` en la descripción de un hallazgo corría ahí y podía leer el
 * token de sesión. Todo texto que venga de una persona y entre a ese HTML pasa
 * por acá.
 *
 * Gemelo exacto de `Backend/lib/escaparHtml.js`: la prueba del backend carga
 * este archivo y compara los resultados. Por eso está escrito sin anotaciones
 * de tipo en el cuerpo (solo en la firma), para poder evaluarlo fuera de Vite.
 */

const ENTIDADES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escaparHtml(valor: unknown): string {
    return String(valor ?? '').replace(/[&<>"']/g, (c) => ENTIDADES[c]);
}
