/**
 * Sobre de firma sin conexión (D-37): el respaldo cuando el equipo no tiene vales
 * de la persona, para que sin señal siempre se pueda firmar.
 *
 * El PIN se cifra con la llave PÚBLICA del servidor, junto con el hash de la
 * firma. La privada no sale de KMS: desde el equipo, o desde una copia de su
 * almacenamiento, no se puede abrir ni probar PIN contra el sobre. El PIN se
 * comprueba al volver la señal, en el servidor (Backend/lib/sobreFirma.js), y el
 * hash impide usar el sobre para otra firma.
 *
 * El hash tiene que calcularse igual en los dos lados:
 * Backend/tests/sobre-firma.test.js lo comprueba.
 */
import type { Almacen, TipoFirma } from './colaFirmas';

const VERSION = 1;
const CLAVE_LLAVE = 'llaveSobreFirma';

const REFERENCIA: Record<TipoFirma, string> = { documento: 'document', actividad: 'activity', encuesta: 'survey' };

export interface DatosDeFirma {
    personaId: string;
    tenantId: string;
    obraId: string | null;
    tipo: TipoFirma;
    referenciaId: string;
    idFirmaLocal: string;
    timestampLocal: string;
}

const porDefecto = (): Almacen => window.localStorage;

/** La llave pública viaja en la sesión. No es secreta: sobrevive al cierre de sesión. */
export const guardarLlaveSobre = (llave: unknown, almacen: Almacen = porDefecto()): void => {
    if (typeof llave !== 'string' || !llave) return;
    try { almacen.setItem(CLAVE_LLAVE, llave); } catch { /* sin almacenamiento */ }
};

export const leerLlaveSobre = (almacen: Almacen = porDefecto()): string | null => {
    try { return almacen.getItem(CLAVE_LLAVE); } catch { return null; }
};

export const hashDeFirma = async (d: DatosDeFirma): Promise<string> => {
    const texto = JSON.stringify([VERSION, d.personaId, d.tenantId, d.obraId || null, REFERENCIA[d.tipo], d.referenciaId, d.idFirmaLocal, d.timestampLocal]);
    const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
    return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
};

/** Cifra el PIN y el hash de la firma. RSA-OAEP con SHA-256, en base64. */
export const cifrarSobre = async (pin: string, datos: DatosDeFirma, llavePublica: string): Promise<string> => {
    const s = globalThis.crypto.subtle;
    const spki = Uint8Array.from(atob(llavePublica), (c) => c.charCodeAt(0));
    const llave = await s.importKey('spki', spki, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const claro = new TextEncoder().encode(JSON.stringify({ p: pin, h: await hashDeFirma(datos) }));
    const cifrado = new Uint8Array(await s.encrypt({ name: 'RSA-OAEP' }, llave, claro));
    let bin = '';
    for (let i = 0; i < cifrado.length; i++) bin += String.fromCharCode(cifrado[i]);
    return btoa(bin);
};
