import React, { useMemo, useState, useEffect } from 'react';
import { documentsApi, uploadsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { useNavigate } from 'react-router-dom';
import { LuPlus } from 'react-icons/lu';
import { FiAlertTriangle, FiCopy } from 'react-icons/fi';
import { Select } from '../components/ui';
import { PageHeader, CollectionView, DataTable, Badge } from '../components/ui';
import type { CollectionMode, DataTableColumn } from '../components/ui';
import { PERMISSIONS } from '../permissions';

interface Obra {
  obraId?: string;
  nombre: string;
  codigo: string;
  direccion: string;
  comuna: string;
  region: string;
  mandante: string;
  estado: string;
  imagenKey?: string;
  faenaCompartida?: boolean;
  tieneMaquinaria?: boolean;
  agentesFQB?: boolean;
}

const REQUIRED_DS44 = [
  { tipos: ['POLITICA_SSO'] },
  { tipos: ['DIAGNOSTICO_LEGAL'] },
  { tipos: ['MIPER', 'MATRIZ_MIPPER'] },
  { tipos: ['MAPA_RIESGOS'] },
  { tipos: ['REGLAMENTO_INTERNO'] }
];

const estadoVariant = (estado: string): 'success' | 'warning' | 'neutral' | 'danger' => {
  const map: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
    activa: 'success', activo: 'success',
    pausada: 'warning', pausa: 'warning',
    finalizada: 'neutral', inactiva: 'neutral',
  };
  return map[estado?.toLowerCase()] ?? 'neutral';
};

