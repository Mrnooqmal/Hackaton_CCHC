import { documentsApi, uploadsApi, waitForDocumentoFirmado } from '../api/client';

interface AbrirDocumentoFirmableParams {
    documentId?: string | null;
    firmas?: unknown[] | null;
    fileKey?: string | null;
    onPreparando?: () => void;
    onError?: (mensaje: string) => void;
}

/** `url` lista para mostrar, o `error` con el motivo (null = cancelar en silencio). */
export type DocumentoResuelto = { url: string } | { error: string | null };

/**
 * Resuelve la URL del PDF de un documento: si tiene firmas, la versión con el
 * anexo de firmas estampado (única con validez legal); si no, el archivo
 * original. El estampado puede tardar, así que espera a que esté listo.
 *
 * No abre ninguna ventana: sirve tanto para mostrar el documento dentro de la
 * página (modal de vista previa) como para navegar a él.
 */
export async function resolverDocumentoFirmable({
    documentId,
    firmas,
    fileKey,
    onPreparando,
}: Omit<AbrirDocumentoFirmableParams, 'onError'>): Promise<DocumentoResuelto> {
    if (documentId && firmas && firmas.length > 0) {
        const primera = await documentsApi.downloadFirmado(documentId);
        if (!primera.success) {
            return { error: primera.error || 'No se pudo obtener el documento firmado' };
        }
        if (primera.data?.estado === 'listo' && primera.data.url) {
            return { url: primera.data.url };
        }
        onPreparando?.();
        const url = await waitForDocumentoFirmado(documentId);
        return url
            ? { url }
            : { error: 'El documento firmado está tardando más de lo esperado. Intenta de nuevo en un momento.' };
    }

    if (!fileKey) return { error: null };

    const res = await uploadsApi.getDownloadUrl(fileKey);
    return res.success && res.data?.downloadUrl
        ? { url: res.data.downloadUrl }
        : { error: 'No se pudo obtener el archivo' };
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

    const resultado = await resolverDocumentoFirmable({ documentId, firmas, fileKey, onPreparando });
    if ('url' in resultado) navegar(resultado.url);
    else cancelar(resultado.error ?? undefined);
}
