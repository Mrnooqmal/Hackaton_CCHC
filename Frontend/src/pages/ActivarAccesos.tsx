import { useEffect, useMemo, useState } from 'react';
import { personasApi, type PersonaResponse, type ResumenReactivacion } from '../api/client';
import { obrasApi } from '../api/obras.api';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { AlertBanner, PageHeader, Select } from '../components/ui';
import { ModalActivacion, ESTILOS_ACCESO } from '../components/AccesoPlataforma';
import { estadoAcceso, fechaCorta, horaCorta, pendienteDeActivacion, reactivable } from '../utils/accesoPersona';

const ETIQUETA = {
    pendiente: 'Pendiente',
    'inicial-vigente': 'Contraseña inicial vigente',
    'inicial-vencida': 'Contraseña inicial vencida',
    'temporal-vigente': 'Activado, falta que entre',
    'temporal-vencida': 'Temporal vencida',
} as const;

const MAX_VUELTAS = 30;

function textoResumen(r: ResumenReactivacion): string {
    const partes = [`${r.reactivadas + r.yaReactivadas} ${r.reactivadas + r.yaReactivadas === 1 ? 'persona puede' : 'personas pueden'} entrar con los cuatro primeros dígitos de su RUT hasta el ${fechaCorta(r.vence)}.`];
    if (r.omitidas.temporalVigente) partes.push(`${r.omitidas.temporalVigente} con una temporal de 2 horas vigente quedaron igual.`);
    if (r.omitidas.sinPermiso) partes.push(`${r.omitidas.sinPermiso} tienen permisos que tú no tienes: las reactiva un administrador.`);
    if (r.omitidas.sinInicial + r.omitidas.conflicto) partes.push(`${r.omitidas.sinInicial + r.omitidas.conflicto} no se pudieron reactivar: revisa su ficha.`);
    return partes.join(' ');
}

