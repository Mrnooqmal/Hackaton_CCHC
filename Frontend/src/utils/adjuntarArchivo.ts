import { documentsApi } from '../api/documents.api';
import { uploadsApi } from '../api/uploads.api';
import type { CategoriaEvidencia } from './subirDocumento';

export async function adjuntarArchivo({ documentId, file, categoria, tenantId }: {
    documentId: string;
    file: File;
    categoria: CategoriaEvidencia | 'trabajadores';
    tenantId: string;
}): Promise<void> {
    const subida = await uploadsApi.uploadFile(file, categoria, tenantId);
    if (!subida.success || !subida.data) {
        throw new Error(subida.error || 'No se pudo subir el archivo.');
    }

    const fileKey = subida.data.url;
    const guardado = await documentsApi.update(documentId, {
        s3Key: fileKey, archivoUrl: fileKey, archivoNombre: file.name,
    } as Parameters<typeof documentsApi.update>[1]);
    if (!guardado.success) {
        throw new Error(guardado.error || 'El archivo se subió, pero no quedó guardado en el documento.');
    }
}
