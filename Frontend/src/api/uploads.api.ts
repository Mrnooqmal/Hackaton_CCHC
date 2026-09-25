import { apiRequest } from './client';
import type { DocumentoAdjunto } from './signatureRequests.api';
import { huellaSha256, headersDeSubida } from '../utils/huellaArchivo';

interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface UploadUrlResponse {
    uploadUrl: string;
    fileKey: string;
    expiresIn: number;
    bucket: string;
    /** Headers que el PUT a `uploadUrl` TIENE que llevar, tal cual. Incluyen la
     *  huella SHA-256 firmada dentro de la URL: sin ella S3 rechaza la subida. */
    uploadHeaders: Record<string, string>;
}

export interface ConfirmUploadResponse {
    confirmed: boolean;
    documento: DocumentoAdjunto;
    downloadUrl: string;
}

export const uploadsApi = {
    /**
     * URL prefirmada para subir `archivo` directo a S3.
     *
     * El archivo es obligatorio: de él sale la huella SHA-256 que S3 exige en el
     * bucket de evidencia (Object Lock) y que el servidor firma dentro de la URL.
     * El PUT posterior no necesita headers extra.
     */
    getUploadUrl: async (data: { archivo: Blob; fileName: string; fileType: string; fileSize: number; categoria?: string; empresaId?: string; tenantId?: string }) => {
        const { archivo, ...resto } = data;
        const tenantId = resto.tenantId || resto.empresaId;
        const checksumSha256 = await huellaSha256(archivo);
        const res = await apiRequest<Omit<UploadUrlResponse, 'uploadHeaders'>>('/uploads/presigned-url', {
            method: 'POST',
            body: JSON.stringify({ ...resto, tenantId, checksumSha256 }),
        });
        if (!res.success || !res.data) return res as { success: boolean; data?: UploadUrlResponse; error?: string };
        return { ...res, data: { ...res.data, uploadHeaders: headersDeSubida(resto.fileType, checksumSha256) } };
    },

    getDownloadUrl: (fileKey: string) =>
        apiRequest<{ downloadUrl: string; expiresIn: number }>('/uploads/download-url', {
            method: 'POST',
            body: JSON.stringify({ fileKey }),
        }),

    confirmUpload: (data: { fileKey: string; fileName: string; fileType: string; fileSize: number }) =>
        apiRequest<ConfirmUploadResponse>('/uploads/confirm', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    deleteFile: (fileKey: string) =>
        apiRequest<{ deleted: boolean; fileKey: string }>(`/uploads/${encodeURIComponent(fileKey)}`, {
            method: 'DELETE',
        }),

    getBatchDownloadUrls: (fileKeys: string[]) =>
        apiRequest<{ urls: { fileKey: string; downloadUrl: string | null; error: string | null }[]; expiresIn: number }>(
            '/uploads/batch-download-urls',
            {
                method: 'POST',
                body: JSON.stringify({ fileKeys }),
            }
        ),

    uploadFile: async (file: File, categoria?: string, empresaId?: string, tenantId?: string): Promise<ApiResponse<DocumentoAdjunto>> => {
        try {
            const urlResponse = await uploadsApi.getUploadUrl({
                archivo: file,
                fileName: file.name,
                fileType: file.type,
                fileSize: file.size,
                categoria,
                empresaId,
                tenantId,
            });

            if (!urlResponse.success || !urlResponse.data) {
                return { success: false, error: urlResponse.error || 'Error al obtener URL presigned' };
            }

            const put = await fetch(urlResponse.data.uploadUrl, {
                method: 'PUT',
                body: file,
                headers: urlResponse.data.uploadHeaders,
            });
            // Sin esto un rechazo de S3 seguía de largo y el error que veía el
            // usuario era el de la confirmación, no el de la subida.
            if (!put.ok) {
                return { success: false, error: `S3 rechazó el archivo (${put.status}).` };
            }

            const confirmResponse = await uploadsApi.confirmUpload({
                fileKey: urlResponse.data.fileKey,
                fileName: file.name,
                fileType: file.type,
                fileSize: file.size,
            });

            if (!confirmResponse.success || !confirmResponse.data) {
                return { success: false, error: 'Error confirmando carga' };
            }

            return { success: true, data: confirmResponse.data.documento };
        } catch (error: any) {
            return { success: false, error: error?.message || 'Error generico' };
        }
    },
};