export default function ActivarAccesos() {
    const { user } = useAuth();
    const { selectedObraId } = useObraContext();
    const tenantId = user?.tenantId || '';

    const [personas, setPersonas] = useState<PersonaResponse[]>([]);
    const [obras, setObras] = useState<Array<{ obraId: string; nombre?: string; codigo?: string }>>([]);
    const [obraId, setObraId] = useState(selectedObraId || '');
    const [busqueda, setBusqueda] = useState('');
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [activando, setActivando] = useState<PersonaResponse | null>(null);
    const [reactivacion, setReactivacion] = useState<{ estado: 'confirmar' | 'enviando' | 'hecho' | 'error'; texto?: string } | null>(null);

    const reactivarObra = async () => {
        if (!obraId) return;
        setReactivacion({ estado: 'enviando' });
        try {
            let ultima: ResumenReactivacion | null = null;
            for (let vuelta = 0; vuelta < MAX_VUELTAS && (!ultima || ultima.restantes > 0); vuelta += 1) {
                const r = await personasApi.reactivarInicialObra(tenantId, obraId);
                if (!r.success || !r.data) {
                    setReactivacion({ estado: 'error', texto: r.error || 'No se pudo reactivar el acceso inicial de la obra.' });
                    cargar();
                    return;
                }
                ultima = r.data;
            }
            if (!ultima || ultima.restantes > 0) {
                setReactivacion({ estado: 'error', texto: 'Quedaron personas sin reactivar. Vuelve a intentarlo: las ya reactivadas no se repiten.' });
            } else {
                setReactivacion({ estado: 'hecho', texto: textoResumen(ultima) });
            }
            cargar();
        } catch {
            setReactivacion({ estado: 'error', texto: 'Error de conexión con el servidor. Lo que alcanzó a reactivarse quedó reactivado: vuelve a intentarlo.' });
        }
    };

    const cargar = async () => {
        if (!tenantId) return;
        setCargando(true);
        try {
            const r = await personasApi.list(tenantId);
            if (r.success && r.data) setPersonas(r.data.personas || []);
            else setError(r.error || 'No se pudo cargar el personal.');
        } catch {
            setError('Error de conexión con el servidor.');
        } finally {
            setCargando(false);
        }
    };

    useEffect(() => { cargar(); }, [tenantId]);
    useEffect(() => {
        obrasApi.list(tenantId).then((r) => { if (r.success && Array.isArray(r.data)) setObras(r.data); }).catch(() => {});
    }, [tenantId]);

    const pendientes = useMemo(() => {
        const q = busqueda.trim().toLowerCase().replace(/[.-]/g, '');
        return personas
            .filter((p) => p.personaId !== user?.personaId && p.tieneAccesoWeb && pendienteDeActivacion(p))
            .filter((p) => p.estado !== 'desvinculado' && p.estado !== 'suspendido')
            .filter((p) => !obraId || (p.obraIds || []).includes(obraId))
            .filter((p) => !q || `${p.nombre} ${p.apellido || ''}`.toLowerCase().includes(q) || p.rut.toLowerCase().replace(/[.-]/g, '').includes(q))
            .sort((a, b) => `${a.nombre} ${a.apellido}`.localeCompare(`${b.nombre} ${b.apellido}`));
    }, [personas, obraId, busqueda, user?.personaId]);

    return (
        <div className="page-content">
            <PageHeader
                banner
                title="Activar accesos"
                description="Personas registradas que todavía no eligen su contraseña. Entran con los cuatro primeros dígitos de su RUT durante 7 días; si se les vence, reactívalas, o actívalas con la persona presente."
            />
            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}

            <div className="activar__filtros">
                <input
                    className="form-input"
                    type="search"
                    placeholder="Buscar por nombre o RUT…"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    aria-label="Buscar por nombre o RUT"
                />
                <div className="activar__obra">
                    <Select
                        ariaLabel="Filtrar por obra"
                        value={obraId}
                        onChange={setObraId}
                        options={[
                            { value: '', label: 'Todas las obras' },
                            ...obras.map((o) => ({ value: o.obraId, label: o.nombre || o.codigo || o.obraId })),
                        ]}
                    />
                </div>
            </div>

            {obraId && pendientes.some((p) => reactivable(estadoAcceso(p))) && (
                <div className="activar__reactivar">
                    {reactivacion?.estado === 'confirmar' ? (
                        <>
                            <p>
                                Todas las personas de esta obra que todavía no entran podrán entrar durante 7 días con los cuatro primeros dígitos de su RUT,
                                y cualquiera que conozca su RUT también. Queda registrado que tú lo hiciste, y cada una recibe un aviso con tu nombre.
                            </p>
                            <div className="activar__reactivar-acciones">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReactivacion(null)}>Cancelar</button>
                                <button type="button" className="btn btn-primary btn-sm" onClick={reactivarObra}>Reactivar por 7 días</button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p>¿Pasaron 7 días y alguien de esta obra no alcanzó a entrar? Dales otros 7 días con su contraseña inicial.</p>
                            <div className="activar__reactivar-acciones">
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReactivacion({ estado: 'confirmar' })} disabled={reactivacion?.estado === 'enviando'}>
                                    {reactivacion?.estado === 'enviando' ? 'Reactivando…' : 'Reactivar acceso inicial'}
                                </button>
                            </div>
                        </>
                    )}
                    {reactivacion?.estado === 'hecho' && <p role="status">{reactivacion.texto}</p>}
                    {reactivacion?.estado === 'error' && <p className="activar__reactivar-error" role="alert">{reactivacion.texto}</p>}
                </div>
            )}

            {cargando ? (
                <p className="activar__vacio">Cargando…</p>
            ) : pendientes.length === 0 ? (
                <p className="activar__vacio">No hay personas pendientes de activación{obraId ? ' en esta obra' : ''}.</p>
            ) : (
                <ul className="activar__lista">
                    {pendientes.map((p) => {
                        const estado = estadoAcceso(p);
                        const etiqueta = estado in ETIQUETA ? ETIQUETA[estado as keyof typeof ETIQUETA] : '';
                        return (
                            <li key={p.personaId} className="activar__fila">
                                <span className="activar__persona">
                                    <span className="activar__nombre">{p.nombre} {p.apellido}</span>
                                    <span className="activar__meta">
                                        {p.rut} · {p.rolNombre || p.rol} · {etiqueta}
                                        {estado === 'temporal-vigente' && p.passwordTemporalVence ? ` (vence ${horaCorta(p.passwordTemporalVence)})` : ''}
                                        {estado === 'inicial-vigente' && p.passwordTemporalVence ? ` (hasta el ${fechaCorta(p.passwordTemporalVence)})` : ''}
                                    </span>
                                </span>
                                <button type="button" className="btn btn-primary btn-sm" onClick={() => setActivando(p)}>
                                    {estado === 'temporal-vigente' || estado === 'temporal-vencida' ? 'Activar de nuevo' : 'Activar'}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            <ModalActivacion
                tenantId={tenantId}
                persona={activando}
                onCerrar={(hubo) => { setActivando(null); if (hubo) cargar(); }}
            />

            <style>{`
                ${ESTILOS_ACCESO}
                .activar__filtros { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-4) 0; }
                .activar__filtros .form-input { flex: 1 1 220px; min-width: 0; }
                .activar__obra { flex: 0 1 240px; min-width: 0; }
                .activar__vacio { color: var(--text-secondary); font-size: 0.9rem; }
                .activar__reactivar {
                    display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-4);
                    padding: 12px 14px; border: 1px solid var(--surface-border); border-radius: 12px; font-size: 0.88rem;
                }
                .activar__reactivar p { margin: 0; color: var(--text-primary); line-height: 1.5; }
                .activar__reactivar-acciones { display: flex; flex-wrap: wrap; gap: var(--space-2); }
                .activar__reactivar-error { color: var(--danger-600, #b91c1c) !important; }
                .activar__lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
                .activar__fila {
                    display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
                    padding: 12px 14px; border: 1px solid var(--surface-border); border-radius: 12px;
                }
                .activar__persona { display: flex; flex-direction: column; min-width: 0; }
                .activar__nombre { font-weight: 600; color: var(--text-primary); }
                .activar__meta { font-size: 0.8rem; color: var(--text-secondary); overflow-wrap: anywhere; }
            `}</style>
        </div>
    );
}
