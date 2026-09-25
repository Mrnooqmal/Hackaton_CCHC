/**
 * Huella SHA-256 de un archivo, en base64, calculada en el navegador.
 *
 * El bucket de evidencia tiene Object Lock, y S3 rechaza toda subida a un bucket
 * con bloqueo que no traiga una huella de integridad. Al prefirmar, el servidor
 * no tiene el archivo y no puede calcularla: la calcula quien lo tiene y el
 * servidor firma la URL con ella. S3 compara la huella con lo que llega, así que
 * además detecta un archivo alterado en el camino.
 */
export async function huellaSha256(archivo: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await archivo.arrayBuffer());
    let binario = '';
    new Uint8Array(digest).forEach((b) => { binario += String.fromCharCode(b); });
    return btoa(binario);
}

/**
 * Headers del PUT a una URL prefirmada con huella.
 *
 * S3 solo acepta la huella como header en los buckets con Object Lock (si viaja
 * en la URL la ignora), y el servidor la firmó así: el PUT tiene que mandarla
 * con el mismo valor o la firma no calza.
 */
export const headersDeSubida = (tipo: string, huella: string): Record<string, string> => ({
    'Content-Type': tipo,
    'x-amz-checksum-sha256': huella,
});
