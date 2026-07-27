import { useMemo, useState } from 'react';
import { obrasApi } from '../api/client';
import { FiAlertTriangle } from 'react-icons/fi';
import type { TenantCargo } from '../api/tenants.api';

// Aplicabilidad MIPER (manual) del kit por cargo en una obra. Permite EXCLUIR
// ítems que no aplican según la MIPER de la obra (ej. Jornal de aseo sin trabajo
// en altura excluye PR-PO-08/23/41). Auditable: es una decisión explícita.
// Estructura persistida: obra.aplicabilidadKit[cargo][kitItemKey] = 'no_aplica'.
type AplicabilidadMap = Record<string, Record<string, 'aplica' | 'no_aplica' | 'verificar'>>;

interface Props {
  obraId: string;
  cargos: TenantCargo[];
  initial?: AplicabilidadMap;
  canEdit: boolean;
  onSaved?: (map: AplicabilidadMap) => void;
}

export default function ObraAplicabilidadKit({ obraId, cargos, initial, canEdit, onSaved }: Props) {
  const [map, setMap] = useState<AplicabilidadMap>(initial || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [openCargo, setOpenCargo] = useState<string | null>(null);

  // Solo cargos de terreno con kit (los legacy/sin kit no aplican aquí).
  const filas = useMemo(
    () => cargos.filter((c) => !c.legacy && Array.isArray(c.kit) && c.kit.length > 0),
    [cargos]
  );

  if (filas.length === 0) return null;

  const aplica = (cargo: string, key: string) => map[cargo]?.[key] !== 'no_aplica';

  const persist = async (next: AplicabilidadMap) => {
    setSaving(true); setError('');
    try {
      const res = await obrasApi.update(obraId, { aplicabilidadKit: next });
      if (res.success) onSaved?.(next);
      else setError(res.error || 'No se pudo guardar la aplicabilidad');
    } catch { setError('Error de conexión al guardar'); }
    finally { setSaving(false); }
  };

  const toggle = async (cargo: string, key: string) => {
    const next: AplicabilidadMap = {
      ...map,
      [cargo]: { ...(map[cargo] || {}), [key]: aplica(cargo, key) ? 'no_aplica' : 'aplica' },
    };
    setMap(next);
    await persist(next);
  };

  return (
    <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-3)', border: '1px solid var(--surface-border)', background: 'var(--surface-elevated)' }}>
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <div className="font-medium">Aplicabilidad del kit por cargo (MIPER)</div>
        <div className="text-muted" style={{ fontSize: '0.82rem' }}>
          Excluye los ítems que no apliquen en esta obra según la MIPER del cargo. Lo excluido no
          se genera al asignar trabajadores de ese cargo. {saving && <em>Guardando…</em>}
        </div>
      </div>

      {error && (
        <div className="ds44-alert ds44-alert-danger" style={{ marginBottom: 'var(--space-2)' }}>
          <span className="ds44-alert-icon"><FiAlertTriangle size={16} /></span>
          <span>{error}</span>
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {filas.map((cargo) => {
          const excluidos = (cargo.kit || []).filter((it) => !aplica(cargo.codigo, it.key)).length;
          const abierto = openCargo === cargo.codigo;
          return (
            <div key={cargo.codigo} style={{ border: '1px solid var(--surface-border)', borderRadius: 8, background: 'var(--surface)' }}>
              <button
                type="button"
                onClick={() => setOpenCargo(abierto ? null : cargo.codigo)}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', padding: '10px 12px', cursor: 'pointer', color: 'var(--text-primary)' }}
              >
                <span className="font-medium" style={{ fontSize: '0.9rem' }}>{cargo.label}</span>
                <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                  {excluidos > 0 ? `${excluidos} excluido(s)` : 'todo aplica'} · {abierto ? '▲' : '▼'}
                </span>
              </button>
              {abierto && (
                <div style={{ borderTop: '1px solid var(--surface-border)', padding: '8px 12px', display: 'grid', gap: 4 }}>
                  {(cargo.kit || []).map((it) => (
                    <label key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: canEdit ? 'pointer' : 'default', opacity: aplica(cargo.codigo, it.key) ? 1 : 0.5 }}>
                      <input
                        type="checkbox"
                        className="checkbox-input"
                        checked={aplica(cargo.codigo, it.key)}
                        disabled={!canEdit || saving}
                        onChange={() => toggle(cargo.codigo, it.key)}
                      />
                      <span style={{ textDecoration: aplica(cargo.codigo, it.key) ? 'none' : 'line-through' }}>
                        {it.codigoEbco ? `${it.codigoEbco} · ` : ''}{it.titulo}
                      </span>
                      {it.bloqueante && <span className="badge" style={{ fontSize: '0.68rem' }}>bloqueante</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
