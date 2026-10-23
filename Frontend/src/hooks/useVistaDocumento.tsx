import { useCallback, useState } from 'react';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import { documentsApi } from '../api/documents.api';
import { resolverDocumentoFirmable } from '../utils/documentoFirmado';

/**
 * Abre un documento del repositorio (el que origina la prescripción, o la
 * evidencia) en el visor de la página, igual que el detalle de obra.
 */
export function useVistaDocumento(onError?: (mensaje: string) => void) {
    const [vista, setVista] = useState<{ url: string | null; nombre: string } | null>(null);

    const abrir = useCallback(async (documentId: string, nombre = 'documento') => {
        setVista({ url: null, nombre });
        try {
            const res = await documentsApi.get(documentId);
            const doc = res.data;
            if (!res.success || !doc) throw new Error(res.error || 'No se encontró el documento.');
            const resultado = await resolverDocumentoFirmable({
                documentId, firmas: doc.firmas, fileKey: doc.s3Key || doc.archivoUrl,
            });
            if ('url' in resultado) {
                setVista({ url: resultado.url, nombre: doc.archivoNombre || doc.titulo || nombre });
            } else {
                setVista(null);
                if (resultado.error) onError?.(resultado.error);
            }
        } catch (e) {
            setVista(null);
            onError?.(e instanceof Error ? e.message : 'No se pudo abrir el documento.');
        }
    }, [onError]);

    const visor = (
        <DocumentPreviewModal
            isOpen={Boolean(vista)}
            onClose={() => setVista(null)}
            url={vista?.url ?? null}
            fileName={vista?.nombre}
        />
    );

    return { abrir, visor };
}
