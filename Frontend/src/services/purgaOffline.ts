/**
 * Borra del dispositivo la base de datos del modo sin conexión anterior.
 *
 * Esa base (`BuildServeOfflineDB`) guardaba las solicitudes recolectadas sin red
 * con **el PIN en claro de cada persona que firmaba**, para poder mandarlo al
 * servidor al sincronizar. El endpoint que recibía esos lotes
 * (`POST /signature-requests/offline-batch`) se eliminó el 19 de septiembre de
 * 2026: la firma sin conexión ahora usa vales de un solo uso y el PIN no sale
 * del teclado.
 *
 * Quitar la pantalla no basta. Un equipo que ya haya usado el flujo viejo sigue
 * teniendo los PIN guardados en IndexedDB, y en terreno los dispositivos se
 * comparten. Por eso esto se ejecuta al arrancar la aplicación y al cerrar
 * sesión, no solo una vez.
 *
 * Es deliberado que se pierdan las firmas que hubieran quedado sin sincronizar:
 * ya no hay a dónde mandarlas, y conservar los PIN para nada es exactamente el
 * problema que se está cerrando.
 */

const BASE_RETIRADA = 'BuildServeOfflineDB';

export const purgarAlmacenOfflineAntiguo = (): void => {
    try {
        if (typeof indexedDB === 'undefined' || !indexedDB.deleteDatabase) return;
        // Sin await a propósito: si otra pestaña tiene la base abierta, el borrado
        // queda bloqueado hasta que se cierre. Esperarlo trabaría el arranque de
        // la aplicación por algo que puede completarse después.
        indexedDB.deleteDatabase(BASE_RETIRADA);
    } catch {
        // Un navegador que no deja borrar no puede impedir que la aplicación
        // funcione. Lo que no se puede es dejar de intentarlo en cada arranque.
    }
};
