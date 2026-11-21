import { useEffect, useMemo, useState } from 'react';
import { personasApi, type PersonaResponse } from '../api/client';
import { obrasApi } from '../api/obras.api';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { AlertBanner, PageHeader, Select } from '../components/ui';
import { ModalActivacion, ESTILOS_ACCESO } from '../components/AccesoPlataforma';
import { estadoAcceso, horaCorta, pendienteDeActivacion } from '../utils/accesoPersona';

const ETIQUETA = {
    pendiente: 'Pendiente',
    'temporal-vigente': 'Activado, falta que entre',
    'temporal-vencida': 'Temporal vencida',
} as const;

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
                description="Personas registradas que todavía no eligen su contraseña. Actívalas con la persona presente."
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

            {cargando ? (
                <p className="activar__vacio">Cargando…</p>
            ) : pendientes.length === 0 ? (
                <p className="activar__vacio">No hay personas pendientes de activación{obraId ? ' en esta obra' : ''}.</p>
            ) : (
                <ul className="activar__lista">
                    {pendientes.map((p) => {
                        const estado = estadoAcceso(p);
                        const etiqueta = estado === 'pendiente' || estado === 'temporal-vigente' || estado === 'temporal-vencida' ? ETIQUETA[estado] : '';
                        return (
                            <li key={p.personaId} className="activar__fila">
                                <span className="activar__persona">
                                    <span className="activar__nombre">{p.nombre} {p.apellido}</span>
                                    <span className="activar__meta">
                                        {p.rut} · {p.rolNombre || p.rol} · {etiqueta}
                                        {estado === 'temporal-vigente' && p.passwordTemporalVence ? ` (vence ${horaCorta(p.passwordTemporalVence)})` : ''}
                                    </span>
                                </span>
                                <button type="button" className="btn btn-primary btn-sm" onClick={() => setActivando(p)}>
                                    {estado === 'pendiente' ? 'Activar' : 'Activar de nuevo'}
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
