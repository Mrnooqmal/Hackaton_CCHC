import { useEffect, useState } from 'react';
import { uploadsApi } from '../api/client';

const CACHE_KEY = 'obraImageCache';

type CacheEntry = { url: string; expiresAt: number };
type UrlFirmada = { fileKey?: string; downloadUrl?: string | null };
type RespuestaUrls = { success?: boolean; data?: { urls?: UrlFirmada[]; expiresIn?: number } };

/**
 * URLs firmadas de las fotos de portada de las obras, por obraId.
 *
 * Las URLs caducan, así que se guardan en localStorage hasta su vencimiento y
 * solo se piden las que faltan (en un solo lote). Las obras sin foto no
 * aparecen en el resultado: quien la muestre decide su imagen por defecto.
 */
export function useObraImagenes(obras: { obraId?: string; imagenKey?: string }[]): Record<string, string> {
    const [urls, setUrls] = useState<Record<string, string>>({});

    // Solo cambia cuando cambian las fotos, no con cada nueva referencia a la lista
    const firma = obras.map((o) => `${o.obraId}:${o.imagenKey || ''}`).join('|');

    useEffect(() => {
        const claves = obras
            .filter((o) => o.obraId && o.imagenKey)
            .map((o) => ({ obraId: o.obraId as string, imagenKey: o.imagenKey as string }));
        if (claves.length === 0) { setUrls({}); return; }

        let vivo = true;
        const ahora = Date.now();
        let cache: Record<string, CacheEntry> = {};
        try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { /* caché corrupta: se rehace */ }

        const vigentes: Record<string, string> = {};
        const faltantes = new Set<string>();
        claves.forEach(({ obraId, imagenKey }) => {
            const entry = cache[imagenKey];
            if (entry && entry.expiresAt > ahora) vigentes[obraId] = entry.url;
            else faltantes.add(imagenKey);
        });
        setUrls(vigentes);

        if (faltantes.size > 0) {
            uploadsApi.getBatchDownloadUrls(Array.from(faltantes))
                .then((res: RespuestaUrls) => {
                    if (!vivo || !res?.success || !res.data?.urls) return;
                    const expiraEn = (res.data.expiresIn || 0) * 1000;
                    const nuevas: Record<string, string> = {};
                    res.data.urls.forEach((item) => {
                        if (!item.downloadUrl || !item.fileKey) return;
                        const { fileKey, downloadUrl } = item;
                        cache[fileKey] = { url: downloadUrl, expiresAt: ahora + expiraEn };
                        claves.forEach(({ obraId, imagenKey }) => {
                            if (imagenKey === fileKey) nuevas[obraId] = downloadUrl;
                        });
                    });
                    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* sin almacenamiento */ }
                    setUrls((prev) => ({ ...prev, ...nuevas }));
                })
                .catch(() => { /* sin foto: se usa la imagen por defecto */ });
        }
        return () => { vivo = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firma]);

    return urls;
}
