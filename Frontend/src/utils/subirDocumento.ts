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
/**
 * Categorías de subida que acepta el backend para evidencia de cumplimiento
 * (`CATEGORIAS` en Backend/lib/almacenamiento.js, clase EVIDENCIA).
 *
 * Es una lista cerrada a propósito: desde el endurecimiento de /uploads el
 * servidor rechaza cualquier otra, y este helper se llamaba con 'ds44',
 * 'difusion', 'prescripciones' y 'sgsst', que no existen. Tiparla hace que una
 * categoría inválida la marque el compilador y no el usuario al subir.
 */
export type CategoriaEvidencia =
    | 'documentos' | 'evidencia' | 'evaluaciones' | 'epp' | 'registros-indicadores'
    | 'estructura-preventiva' | 'actas-cphs' | 'acuerdos-cphs' | 'programa-cphs';

export async function subirComoDocumento({
    file, tipo, titulo, tenantId, obraId = null, categoria = 'documentos', fecha = null, fechaCaducidad = null,
}: {
    file: File;
    tipo: string;
    titulo: string;
    tenantId: string;
    obraId?: string | null;
    categoria?: CategoriaEvidencia;
    /** Fecha del HECHO que acredita (YYYY-MM-DD): contra ella corre la vigencia, no contra la subida. */
    fecha?: string | null;
    /** Hasta cuándo vale (YYYY-MM-DD); null = sin caducidad. */
    fechaCaducidad?: string | null;
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
        // Evidencia de la obra o de la empresa, no un documento diario: sin esto
        // el backend la guardaba como 'diario' y la obra, que lista los de
        // clasificación 'obra', no la mostraba aunque el motor sí la contaba.
        clasificacion: obraId ? 'obra' : 'empresa',
        fecha: fecha || undefined,
        fechaCaducidad: fechaCaducidad || undefined,
        archivoUrl: subida.data.url,
        archivoNombre: file.name,
    });
    if (!doc.success || !doc.data?.documentId) {
        throw new Error(doc.error || 'No se pudo registrar el documento.');
    }
    return doc.data.documentId;
}
