import { useEffect, useState } from 'react';
import { FiWifiOff } from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { useObraContext } from '../../context/ObraContext';
import { useOfflineSignature } from '../../hooks/useOfflineSignature';
import HabilitarValesModal from './HabilitarValesModal';

/**
 * Al entrar con señal, ofrece habilitar la firma sin conexión para el turno.
 *
 * Aparece si la persona está en una obra (a la que está asignada), puede firmar
 * (enrolada, con PIN) y le quedan menos de 3 firmas sin conexión para esa obra en
 * este equipo. Se puede posponer: no vuelve a aparecer hasta el día siguiente en
 * esa obra y ese equipo. Sin señal no aparece: habilitarla requiere red, y es
 * justo lo que hay que hacer antes de perderla.
 */
const MINIMO = 3;
const clavePospuesto = (obraId: string) => `vales-aviso-pospuesto:${obraId}:${new Date().toISOString().slice(0, 10)}`;

export default function AvisoValesTurno() {
    const { user } = useAuth();
    const { scope, selectedObraId, selectedObra } = useObraContext();
    const { isOnline, valesDe } = useOfflineSignature();
    const [abierto, setAbierto] = useState(false);
    const [, setVersion] = useState(0);
    const [pospuesto, setPospuesto] = useState(false);

    useEffect(() => {
        try { setPospuesto(Boolean(selectedObraId && localStorage.getItem(clavePospuesto(selectedObraId)))); } catch { setPospuesto(false); }
    }, [selectedObraId]);

    const u = user as (typeof user & { pinConfigurado?: boolean; obraIds?: string[] }) | null;
    const personaId = u?.personaId;
    if (!u || !personaId || !isOnline || scope !== 'obra' || !selectedObraId || pospuesto) return null;
    if (!u.habilitado || u.pinConfigurado === false) return null;
    if (!(u.obraIds || []).includes(selectedObraId)) return null;
    const quedan = valesDe(personaId, selectedObraId);
    if (quedan >= MINIMO) return null;

    const posponer = () => {
        try { localStorage.setItem(clavePospuesto(selectedObraId), '1'); } catch { /* sin almacenamiento */ }
        setPospuesto(true);
    };
    const nombre = [u.nombre, (u as { apellido?: string }).apellido].filter(Boolean).join(' ') || 'Tú';

    return (
        <>
            <div className="aviso-vales-turno" role="region" aria-label="Firma sin conexión">
                <FiWifiOff aria-hidden />
                <span>
                    {quedan === 0
                        ? '¿Vas a terreno con mala señal? Habilita la firma sin conexión para este turno.'
                        : `Te quedan ${quedan} firma(s) sin conexión en esta obra. Habilita más mientras tienes señal.`}
                </span>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setAbierto(true)}>Habilitar</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={posponer}>Hoy no</button>
            </div>
            <HabilitarValesModal
                isOpen={abierto}
                onClose={() => setAbierto(false)}
                personaId={personaId}
                nombre={nombre}
                obraId={selectedObraId}
                obraNombre={selectedObra?.nombre}
                onListo={() => setVersion((v) => v + 1)}
            />
        </>
    );
}
