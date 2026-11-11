/**
 * Renovación silenciosa de los vales (D-37).
 *
 * Habilitar no es un paso: cada vez que una persona escribe su PIN con red —al
 * firmar cualquier cosa, propia o asistida— el equipo le renueva los vales para la
 * obra activa, sin mostrar nada. Si algo falla no pasa nada: sin vales, se firma
 * con el sobre (utils/sobreFirma). Con vales el error de tipeo se detecta al
 * momento; esa es la única diferencia, y el trabajador no la ve.
 */
import { signaturesApi } from '../api/signatures.api';
import { guardarValesDe, valesDePersona } from './colaFirmas';
import { cifrarVales, cifradoDisponible } from './valesCifrados';

const MINIMO = 3;
const MARGEN_MS = 2 * 60 * 60 * 1000;
export const EVENTO_COLA = 'cola-firmas-cambio';

/**
 * Identificador del equipo. Es TRAZA, no credencial: el servidor lo guarda para el
 * acta (en qué equipo se emitió el vale y en cuál se usó) y no lo exige para validar.
 */
export const deviceId = (): string => {
    try {
        let id = localStorage.getItem('deviceId');
        if (!id) {
            id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            localStorage.setItem('deviceId', id);
        }
        return id;
    } catch {
        return 'desconocido';
    }
};

const enCurso = new Set<string>();

export const renovarValesEnSilencio = async (personaId: string | undefined | null, pin: string | undefined | null): Promise<void> => {
    if (!personaId || !pin) return;
    try {
        const tenantId = localStorage.getItem('tenant_id');
        const obraId = localStorage.getItem('obraScope') === 'obra' ? localStorage.getItem('selectedObraId') : null;
        if (!tenantId || !obraId || !cifradoDisponible() || enCurso.has(personaId)) return;
        const actual = valesDePersona(tenantId, personaId);
        if (actual && actual.obraId === obraId && actual.cantidad >= MINIMO
            && new Date(actual.expiraEn).getTime() - Date.now() > MARGEN_MS) return;
        enCurso.add(personaId);
        const res = await signaturesApi.emitirVales({ personaId, obraId, pin, cantidad: 5, deviceId: deviceId() });
        if (!res.success || !res.data) return;
        const cifrado = await cifrarVales(pin, res.data.vales);
        guardarValesDe(tenantId, { personaId, obraId: res.data.obraId, cifrado, expiraEn: res.data.expiraEn, intentosFallidos: 0 });
        window.dispatchEvent(new CustomEvent(EVENTO_COLA));
    } catch {
        /* en silencio: el sobre cubre lo que esto no alcance */
    } finally {
        enCurso.delete(personaId);
    }
};
