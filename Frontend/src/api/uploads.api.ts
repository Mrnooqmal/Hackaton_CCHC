import { apiRequest } from './client';
import type { DocumentoAdjunto } from './signatureRequests.api';

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
}

export interface ConfirmUploadResponse {
    confirmed: boolean;
    documento: DocumentoAdjunto;
    downloadUrl: string;
}

export const uploadsApi = {
    getUploadUrl: (data: { fileName: string; fileType: string; fileSize: number; categoria?: string; empresaId?: string }) =>
        apiRequest<UploadUrlResponse>('/uploads/presigned-url', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

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

    uploadFile: async (file: File, categoria?: string, empresaId?: string): Promise<ApiResponse<DocumentoAdjunto>> => {
        try {
            const urlResponse = await uploadsApi.getUploadUrl({
                fileName: file.name,
                fileType: file.type,
                fileSize: file.size,
                categoria,
                empresaId,
            });

            if (!urlResponse.success || !urlResponse.data) {
                return { success: false, error: 'Error al obtener URL presigned' };
            }

            await fetch(urlResponse.data.uploadUrl, {
                method: 'PUT',
                body: file,
                headers: {
                    'Content-Type': file.type,
                },
            });

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
