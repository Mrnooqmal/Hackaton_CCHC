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
  // Art. 68: la autorizacion a asistir a los examenes de control del Organismo
  // Administrador es por persona y el tiempo se cuenta como trabajado. Va aca y
  // no en la obra porque acompaña al trabajador cuando lo transfieren.
  'AUTORIZACION_EXAMENES',
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
    <section className="wev" aria-labelledby="wev-titulo">
        <div className="wev-head">
          <h3 id="wev-titulo">Evidencias con vigencia</h3>
          <span>Reutilizables entre obras</span>
          {canEdit && !adding && (
            <button className="btn btn-secondary btn-sm wev-registrar" type="button" onClick={() => setAdding(true)}><FiPlus /> Registrar</button>
          )}
        </div>

        {error && (
          <div className="ds44-alert ds44-alert-danger" style={{ marginBottom: 'var(--space-2)' }}>
            <span className="ds44-alert-icon"><FiAlertTriangle size={16} /></span><span>{error}</span>
          </div>
        )}

        {adding && (
          <div className="wev-form">
            <label className="wev-campo">
              <span className="form-label">Tipo *</span>
              <input list="evidencia-tipos" className="form-input" placeholder="Ej: EXAMEN_ALTURA" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} />
            </label>
            <datalist id="evidencia-tipos">{TIPOS_COMUNES.map((t) => <option key={t} value={t} />)}</datalist>
            <label className="wev-campo">
              <span className="form-label">Nombre o descripción</span>
              <input className="form-input" placeholder="Opcional" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </label>
            <label className="wev-campo">
              <span className="form-label">Vence el</span>
              <input type="date" className="form-input" value={form.venceEn} onChange={(e) => setForm({ ...form, venceEn: e.target.value })} />
            </label>
            <label className="btn btn-secondary btn-sm wev-archivo">
              <FiUploadCloud /> {file ? file.name : 'Adjuntar archivo (opcional)'}
              <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <div className="wev-acciones">
              <button className="btn btn-secondary btn-sm" type="button" disabled={saving} onClick={() => { setAdding(false); setError(''); }}>Cancelar</button>
              <button className="btn btn-primary btn-sm" type="button" disabled={saving} onClick={guardar}>{saving ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        )}

        {evidencias.length === 0 ? (
          <p className="wev-vacio">Sin evidencias registradas.</p>
        ) : (
          <div className="wev-lista">
            {evidencias.map((e, i) => {
              const ok = vigente(e);
              return (
                <div key={`${e.tipo}-${i}`} className="wev-fila">
                  <div className="wev-fila-main">
                    {ok ? <LuCircleCheck size={16} className="wev-ok" aria-label="Vigente" /> : <LuClock size={16} className="wev-vencida" aria-label="Vencida" />}
                    <div style={{ minWidth: 0 }}>
                      <div className="wev-nombre">{e.nombre || e.tipo}</div>
                      <div className="wev-meta">
                        {e.tipo}{e.venceEn ? ` · ${ok ? 'vigente hasta' : 'vencida el'} ${e.venceEn}` : ' · sin vencimiento'}
                      </div>
                    </div>
                  </div>
                  {e.fileKey && (
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => preview(e.fileKey!)} title="Ver archivo" aria-label={`Ver archivo de ${e.nombre || e.tipo}`}><FiEye /></button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <style>{`
          .wev-head {
            display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; min-height: 42px;
            padding-bottom: 9px; margin-bottom: 14px; border-bottom: 1px solid var(--surface-border);
          }
          .wev-head h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
          .wev-head > span { font-size: 11.5px; color: var(--text-secondary); }
          .wev-registrar { margin-left: auto; }
          .wev-form {
            display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 16px; margin-bottom: 14px;
            padding: 16px; border: 1px solid var(--surface-border); border-radius: 12px;
          }
          .wev-campo { display: flex; flex-direction: column; min-width: 0; }
          .wev-archivo { justify-self: start; grid-column: 1 / -1; cursor: pointer; }
          .wev-acciones { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; }
          .wev-vacio { margin: 0; font-size: 13px; color: var(--text-muted); }
          .wev-lista { display: flex; flex-direction: column; border: 1px solid var(--surface-border); border-radius: 12px; overflow: hidden; }
          .wev-fila { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--surface-border); }
          .wev-fila:last-child { border-bottom: none; }
          .wev-fila-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
          .wev-ok { flex-shrink: 0; color: var(--success-apagado); }
          .wev-vencida { flex-shrink: 0; color: var(--danger-alerta); }
          .wev-nombre { font-size: 13.5px; font-weight: 500; color: var(--text-primary); }
          .wev-meta { font-size: 12px; color: var(--text-secondary); }
          @media (max-width: 720px) { .wev-form { grid-template-columns: minmax(0, 1fr); } }
        `}</style>
    </section>
  );
}