export const Obras: React.FC = () => {
  const { hasPermission } = useAuth();
  const canCrearObra = hasPermission(PERMISSIONS.OBRAS_CREAR);
  const canVerDetalle = hasPermission(PERMISSIONS.OBRAS_DETALLE);
  const navigate = useNavigate();
  const { obras: contextObras, isLoadingObras } = useObraContext();
  const obras = contextObras as unknown as Obra[];

  const [ds44Alerts, setDs44Alerts] = useState<Record<string, number>>({});
  const loading = isLoadingObras && obras.length === 0;
  const [obraImageUrls, setObraImageUrls] = useState<Record<string, string>>({});
  const imageCacheKey = 'obraImageCache';

  const [searchTerm, setSearchTerm] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [mode, setMode] = useState<CollectionMode>('grid');
  const canViewObras = hasPermission(PERMISSIONS.OBRAS_VER);

  const filteredObras = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return obras.filter(o => {
      if (filterEstado && o.estado !== filterEstado) return false;
      if (!q) return true;
      return (
        o.nombre?.toLowerCase().includes(q) ||
        o.codigo?.toLowerCase().includes(q) ||
        o.direccion?.toLowerCase().includes(q)
      );
    });
  }, [obras, searchTerm, filterEstado]);

  const fetchDs44Alerts = async (obrasList: Obra[]) => {
    if (obrasList.length === 0) { setDs44Alerts({}); return; }
    try {
      const docsRes = await documentsApi.list({ clasificacion: 'obra' });
      const allDocs = docsRes.success && docsRes.data ? (docsRes.data as any).documents || [] : [];
      const alerts: Record<string, number> = {};
      obrasList.forEach((obra) => {
        if (!obra.obraId) return;
        const docs = allDocs.filter((doc: any) => doc.obraId === obra.obraId);
        const missingCount = REQUIRED_DS44.filter((required) => {
          const existing = docs.find((doc: any) => required.tipos.includes(doc.tipo));
          return !Boolean(existing?.s3Key || existing?.archivoUrl);
        }).length;
        alerts[obra.obraId] = missingCount;
      });
      setDs44Alerts(alerts);
    } catch {}
  };

  const fetchObraImages = async (obrasList: Obra[]) => {
    const imageKeys = obrasList
      .map((o) => ({ obraId: o.obraId, imagenKey: o.imagenKey }))
      .filter((e) => e.obraId && e.imagenKey) as { obraId: string; imagenKey: string }[];
    if (imageKeys.length === 0) { setObraImageUrls({}); return; }

    const now = Date.now();
    const cachedRaw = localStorage.getItem(imageCacheKey);
    const cached: Record<string, { url: string; expiresAt: number }> = cachedRaw ? JSON.parse(cachedRaw) : {};
    const needsFetch = new Set<string>();
    const nextImages: Record<string, string> = {};

    imageKeys.forEach(({ obraId, imagenKey }) => {
      const entry = cached[imagenKey];
      if (entry && entry.expiresAt > now) nextImages[obraId] = entry.url;
      else needsFetch.add(imagenKey);
    });

    if (Object.keys(nextImages).length > 0) setObraImageUrls(prev => ({ ...prev, ...nextImages }));

    if (needsFetch.size > 0) {
      try {
        const res = await uploadsApi.getBatchDownloadUrls(Array.from(needsFetch));
        if (res?.success && res.data?.urls) {
          const expiresInMs = (res.data.expiresIn || 0) * 1000;
          const updatedImages: Record<string, string> = {};
          res.data.urls.forEach((item: any) => {
            if (item.downloadUrl && item.fileKey) {
              cached[item.fileKey] = { url: item.downloadUrl, expiresAt: now + expiresInMs };
              imageKeys.forEach(({ obraId, imagenKey }) => {
                if (imagenKey === item.fileKey) updatedImages[obraId] = item.downloadUrl;
              });
            }
          });
          localStorage.setItem(imageCacheKey, JSON.stringify(cached));
          setObraImageUrls(prev => ({ ...prev, ...updatedImages }));
        }
      } catch {}
    }
  };

  useEffect(() => {
    if (obras.length > 0) {
      fetchDs44Alerts(obras);
      fetchObraImages(obras);
    }
  }, [contextObras]);

  if (!canViewObras) {
    return (
      <div className="page-content">
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon"><FiAlertTriangle size={48} className="text-danger-500" /></div>
            <h3 className="empty-state-title">Acceso Restringido</h3>
            <p className="empty-state-description">Solo administradores pueden ver esta sección.</p>
          </div>
        </div>
      </div>
    );
  }

  const obraColumns: DataTableColumn<Obra>[] = [
    {
      key: 'codigo',
      header: 'Código / ID',
      width: '140px',
      render: (o) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {o.codigo
            ? <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{o.codigo}</span>
            : <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>—</span>
          }
          {o.obraId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontFamily: 'monospace', fontSize: '10px', color: 'var(--text-muted)' }}>{o.obraId.slice(0, 8)}…</span>
              <button
                type="button"
                title="Copiar ID de obra"
                onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(o.obraId || ''); }}
                style={{ background: 'none', border: '1px solid var(--surface-border)', borderRadius: 4, padding: '1px 4px', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}
              >
                <FiCopy size={9} />
              </button>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'nombre',
      header: 'Nombre',
      sortable: true,
      sortValue: (o) => o.nombre,
      render: (o) => <span style={{ fontWeight: 600 }}>{o.nombre}</span>,
    },
    {
      key: 'estado',
      header: 'Estado',
      width: '110px',
      render: (o) => <Badge variant={estadoVariant(o.estado)} size="sm">{o.estado}</Badge>,
    },
    {
      key: 'ds44',
      header: 'DS44',
      width: '90px',
      align: 'center',
      render: (o) => {
        const count = o.obraId ? (ds44Alerts[o.obraId] ?? null) : null;
        if (count === null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
        return (
          <span style={{ color: count > 0 ? 'var(--danger-500)' : 'var(--success-500)', fontWeight: 600 }}>
            {count > 0 ? `${count} pendiente${count > 1 ? 's' : ''}` : '✓ ok'}
          </span>
        );
      },
    },
    {
      key: 'ubicacion',
      header: 'Ubicación',
      hideOnMobile: true,
      render: (o) => <span style={{ color: 'var(--text-secondary)' }}>{[o.comuna, o.region].filter(Boolean).join(', ') || '—'}</span>,
    },
  ];

  const tableList = (
    <DataTable
      columns={obraColumns}
      rows={filteredObras}
      rowKey={(o) => o.obraId || o.codigo}
      loading={loading}
      onRowClick={canVerDetalle ? (o) => navigate(`/obras/${o.obraId || o.codigo}`) : undefined}
      emptyState={
        <div className="empty-state" style={{ padding: 'var(--space-10) 0' }}>
          <FiAlertTriangle size={36} className="empty-state-icon" style={{ color: 'var(--warning-500)' }} />
          <p className="empty-state-description">No hay obras que coincidan con los filtros aplicados.</p>
        </div>
      }
    />
  );

  const cardGrid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-4)' }}>
      {filteredObras.length === 0 ? (
        <p style={{ gridColumn: '1/-1', textAlign: 'center', padding: 'var(--space-10)', color: 'var(--text-muted)', fontSize: 14 }}>
          No hay obras que coincidan con los filtros aplicados.
        </p>
      ) : filteredObras.map((obra) => {
        const obraKey = obra.obraId || obra.codigo;
        const alertCount = obra.obraId ? (ds44Alerts[obra.obraId] ?? 0) : 0;
        const imageUrl = obra.obraId ? obraImageUrls[obra.obraId] : '';
        const displayImage = imageUrl || '/obraDefault.png';
        return (
          <div
            key={obraKey}
            className="card"
            style={{ padding: 0, overflow: 'hidden', cursor: canVerDetalle ? 'pointer' : 'default' }}
            onClick={canVerDetalle ? () => navigate(`/obras/${obraKey}`) : undefined}
          >
            <div style={{ position: 'relative', height: '160px', background: 'var(--surface-elevated)' }}>
              <img
                src={displayImage}
                alt={`Foto de ${obra.nombre}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                loading="lazy"
              />
              {alertCount > 0 && (
                <div style={{
                  position: 'absolute', right: '12px', top: '12px',
                  background: 'rgba(239, 68, 68, 0.92)', color: 'white',
                  borderRadius: '999px', padding: '4px 10px', fontSize: '0.75rem',
                  display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600
                }}>
                  <FiAlertTriangle />
                  {alertCount}
                </div>
              )}
            </div>
            <div style={{ padding: 'var(--space-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', marginBottom: 6 }}>
                <span className="font-bold">{obra.nombre}</span>
                <Badge variant={estadoVariant(obra.estado)} size="sm">{obra.estado}</Badge>
              </div>
              <div className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                {obra.comuna || '-'}, {obra.region || '-'}
              </div>
              {obra.obraId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '10px', color: 'var(--text-muted)' }}>{obra.obraId.slice(0, 8)}…</span>
                  <button
                    type="button"
                    title="Copiar ID de obra"
                    onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(obra.obraId || ''); }}
                    style={{ background: 'none', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 4, padding: '1px 4px', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}
                  >
                    <FiCopy size={9} />
                  </button>
                </div>
              )}
              {alertCount > 0 && (
                <div style={{
                  marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', borderRadius: '999px',
                  background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)',
                  color: 'var(--danger-600)', fontWeight: 600, fontSize: '0.8rem'
                }}>
                  <FiAlertTriangle size={12} /> DS44: {alertCount} pendiente{alertCount > 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="page-content">
      <PageHeader
        banner
        title="Obras"
        description="Proyectos activos, documentos DS44 y personal asignado."
        actions={
          <>
            {canCrearObra && (
              <button onClick={() => navigate('/obras/nueva')} className="btn btn-save">
                <LuPlus /> Nueva obra
              </button>
            )}
          </>
        }
      />

      {obras.length === 0 && !loading ? (
        <div className="card">
          <div className="empty-state">
            <h3 className="empty-state-title">Sin obras registradas</h3>
            <p className="empty-state-description">Crea una obra para comenzar a asignar documentos y personal.</p>
            {canCrearObra && (
              <button onClick={() => navigate('/obras/nueva')} className="btn btn-save mt-4">
                <LuPlus /> Nueva obra
              </button>
            )}
          </div>
        </div>
      ) : (
        <CollectionView
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="Buscar por nombre, código o dirección…"
          count={filteredObras.length}
          mode={mode}
          onModeChange={setMode}
          filters={
            <div style={{ width: 160 }}>
              <Select
                ariaLabel="Filtrar por estado"
                value={filterEstado}
                onChange={setFilterEstado}
                options={[
                  { value: '', label: 'Todos los estados' },
                  { value: 'activa', label: 'Activas' },
                  { value: 'pausada', label: 'Pausadas' },
                  { value: 'finalizada', label: 'Finalizadas' },
                ]}
              />
            </div>
          }
          list={tableList}
          grid={cardGrid}
        />
      )}
    </div>
  );
};
export default Obras;
