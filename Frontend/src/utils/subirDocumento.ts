import { documentsApi } from '../api/documents.api';
import { uploadsApi } from '../api/uploads.api';

/**
 * Sube un archivo y lo deja como Documento tipificado del repositorio.
 *
 * Los adjuntos del DS 44 (evidencia de una prescripción, respaldo de un envío,
 * la Política de SST) no son archivos sueltos: son documentos con tipo, y el
 * motor de completitud los busca por ese tipo. Guardarlos fuera del repositorio
 * los volvería invisibles para el formulario.
 *
 * Devuelve el `documentId`, o lanza con el motivo. No valida el contenido del
 * archivo: que acredite lo que dice es responsabilidad de quien lo sube.
 */
export async function subirComoDocumento({
    file, tipo, titulo, tenantId, obraId = null, categoria = 'ds44',
}: {
    file: File;
    tipo: string;
    titulo: string;
    tenantId: string;
    obraId?: string | null;
    categoria?: string;
}): Promise<string> {
    if (!tenantId) throw new Error('Sin empresa activa.');

    const subida = await uploadsApi.uploadFile(file, categoria, tenantId, tenantId);
    if (!subida.success || !subida.data) {
        throw new Error(subida.error || 'No se pudo subir el archivo.');
    }

    const doc = await documentsApi.create({
        tipo,
        titulo,
        empresaId: tenantId,
        obraId: obraId || undefined,
        archivoUrl: subida.data.url,
        archivoNombre: file.name,
    });
    if (!doc.success || !doc.data?.documentId) {
        throw new Error(doc.error || 'No se pudo registrar el documento.');
    }
    return doc.data.documentId;
}
