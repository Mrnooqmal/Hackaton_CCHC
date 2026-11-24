import { incidentsApi } from '../api/client';

/**
 * Subida de las fotos de un caso, compartida por el formulario de reporte y el detalle
 * del caso: las dos hacen lo mismo y no pueden desalinearse (la huella, el conteo de
 * lo que falló, el mensaje al usuario).
 *
 * Por cada foto: (1) pide al servidor la URL firmada de subida (`incidentsApi.uploadEvidence`,
 * que calcula la huella SHA-256 que exige el bucket de evidencia), (2) la sube a S3 y
 * (3) todas las que llegaron se adjuntan al caso de una vez (`agregarEvidencias`, que
 * valida cada clave y agrega sin pisar).
 */

/** Espera antes de reintentar un adjunto que chocó con otro cambio del caso. */
const REINTENTO_ADJUNTAR_MS = 400;

export interface ResultadoSubidaFotos {
    /** Claves de S3 de las fotos que llegaron al bucket. */
    claves: string[];
    /** Fotos que no se pudieron subir. */
    fallidas: number;
}

export interface ResultadoFotosDelCaso {
    /** Claves de las fotos que quedaron adjuntas al caso. */
    adjuntas: string[];
    /** Fotos que NO quedaron en el caso: las que no subieron y las que no se pudieron adjuntar. */
    sinAdjuntar: number;
}

/**
 * Sube las fotos a la carpeta del caso y cuenta lo que no subió: `fetch` no lanza con un
 * 4xx/5xx de S3, así que una foto rechazada no puede darse por subida.
 */
export async function subirFotosAS3(incidentId: string, fotos: File[]): Promise<ResultadoSubidaFotos> {
    const claves: string[] = [];
    let fallidas = 0;
    for (const file of fotos) {
        try {
            const urlResponse = await incidentsApi.uploadEvidence({ archivo: file, fileName: file.name, fileType: file.type, incidentId });
            if (!urlResponse.success || !urlResponse.data) { fallidas++; continue; }
            const subida = await fetch(urlResponse.data.uploadUrl, { method: 'PUT', body: file, headers: urlResponse.data.uploadHeaders });
            if (subida.ok) claves.push(urlResponse.data.s3Key);
            else fallidas++;
        } catch (error) {
            console.error('Error subiendo archivo:', error);
            fallidas++;
        }
    }
    return { claves, fallidas };
}

/**
 * Sube las fotos y las adjunta al caso. El caso ya existe aunque las fotos fallen: no se
 * crea otro, solo se informa cuántas no quedaron.
 */
export async function subirYAdjuntarFotos(incidentId: string, fotos: File[]): Promise<ResultadoFotosDelCaso> {
    const { claves, fallidas } = await subirFotosAS3(incidentId, fotos);
    let sinAdjuntar = fallidas;
    let adjuntas: string[] = [];
    if (claves.length > 0) {
        try {
            let adjunto = await incidentsApi.agregarEvidencias(incidentId, claves);
            // 409: el caso cambió justo en ese momento (otra persona guardó algo). Adjuntar con las mismas
            // claves es seguro (agrega sin duplicar) y la segunda vez ya lee el caso nuevo: se reintenta una vez,
            // para no dejar las fotos ya subidas sin dueño en el bucket (que no deja borrar).
            if (!adjunto.success && adjunto.codigo === 'CONFLICTO') {
                await new Promise((resolver) => setTimeout(resolver, REINTENTO_ADJUNTAR_MS));
                adjunto = await incidentsApi.agregarEvidencias(incidentId, claves);
            }
            if (adjunto.success) adjuntas = claves;
            else sinAdjuntar += claves.length;
        } catch {
            sinAdjuntar += claves.length;
        }
    }
    return { adjuntas, sinAdjuntar };
}
