import { documentsApi, signatureRequestsApi } from '../api/client';

/**
 * Publicación de una nueva versión de un documento versionable (procedimientos
 * del HACER y la MIPER del PLAN).
 *
 * Son SIEMPRE dos llamadas, y por eso vive acá en vez de repetirse en cada
 * pantalla: `POST /documents/{id}/nueva-version` archiva la versión anterior,
 * resetea las asignaciones a `pendiente` y avisa por inbox a la línea de mando;
 * pero "Mis Firmas" no lee documentos de obra —lee SignatureRequests y docs
 * `diario`—, así que sin la segunda llamada la re-firma solo aparecería en el
 * inbox y el trabajador no tendría dónde firmarla.
 */

export interface PublicarVersionParams {
    documentId: string;
    /** Versión que el cliente cree vigente: el backend responde 409 si no calza. */
    versionActual: number;
    s3Key: string;
    archivoNombre?: string;
    /** Obligatorio: queda en el historial y en el aviso a la línea de mando. */
    motivo: string;
    notasCambio?: string;
    /** Nombre visible del documento en la solicitud de firma. */
    titulo: string;
    /** Asignaciones de la versión saliente: son quienes deben re-firmar. */
    asignaciones?: Array<{ personaId?: string; workerId?: string }>;
    autorId?: string;
    autorNombre?: string;
    tenantId?: string;
    obraId?: string;
    fechaLimite?: string | null;
    tamanoArchivo?: number;
}

export interface PublicarVersionResultado {
    ok: boolean;
    /** Número de la versión publicada (solo si ok). */
    version?: number;
    /** Cuántas personas quedaron con la re-firma pendiente. */
    refirmantes?: number;
    error?: string;
}

export async function publicarNuevaVersion(p: PublicarVersionParams): Promise<PublicarVersionResultado> {
    const nuevaVersion = (p.versionActual || 1) + 1;

    const res = await documentsApi.nuevaVersion(p.documentId, {
        s3Key: p.s3Key,
        archivoNombre: p.archivoNombre,
        motivo: p.motivo.trim(),
        notasCambio: p.notasCambio || undefined,
        publicadaPor: p.autorId,
        publicadaPorNombre: p.autorNombre,
        versionEsperada: p.versionActual,
    });

    if (!res.success) {
        return { ok: false, error: res.error || 'No se pudo publicar la nueva versión.' };
    }

    const firmanteIds = [...new Set(
        (p.asignaciones || []).map((a) => a.personaId || a.workerId).filter(Boolean) as string[],
    )];

    // La solicitud de firma es best-effort: la versión ya quedó publicada, así que
    // fallar acá no debe deshacerla. El aviso del inbox sale igual.
    if (firmanteIds.length > 0) {
        try {
            await signatureRequestsApi.create({
                tipo: 'DOCUMENTO',
                titulo: `${p.titulo} (v${nuevaVersion})`,
                descripcion: `Nueva versión (v${nuevaVersion}) de "${p.titulo}". Debes leer y firmar la versión vigente.`,
                documentos: [{
                    nombre: p.archivoNombre || p.titulo,
                    url: p.s3Key,
                    tipo: 'application/pdf',
                    tamaño: p.tamanoArchivo || 0,
                }],
                trabajadoresIds: firmanteIds,
                solicitanteId: p.autorId || '',
                fechaLimite: p.fechaLimite || undefined,
                tenantId: p.tenantId,
                obraId: p.obraId,
                referenciaId: p.documentId,
                referenciaTipo: 'document',
                documentId: p.documentId,
            } as never);
        } catch (err) {
            console.warn('Versión publicada, pero no se pudo crear la solicitud de re-firma. Aparecerá en el inbox y no en Mis Firmas:', err);
        }
    }

    return { ok: true, version: nuevaVersion, refirmantes: firmanteIds.length };
}
