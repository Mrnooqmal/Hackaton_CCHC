import { useCallback, useEffect, useState } from 'react';
import { FiWifiOff, FiCheckCircle, FiUsers, FiMapPin } from 'react-icons/fi';
import { PageHeader, EmptyState, LoadingSpinner } from '../components/ui';
import HabilitarValesModal from '../components/firmas/HabilitarValesModal';
import { workersApi, type Worker } from '../api/client';
import { useObraContext } from '../context/ObraContext';
import { useOfflineSignature } from '../hooks/useOfflineSignature';

/**
 * Preparar cuadrilla sin señal.
 *
 * En el equipo del supervisor, antes de salir a terreno y con señal: cada
 * trabajador de la obra teclea SU PIN y queda habilitado para firmar sin
 * conexión en este equipo durante el turno (5 firmas, 12 horas). El supervisor
 * no conoce ni guarda el PIN de nadie: el equipo guarda vales de un solo uso.
 *
 * Exige firma asistida (`obra.firma_asistida`), el mismo permiso que el servidor
 * pide para emitir vales a nombre de otra persona.
 */
const hora = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
};

export default function PrepararCuadrilla() {
    const { scope, selectedObraId, selectedObra } = useObraContext();
    const { isOnline, detalleVales } = useOfflineSignature();
    const [trabajadores, setTrabajadores] = useState<Worker[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [elegido, setElegido] = useState<Worker | null>(null);
    const [, setVersion] = useState(0);

    const cargar = useCallback(async () => {
        if (!selectedObraId) return;
        setCargando(true);
        setError('');
        const res = await workersApi.list({ obraId: selectedObraId });
        if (res.success && res.data) setTrabajadores(res.data as Worker[]);
        else setError(res.error || 'No se pudo cargar la cuadrilla.');
        setCargando(false);
    }, [selectedObraId]);

    useEffect(() => { cargar(); }, [cargar]);

    if (scope !== 'obra' || !selectedObraId) {
        return (
            <div className="page-content">
                <PageHeader title="Preparar cuadrilla sin señal" />
                <EmptyState icon={<FiMapPin />} title="Elige una obra" description="La firma sin conexión se habilita para la obra del turno." />
            </div>
        );
    }

    const nombre = (w: Worker) => [w.nombre, w.apellido].filter(Boolean).join(' ');

    return (
        <div className="page-content">
            <PageHeader
                title="Preparar cuadrilla sin señal"
                description={`Con señal, antes de salir: cada persona ingresa su PIN en este equipo y queda habilitada para firmar sin conexión durante el turno en ${selectedObra?.nombre || 'esta obra'}.`}
            />
            {!isOnline && (
                <p className="form-error" role="alert"><FiWifiOff aria-hidden /> Sin señal: habilitar la firma sin conexión requiere red. Hazlo antes de salir a terreno.</p>
            )}
            {cargando ? <LoadingSpinner /> : error ? (
                <p className="form-error" role="alert">{error}</p>
            ) : trabajadores.length === 0 ? (
                <EmptyState icon={<FiUsers />} title="Sin personas en esta obra" description="Asigna personas a la obra para poder habilitarlas." />
            ) : (
                <ul className="cuadrilla-vales">
                    {trabajadores.map((w) => {
                        const vales = detalleVales(w.personaId);
                        const deEstaObra = vales && vales.obraId === selectedObraId ? vales : null;
                        const puede = w.habilitado !== false;
                        return (
                            <li key={w.personaId} className="cuadrilla-vales__fila">
                                <div>
                                    <strong>{nombre(w)}</strong>
                                    {w.cargo && <span className="cuadrilla-vales__cargo"> · {w.cargo}</span>}
                                    <div className="cuadrilla-vales__estado">
                                        {deEstaObra
                                            ? <><FiCheckCircle aria-hidden /> {deEstaObra.vales.length} firma(s) sin conexión, hasta las {hora(deEstaObra.expiraEn)}</>
                                            : vales
                                                ? 'Habilitada para otra obra'
                                                : 'Sin firma sin conexión en este equipo'}
                                        {!puede && ' · No ha completado su enrolamiento'}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    disabled={!isOnline || !puede}
                                    onClick={() => setElegido(w)}
                                >
                                    {deEstaObra ? 'Renovar' : 'Habilitar'}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            {elegido && (
                <HabilitarValesModal
                    isOpen={Boolean(elegido)}
                    onClose={() => setElegido(null)}
                    personaId={elegido.personaId}
                    nombre={nombre(elegido)}
                    obraId={selectedObraId}
                    obraNombre={selectedObra?.nombre}
                    onListo={() => setVersion((v) => v + 1)}
                />
            )}
        </div>
    );
}
