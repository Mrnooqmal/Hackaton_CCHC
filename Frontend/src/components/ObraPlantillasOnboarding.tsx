import { useMemo, useState } from 'react';
import { obrasApi, uploadsApi } from '../api/client';
import { FiUploadCloud, FiEye, FiTrash2, FiAlertTriangle } from 'react-icons/fi';
import { LuCircleCheck } from 'react-icons/lu';
import type { TenantCargo } from '../api/tenants.api';
import type { Ds44KitItem } from '../utils/ds44';

// Plantilla de alcance 'obra': IRL / Plan de Emergencias / capacitaciones que se
// derivan del MIPER de ESTA obra (no del tenant). Se guardan en
// obra.plantillasOnboarding[cargoCodigo][kitItemKey]. El backend las adjunta
// automáticamente al vincular un trabajador de ese cargo (runOnboardingForObra).
type ObraPlantilla = { fileKey: string; nombre: string; tipo?: string; subidoEn?: string };
type PlantillasMap = Record<string, Record<string, ObraPlantilla>>;

interface Props {
  obraId: string;
  tenantId?: string;
  cargos: TenantCargo[];
  initial?: PlantillasMap;
  canEdit: boolean;
  onSaved?: (map: PlantillasMap) => void;
}

export default function ObraPlantillasOnboarding({ obraId, tenantId, cargos, initial, canEdit, onSaved }: Props) {
  const [map, setMap] = useState<PlantillasMap>(initial || {});
  const [busy, setBusy] = useState<string | null>(null); // `${cargo}:${key}` en subida
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Cargos que tienen al menos un ítem de alcance 'obra' (los que requieren plantilla por obra).
  const filas = useMemo(() => {
    return cargos
      .map((c) => ({
        cargo: c,
        items: (c.kit || []).filter((it) => it.alcancePlantilla === 'obra'),
      }))
      .filter((f) => f.items.length > 0);
  }, [cargos]);

  const totalItems = filas.reduce((acc, f) => acc + f.items.length, 0);
  const totalCargadas = filas.reduce(
    (acc, f) => acc + f.items.filter((it) => map[f.cargo.codigo]?.[it.key]).length,
    0
  );

  if (filas.length === 0) return null;

  // Persiste el mapa completo en la obra (PUT /obras/{id}). El backend tiene
  // 'plantillasOnboarding' en su whitelist de campos actualizables.
  const persist = async (next: PlantillasMap) => {
    setSaving(true); setError('');
    try {
      const res = await obrasApi.update(obraId, { plantillasOnboarding: next });
      if (res.success) onSaved?.(next);
      else setError(res.error || 'No se pudo guardar la plantilla');
    } catch { setError('Error de conexión al guardar la plantilla'); }
    finally { setSaving(false); }
  };

  const uploadPlantilla = async (cargo: string, item: Ds44KitItem, file: File) => {
    const id = `${cargo}:${item.key}`;
    setBusy(id); setError('');
    try {
      const res = await uploadsApi.uploadFile(file, 'plantilla-obra', obraId, tenantId);
      if (res.success && res.data) {
        const plantilla: ObraPlantilla = {
          fileKey: res.data.url,
          nombre: res.data.nombre,
          tipo: res.data.tipo,
          subidoEn: res.data.subidoEn || new Date().toISOString(),
        };
        const next: PlantillasMap = {
          ...map,
          [cargo]: { ...(map[cargo] || {}), [item.key]: plantilla },
        };
        setMap(next);
        await persist(next);
      } else {
        setError(res.error || 'No se pudo subir la plantilla');
      }
    } catch { setError('Error de conexión al subir la plantilla'); }
    finally { setBusy(null); }
  };

  const removePlantilla = async (cargo: string, key: string) => {
    const rest = { ...(map[cargo] || {}) };
    delete rest[key];
    const next: PlantillasMap = { ...map, [cargo]: rest };
    setMap(next);
    await persist(next);
  };

  const previewPlantilla = async (fileKey: string) => {
    try {
      const res = await uploadsApi.getDownloadUrl(fileKey);
      if (res.success && res.data?.downloadUrl) window.open(res.data.downloadUrl, '_blank');
      else setError('No se pudo abrir la plantilla');
    } catch { setError('No se pudo abrir la plantilla'); }
  };

  return (
    <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-3)', border: '1px solid var(--surface-border)', background: 'var(--surface-elevated)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <div style={{ minWidth: 0 }}>
          <div className="font-medium">Plantillas de onboarding por obra</div>
          <div className="text-muted" style={{ fontSize: '0.82rem' }}>
            IRL, Plan de Emergencias y demás documentos derivados del MIPER de esta obra. Se adjuntan
            automáticamente al vincular un trabajador del cargo. {saving && <em>Guardando…</em>}
          </div>
        </div>
        <div className="text-muted" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
          {totalCargadas}/{totalItems} plantillas cargadas
        </div>
      </div>

      {error && (
        <div className="ds44-alert ds44-alert-danger" style={{ marginBottom: 'var(--space-2)' }}>
          <span className="ds44-alert-icon"><FiAlertTriangle size={16} /></span>
          <span>{error}</span>
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        {filas.map(({ cargo, items }) => (
          <div key={cargo.codigo} style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <div className="font-medium" style={{ fontSize: '0.9rem' }}>{cargo.label}</div>
            {items.map((item) => {
              const current = map[cargo.codigo]?.[item.key];
              const id = `${cargo.codigo}:${item.key}`;
              return (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', padding: '8px 12px', border: '1px solid var(--surface-border)', borderRadius: 8, background: 'var(--surface)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {current && <LuCircleCheck size={15} style={{ color: 'var(--success, #16a34a)' }} />}
                      {item.titulo}
                      {item.bloqueante && <span className="badge" style={{ fontSize: '0.7rem' }}>bloqueante</span>}
                    </div>
                    {current
                      ? <div className="text-muted" style={{ fontSize: '0.78rem' }}>{current.nombre}</div>
                      : <div className="text-muted" style={{ fontSize: '0.78rem' }}>{item.articulo || 'Sin plantilla'}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {current && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => previewPlantilla(current.fileKey)} title="Ver plantilla">
                        <FiEye />
                      </button>
                    )}
                    {canEdit && (
                      <>
                        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                          <FiUploadCloud /> {busy === id ? 'Subiendo…' : current ? 'Reemplazar' : 'Subir'}
                          <input
                            type="file"
                            hidden
                            disabled={busy === id}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadPlantilla(cargo.codigo, item, f);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {current && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removePlantilla(cargo.codigo, item.key)} title="Quitar plantilla">
                            <FiTrash2 />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
