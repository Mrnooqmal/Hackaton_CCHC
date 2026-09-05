import { useEffect, useMemo, useState } from 'react';
import { FiPlus, FiTrash2, FiSave } from 'react-icons/fi';
import { tenantsApi, type CatalogosActividad as Catalogos, type CatalogoItem } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/ui';

const SECCIONES: { key: keyof Catalogos; titulo: string; hint: string }[] = [
    { key: 'temas', titulo: 'Temas tratados', hint: 'Temas estandarizados de la charla diaria (aseo, carpintería, fraguado…).' },
    { key: 'recursos', titulo: 'Recursos y equipos', hint: 'Equipos/herramientas utilizados en la planificación diaria.' },
    { key: 'riesgos', titulo: 'Riesgos comunes', hint: 'Riesgos identificables (caída a desnivel, golpes…).' },
    { key: 'medidas', titulo: 'Medidas de prevención', hint: 'Medidas aplicables (uso de EPP, revisión de plataformas…).' },
];

// El código se deriva del label solo al CREAR un ítem; después es estable
// (las actividades ya creadas lo referencian).
const codigoDesdeLabel = (label: string) => label
    .trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export default function CatalogosActividad() {
    const { user } = useAuth();
    const tenantId = user?.tenantId || '';
    const { toast } = useToast();
    const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [nuevos, setNuevos] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!tenantId) return;
        tenantsApi.getCatalogosActividad(tenantId).then((res) => {
            if (res.success && res.data) setCatalogos(res.data.catalogos);
            else toast.error(res.error || 'No se pudieron cargar los catálogos');
        }).finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId]);

    const codigosUsados = useMemo(() => {
        const s = new Set<string>();
        if (catalogos) for (const sec of SECCIONES) for (const i of catalogos[sec.key]) s.add(`${sec.key}:${i.codigo}`);
        return s;
    }, [catalogos]);

    const agregar = (key: keyof Catalogos) => {
        const label = (nuevos[key] || '').trim();
        if (!label || !catalogos) return;
        const codigo = codigoDesdeLabel(label);
        if (!codigo) return;
        if (codigosUsados.has(`${key}:${codigo}`)) { toast.error('Ya existe un ítem equivalente en esta lista'); return; }
        setCatalogos({ ...catalogos, [key]: [...catalogos[key], { codigo, label }] });
        setNuevos({ ...nuevos, [key]: '' });
    };

    const renombrar = (key: keyof Catalogos, idx: number, label: string) => {
        if (!catalogos) return;
        const lista = catalogos[key].map((it, i) => (i === idx ? { ...it, label } : it));
        setCatalogos({ ...catalogos, [key]: lista });
    };

    const eliminar = (key: keyof Catalogos, idx: number) => {
        if (!catalogos) return;
        setCatalogos({ ...catalogos, [key]: catalogos[key].filter((_, i) => i !== idx) });
    };

    const guardar = async () => {
        if (!catalogos || saving) return;
        setSaving(true);
        try {
            const res = await tenantsApi.saveCatalogosActividad(tenantId, catalogos);
            if (res.success && res.data) {
                setCatalogos(res.data.catalogos);
                toast.success('Catálogos guardados');
            } else toast.error(res.error || 'Error al guardar');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="flex items-center justify-center" style={{ height: '60vh' }}><div className="spinner" /></div>;

    return (
        <div className="page-content">
            <PageHeader
                banner
                title="Catálogos de actividades"
                description="Listados desplegables de la planificación diaria: temas tratados, recursos, riesgos y medidas de prevención. Aplican a todas las obras de la empresa."
                actions={
                    <button className="btn btn-primary" disabled={saving || !catalogos} onClick={guardar}>
                        <FiSave /> {saving ? 'Guardando…' : 'Guardar cambios'}
                    </button>
                }
            />

            {catalogos && (
                <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)', alignItems: 'start' }}>
                    {SECCIONES.map(({ key, titulo, hint }) => (
                        <div key={key} className="card">
                            <div className="card-header">
                                <div>
                                    <h2 className="card-title">{titulo}</h2>
                                    <p className="card-subtitle">{hint}</p>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                {catalogos[key].map((item: CatalogoItem, idx: number) => (
                                    <div key={item.codigo} className="flex items-center gap-2">
                                        <input
                                            className="form-input"
                                            value={item.label}
                                            onChange={(e) => renombrar(key, idx, e.target.value)}
                                            aria-label={`Label de ${item.codigo}`}
                                        />
                                        <button
                                            className="btn btn-ghost btn-icon btn-sm"
                                            title="Eliminar"
                                            onClick={() => eliminar(key, idx)}
                                        >
                                            <FiTrash2 />
                                        </button>
                                    </div>
                                ))}
                                <div className="flex items-center gap-2">
                                    <input
                                        className="form-input"
                                        placeholder="Agregar ítem…"
                                        value={nuevos[key] || ''}
                                        onChange={(e) => setNuevos({ ...nuevos, [key]: e.target.value })}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(key); } }}
                                        aria-label={`Nuevo ítem en ${titulo}`}
                                    />
                                    <button className="btn btn-secondary btn-sm" onClick={() => agregar(key)}>
                                        <FiPlus /> Agregar
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
