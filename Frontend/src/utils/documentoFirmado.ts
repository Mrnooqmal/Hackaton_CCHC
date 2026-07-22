import { documentsApi, uploadsApi, waitForDocumentoFirmado } from '../api/client';

interface AbrirDocumentoFirmableParams {
    documentId?: string | null;
    firmas?: unknown[] | null;
    fileKey?: string | null;
    onPreparando?: () => void;
    onError?: (mensaje: string) => void;
}

/**
 * Abre en una pestaña nueva el PDF de un documento: si tiene firmas, la
 * versión con el anexo de firmas estampado (única con validez legal); si no,
 * el archivo original.
 *
 * La pestaña se abre de forma SÍNCRONA, antes de cualquier `await`: los
 * navegadores bloquean `window.open` si no ocurre dentro del gesto de click
 * original, y el estampado puede tardar varios segundos (se regenera en
 * segundo plano). Por eso se abre una pestaña en blanco de inmediato y se
 * navega a la URL final una vez que está lista, en la misma pestaña — así
 * basta un solo click.
 */
export async function abrirDocumentoFirmable({
    documentId,
    firmas,
    fileKey,
    onPreparando,
    onError,
}: AbrirDocumentoFirmableParams): Promise<void> {
    const ventana = window.open('', '_blank');
    if (ventana) {
        ventana.document.write(
            '<p style="font-family: system-ui, sans-serif; padding: 24px; color: #444;">Preparando documento…</p>'
        );
    }
    const navegar = (url: string) => {
        if (ventana && !ventana.closed) ventana.location.href = url;
        else window.open(url, '_blank');
    };
    const cancelar = (mensaje?: string) => {
        ventana?.close();
        if (mensaje) onError?.(mensaje);
    };

    if (documentId && firmas && firmas.length > 0) {
        const primera = await documentsApi.downloadFirmado(documentId);
        if (!primera.success) {
            cancelar(primera.error || 'No se pudo obtener el documento firmado');
            return;
        }
        if (primera.data?.estado === 'listo' && primera.data.url) {
            navegar(primera.data.url);
            return;
        }
        onPreparando?.();
        const url = await waitForDocumentoFirmado(documentId);
        if (url) {
            navegar(url);
        } else {
            cancelar('El documento firmado está tardando más de lo esperado. Intenta de nuevo en un momento.');
        }
        return;
    }

    if (!fileKey) {
        cancelar();
        return;
    }
    const res = await uploadsApi.getDownloadUrl(fileKey);
    if (res.success && res.data?.downloadUrl) {
        navegar(res.data.downloadUrl);
    } else {
        cancelar('No se pudo obtener el archivo');
    }
}
