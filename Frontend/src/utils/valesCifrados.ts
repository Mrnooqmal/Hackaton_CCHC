/**
 * Vales de firma cifrados con el PIN de la persona.
 *
 * Sin red, firmar exige el PIN: el equipo guarda los vales cifrados con una
 * llave derivada del PIN que la persona tecleó al habilitarse (con red, cuando
 * el servidor lo comprobó). Si el PIN de ahora descifra, se firma; si no, no.
 *
 * ── Por qué AES-CTR, sin etiqueta, y UN byte de comprobación ─────────────────
 *
 * Quien copie el almacenamiento del equipo puede probar los 10^6 PIN fuera de la
 * app, sin límite. Con una etiqueta de autenticación (AES-GCM) cada intento diría
 * con certeza si el PIN es el correcto, y el PIN —que sirve con red para
 * cualquier firma— quedaría expuesto en segundos con una tarjeta gráfica.
 *
 * El vale son 32 bytes aleatorios. Cifrados con AES-CTR, un PIN equivocado da
 * otros 32 bytes igual de aleatorios: desde la copia no se distingue el bueno.
 * Para que quien se equivoca al teclear lo sepa en terreno, se guarda un solo
 * byte derivado de la misma llave: descarta 255 de cada 256 PIN equivocados.
 * A quien ataca la copia le quedan ~3.900 candidatos (con 6 dígitos), que solo
 * puede confirmar presentando vales al servidor, y el servidor anula los vales
 * de la persona al quinto vale inválido (ValeFirmaService.registrarInvalido).
 *
 * El costo aceptado: 1 de cada 256 PIN equivocados pasa la comprobación. Esa
 * firma se guarda con un vale que no existe, el servidor la rechaza al
 * sincronizar, y se avisa con el nombre de la persona (ver colaFirmas,
 * `firmasRechazadas`).
 *
 * Nada de esto protege contra quien conoce el PIN, ni reemplaza el límite del
 * servidor: solo evita que el equipo sea un oráculo del PIN.
 *
 * ── Parámetros ───────────────────────────────────────────────────────────────
 *
 * PBKDF2-HMAC-SHA256 con `ITERACIONES` (calibradas con /medicion-pin para que
 * derivar tarde del orden de medio segundo en un Android de gama baja). Las
 * iteraciones y la sal viajan con cada emisión: se pueden subir sin romper los
 * vales ya guardados. Sal de 16 bytes nueva en cada emisión; contador (IV) de 16
 * bytes distinto para cada vale.
 */

export const ITERACIONES = 300_000;
export const VERSION = 1;

export interface ValeCifrado {
    /** Contador inicial de AES-CTR, 16 bytes, base64. */
    iv: string;
    /** El vale cifrado: 32 bytes, base64. */
    c: string;
}

export interface ValesCifrados {
    v: number;
    sal: string;
    iteraciones: number;
    /** Un byte (0-255) derivado de la llave: descarta 255 de cada 256 PIN equivocados. */
    comprobacion: number;
    vales: ValeCifrado[];
}

const subtle = (): SubtleCrypto | null => {
    try {
        const c = (globalThis as { crypto?: Crypto }).crypto;
        return c && c.subtle && typeof c.getRandomValues === 'function' ? c.subtle : null;
    } catch {
        return null;
    }
};

/** ¿Puede este navegador guardar vales cifrados? (WebCrypto exige https.) */
export const cifradoDisponible = (): boolean => subtle() !== null;

const aBase64 = (b: Uint8Array): string => {
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
};
type Bytes = Uint8Array<ArrayBuffer>;
const deBase64 = (s: string): Bytes => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

const deHex = (hex: string): Bytes => {
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('vale con formato inesperado');
    const b = new Uint8Array(32);
    for (let i = 0; i < 32; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return b;
};
const aHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const aleatorio = (n: number): Bytes => {
    const b = new Uint8Array(n);
    globalThis.crypto.getRandomValues(b);
    return b;
};

/** Llave abierta: la de AES y el byte de comprobación. Vive solo en memoria. */
export interface LlaveVales {
    llave: CryptoKey;
    comprobacion: number;
    sal: string;
}

/**
 * Deriva la llave de un PIN. Es lo lento (PBKDF2): se hace una vez por firma, o
 * una vez por emisión.
 */
export const derivarLlave = async (pin: string, sal: Bytes, iteraciones: number): Promise<LlaveVales> => {
    const s = subtle();
    if (!s) throw new Error('Este navegador no permite cifrar en el equipo.');
    const base = await s.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    // 33 bytes: 32 para AES-256 y 1 de comprobación.
    const bits = new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, base, 33 * 8));
    const llave = await s.importKey('raw', bits.slice(0, 32), { name: 'AES-CTR' }, false, ['encrypt', 'decrypt']);
    return { llave, comprobacion: bits[32], sal: aBase64(sal) };
};

const ctr = (iv: Bytes) => ({ name: 'AES-CTR', counter: iv, length: 64 });

/**
 * Cifra los vales recién emitidos con el PIN que el servidor acaba de aceptar.
 * Los vales llegan en hex (64 caracteres): se cifran los 32 bytes crudos, no el
 * texto, para que un descifrado equivocado no se reconozca por no ser hex.
 */
export const cifrarVales = async (pin: string, vales: string[], iteraciones = ITERACIONES): Promise<ValesCifrados> => {
    const sal = aleatorio(16);
    const { llave, comprobacion } = await derivarLlave(pin, sal, iteraciones);
    const s = subtle() as SubtleCrypto;
    const cifrados: ValeCifrado[] = [];
    for (const vale of vales) {
        const iv = aleatorio(16);
        const c = new Uint8Array(await s.encrypt(ctr(iv), llave, deHex(vale)));
        cifrados.push({ iv: aBase64(iv), c: aBase64(c) });
    }
    return { v: VERSION, sal: aBase64(sal), iteraciones, comprobacion, vales: cifrados };
};

/** Abre la llave de unos vales con un PIN. `null` si el byte de comprobación no coincide. */
export const abrirLlave = async (pin: string, cifrados: ValesCifrados): Promise<LlaveVales | null> => {
    const llave = await derivarLlave(pin, deBase64(cifrados.sal), cifrados.iteraciones);
    return llave.comprobacion === cifrados.comprobacion ? llave : null;
};

/**
 * Descifra un vale con una llave ya abierta. Nunca falla por "llave equivocada":
 * AES-CTR no tiene cómo saberlo, y eso es lo que se busca.
 */
export const descifrarVale = async (llave: LlaveVales, vale: ValeCifrado): Promise<string> => {
    const s = subtle() as SubtleCrypto;
    const claro = new Uint8Array(await s.decrypt(ctr(deBase64(vale.iv)), llave.llave, deBase64(vale.c)));
    return aHex(claro);
};
