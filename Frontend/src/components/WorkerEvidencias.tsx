import { useState } from 'react';
import { workersApi, uploadsApi } from '../api/client';
import { FiUploadCloud, FiEye, FiAlertTriangle, FiPlus } from 'react-icons/fi';
import { LuCircleCheck, LuClock } from 'react-icons/lu';

// Evidencias persona-level con vigencia (examen de altura, SPDC, certificados,
// ingreso a vigilancia). Viven en la persona y se REUTILIZAN entre obras mientras
// estén vigentes: el onboarding de una obra no las vuelve a pedir si hay una vigente.
// El `tipo` debe coincidir con el del ítem del kit para que se reutilice
// (EXAMEN_ALTURA, VIGILANCIA_PREXOR, CERT_MOLDAJES, …).
type Evidencia = { tipo: string; nombre?: string; fileKey?: string; emitidoEn?: string; venceEn?: string; origenObraId?: string };

const TIPOS_COMUNES = [
  'EXAMEN_ALTURA', 'CERT_MOLDAJES', 'CAP_ALZAHOMBRE',
  'VIGILANCIA_PREXOR', 'VIGILANCIA_TMERT', 'VIGILANCIA_MMC', 'VIGILANCIA_RUV', 'VIGILANCIA_SILICE',
];

interface Props {
  personaId: string;
  tenantId?: string;
  initial?: Evidencia[];
  canEdit: boolean;
}

export default function WorkerEvidencias({ personaId, tenantId, initial, canEdit }: Props) {
  const [evidencias, setEvidencias] = useState<Evidencia[]>(initial || []);
  const [form, setForm] = useState<Evidencia>({ tipo: '', nombre: '', venceEn: '' });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const vigente = (e: Evidencia) => !e.venceEn || new Date(e.venceEn).getTime() >= Date.now();

  const guardar = async () => {
    if (!form.tipo.trim()) { setError('El tipo es requerido'); return; }
    setSaving(true); setError('');
    try {
      let fileKey: string | undefined;
      let nombre = form.nombre;
      if (file) {
        const up = await uploadsApi.uploadFile(file, 'evidencia', personaId, tenantId);
        if (up.success && up.data) { fileKey = up.data.url; nombre = nombre || up.data.nombre; }
        else { setError(up.error || 'No se pudo subir el archivo'); setSaving(false); return; }
      }
      const evidencia: Evidencia = { tipo: form.tipo.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'), nombre, venceEn: form.venceEn || undefined, fileKey };
      const res = await workersApi.addEvidencia(personaId, evidencia);
      if (res.success && res.data?.persona) {
        setEvidencias((res.data.persona as any).evidencias || []);
        setForm({ tipo: '', nombre: '', venceEn: '' }); setFile(null); setAdding(false);
      } else {
        setError(res.error || 'No se pudo registrar la evidencia');
      }
    } catch { setError('Error de conexión'); }
    finally { setSaving(false); }
  };

  const preview = async (fileKey: string) => {
    try {
      const res = await uploadsApi.getDownloadUrl(fileKey);
      if (res.success && res.data?.downloadUrl) window.open(res.data.downloadUrl, '_blank');
    } catch { /* noop */ }
  };

  return (
    <div className="lg:col-span-2">
      <div className="card" style={{ padding: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <h3 className="font-bold flex items-center gap-2 m-0">
            Evidencias con vigencia <span className="text-muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>(reutilizables entre obras)</span>
          </h3>
          {canEdit && !adding && (
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAdding(true)}><FiPlus /> Registrar</button>
          )}
        </div>

        {error && (
          <div className="ds44-alert ds44-alert-danger" style={{ marginBottom: 'var(--space-2)' }}>
            <span className="ds44-alert-icon"><FiAlertTriangle size={16} /></span><span>{error}</span>
          </div>
        )}

        {adding && (
          <div style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid var(--surface-border)', borderRadius: 8, marginBottom: 'var(--space-3)' }}>
            <input list="evidencia-tipos" className="input" placeholder="Tipo (ej. EXAMEN_ALTURA)" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} />
            <datalist id="evidencia-tipos">{TIPOS_COMUNES.map((t) => <option key={t} value={t} />)}</datalist>
            <input className="input" placeholder="Nombre/descripción (opcional)" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            <label className="text-muted" style={{ fontSize: '0.8rem' }}>Vence el (opcional)
              <input type="date" className="input" value={form.venceEn} onChange={(e) => setForm({ ...form, venceEn: e.target.value })} />
            </label>
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', justifyContent: 'flex-start' }}>
              <FiUploadCloud /> {file ? file.name : 'Adjuntar archivo (opcional)'}
              <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" type="button" disabled={saving} onClick={guardar}>{saving ? 'Guardando…' : 'Guardar'}</button>
              <button className="btn btn-ghost btn-sm" type="button" disabled={saving} onClick={() => { setAdding(false); setError(''); }}>Cancelar</button>
            </div>
          </div>
        )}

        {evidencias.length === 0 ? (
          <div className="text-muted" style={{ fontSize: '0.85rem' }}>Sin evidencias registradas.</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {evidencias.map((e, i) => {
              const ok = vigente(e);
              return (
                <div key={`${e.tipo}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', border: '1px solid var(--surface-border)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {ok ? <LuCircleCheck size={16} style={{ color: '#10b981', flexShrink: 0 }} /> : <LuClock size={16} style={{ color: '#ef4444', flexShrink: 0 }} />}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.87rem' }}>{e.nombre || e.tipo}</div>
                      <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {e.tipo}{e.venceEn ? ` · ${ok ? 'vigente hasta' : 'vencida el'} ${e.venceEn}` : ' · sin vencimiento'}
                      </div>
                    </div>
                  </div>
                  {e.fileKey && (
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => preview(e.fileKey!)} title="Ver"><FiEye /></button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
