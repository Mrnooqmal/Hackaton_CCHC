import { useCallback, useRef, useState } from 'react';
import { FiCalendar, FiCheck, FiClock, FiPaperclip, FiSend, FiUploadCloud } from 'react-icons/fi';
import { Badge, Select } from './ui';
import { documentsApi } from '../api/documents.api';
import { subirComoDocumento } from '../utils/subirDocumento';
import { DESTINATARIO_LABEL, MEDIO_LABEL } from '../utils/difusion';
import type { DistribucionRequisito, EstadoDestinatario } from '../utils/completitud';

/**
 * Constancias de envío de un documento — Art. 57 inc. 2 y equivalentes.
 *
 * ES GENÉRICO A PROPÓSITO. Los ítems 4, 11, 25, 37, 50 y 51 exigen el mismo
 * hecho —documento, destinatarios, fecha— con distintos destinatarios y plazos.
 * Este panel no sabe cuál es el ítem 50: pinta el desglose que el motor le pasa.
 * Cuando otro ítem devuelva su bloque `distribucion`, funciona sin tocar nada.
 *
 * NO calcula. El estado de cada destinatario, quién es exigible y si el envío
 * llegó a tiempo lo resuelve el servidor con la misma función que evalúa el
 * formulario. Recalcularlo acá sería garantizar que algún día discrepen.
 *
 * Tampoco verifica que el envío haya ocurrido: registra lo declarado, con su
 * fecha, su medio y su respaldo, que es lo que el fiscalizador pide ver.
 */

export interface DistribucionPanelProps {
    distribucion: DistribucionRequisito;
    tenantId: string;
    obraId?: string | null;
    /** Se llama tras registrar un envío o declarar la vigencia, para recargar. */
    onCambio: () => void | Promise<void>;
}

const ESTADO_META: Record<EstadoDestinatario['estado'], {
    label: string; variant: 'success' | 'warning' | 'danger' | 'neutral';
}> = {
    Enviado: { label: 'Enviado', variant: 'success' },
    FueraDePlazo: { label: 'Fuera de plazo', variant: 'danger' },
    Pendiente: { label: 'Sin constancia', variant: 'warning' },
    NoAplica: { label: 'No aplica', variant: 'neutral' },
};

const MEDIOS = ['Correo', 'Entrega', 'Plataforma', 'Otro'] as const;

const hoyISO = () => new Date().toISOString().slice(0, 10);
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CL') : '—');
const aISO = (fecha: string) => new Date(`${fecha}T12:00:00`).toISOString();

export default function DistribucionPanel({ distribucion, tenantId, obraId = null, onCambio }: DistribucionPanelProps) {
    const { resultado, fechaVigencia, exigeVigencia, diasExigidos, articulo, documentoId } = distribucion;

    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);

    const [editandoVigencia, setEditandoVigencia] = useState(false);
    const [vigencia, setVigencia] = useState(fechaVigencia?.slice(0, 10) || '');

    // Formulario en línea bajo el destinatario, no en un panel encima del panel.
    const [registrando, setRegistrando] = useState<string | null>(null);
    const [medio, setMedio] = useState<string>('Correo');
    const [fechaEnvio, setFechaEnvio] = useState(hoyISO());
    const [observacion, setObservacion] = useState('');
    const [evidencia, setEvidencia] = useState<File | null>(null);
    const evidenciaRef = useRef<HTMLInputElement>(null);

    const cerrarFormulario = () => {
        setRegistrando(null);
        setEvidencia(null);
        setObservacion('');
        setMedio('Correo');
        setFechaEnvio(hoyISO());
    };

    const guardarVigencia = useCallback(async () => {
        if (!vigencia) return;
        setGuardando(true);
        setError(null);
        try {
            const res = await documentsApi.update(documentoId, { fechaEntradaVigencia: aISO(vigencia) });
            if (!res.success) throw new Error(res.error || 'No se pudo guardar la fecha.');
            setEditandoVigencia(false);
            await onCambio();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error al guardar la fecha de vigencia.');
        } finally {
            setGuardando(false);
        }
    }, [vigencia, documentoId, onCambio]);

    const registrarEnvio = useCallback(async (tipo: string) => {
        setGuardando(true);
        setError(null);
        try {
            let evidenciaDocumentoId: string | null = null;
            if (evidencia) {
                evidenciaDocumentoId = await subirComoDocumento({
                    file: evidencia, tipo: 'ACTA_REGISTRO', tenantId, obraId,
                    categoria: 'difusion',
                    titulo: `Respaldo de envío · ${DESTINATARIO_LABEL[tipo] || tipo}`,
                });
            }
            const res = await documentsApi.registrarDifusion(documentoId, {
                destinatarioTipo: tipo,
                medio: medio as 'Correo' | 'Entrega' | 'Plataforma' | 'Otro',
                fecha: aISO(fechaEnvio),
                evidenciaDocumentoId,
                observacion: observacion.trim() || null,
            });
            if (!res.success) throw new Error(res.error || 'No se pudo registrar la constancia.');
            cerrarFormulario();
            await onCambio();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error al registrar la constancia.');
        } finally {
            setGuardando(false);
        }
    }, [evidencia, tenantId, obraId, documentoId, medio, fechaEnvio, observacion, onCambio]);

    const faltaVigencia = exigeVigencia && !fechaVigencia;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* La fecha de vigencia es la que hace medible el plazo. Sin ella el
                requisito queda parcial para siempre, así que se pide primero y con
                la consecuencia escrita, no como un campo más. */}
            <div className="card" style={{ padding: 'var(--space-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <FiCalendar size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
                        {fechaVigencia ? `Rige desde el ${fmt(fechaVigencia)}` : 'Falta declarar desde cuándo rige'}
                    </span>
                    {!editandoVigencia && (
                        <button
                            className="btn btn-secondary btn-sm"
                            type="button"
                            style={{ marginLeft: 'auto' }}
                            onClick={() => setEditandoVigencia(true)}
                        >
                            {fechaVigencia ? 'Cambiar' : 'Declarar fecha'}
                        </button>
                    )}
                </div>

                {editandoVigencia ? (
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
                        <input
                            type="date"
                            className="form-input"
                            style={{ width: 'auto', minWidth: 160 }}
                            value={vigencia}
                            onChange={(e) => setVigencia(e.target.value)}
                            aria-label="Fecha de entrada en vigencia"
                        />
                        <button className="btn btn-primary btn-sm" type="button" disabled={!vigencia || guardando} onClick={guardarVigencia}>
                            {guardando ? 'Guardando…' : 'Guardar'}
                        </button>
                        <button
                            className="btn btn-ghost btn-sm" type="button"
                            onClick={() => { setEditandoVigencia(false); setVigencia(fechaVigencia?.slice(0, 10) || ''); }}
                        >
                            Cancelar
                        </button>
                    </div>
                ) : (
                    <span className="form-hint">
                        {faltaVigencia
                            ? `El ${articulo} mide la anticipación del envío contra esta fecha. Sin declararla el requisito no se puede cerrar, aunque ya se haya informado a todos.`
                            : `Se exige informar con ${diasExigidos} días corridos de anticipación (${articulo}).`}
                    </span>
                )}
            </div>

            {error && (
                <div className="ds44-alert ds44-alert-danger" style={{ fontSize: 'var(--text-sm)' }}>
                    <span className="ds44-alert-icon"><FiClock size={14} /></span>
                    <span>{error}</span>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {resultado.detalle.map((d) => {
                    const meta = ESTADO_META[d.estado];
                    const abierto = registrando === d.tipo;
                    const puedeRegistrar = d.estado !== 'NoAplica';

                    return (
                        <div key={d.tipo} className="ds44-doc-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                                <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                                    <div className="font-medium" style={{ fontSize: '0.88rem' }}>
                                        {DESTINATARIO_LABEL[d.tipo] || d.tipo}
                                    </div>
                                    {/* La razón del "no aplica" se muestra siempre: ocultar por
                                        qué algo salió del denominador es peor que no excluirlo. */}
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                        {d.detalle}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                                    <Badge variant={meta.variant}>
                                        {d.estado === 'Enviado' && <FiCheck size={12} />} {meta.label}
                                    </Badge>
                                    {puedeRegistrar && !abierto && (
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            type="button"
                                            onClick={() => { cerrarFormulario(); setRegistrando(d.tipo); }}
                                        >
                                            <FiSend size={13} /> {d.estado === 'Pendiente' ? 'Registrar envío' : 'Registrar otro'}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {abierto && (
                                <div style={{
                                    marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)',
                                    borderTop: '1px solid var(--surface-border)',
                                    display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
                                }}>
                                    <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                                        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                                            <label className="form-label" htmlFor={`medio-${d.tipo}`}>Medio</label>
                                            <Select
                                                ariaLabel="Medio del envío"
                                                value={medio}
                                                onChange={setMedio}
                                                options={MEDIOS.map((m) => ({ value: m, label: MEDIO_LABEL[m] }))}
                                            />
                                        </div>
                                        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                                            <label className="form-label" htmlFor={`fecha-${d.tipo}`}>Fecha del envío</label>
                                            <input
                                                id={`fecha-${d.tipo}`}
                                                type="date"
                                                className="form-input"
                                                max={hoyISO()}
                                                value={fechaEnvio}
                                                onChange={(e) => setFechaEnvio(e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="form-label" htmlFor={`obs-${d.tipo}`}>Observación</label>
                                        <input
                                            id={`obs-${d.tipo}`}
                                            type="text"
                                            className="form-input"
                                            placeholder="Opcional: a qué correo, quién recibió, número de acta"
                                            value={observacion}
                                            onChange={(e) => setObservacion(e.target.value)}
                                        />
                                    </div>

                                    <div>
                                        <label className="form-label">Respaldo</label>
                                        <input
                                            ref={evidenciaRef}
                                            type="file"
                                            accept="application/pdf,image/*"
                                            style={{ display: 'none' }}
                                            onChange={(e) => setEvidencia(e.target.files?.[0] || null)}
                                        />
                                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => evidenciaRef.current?.click()}>
                                                <FiUploadCloud size={13} /> Seleccionar archivo
                                            </button>
                                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {evidencia ? <><FiPaperclip size={11} /> {evidencia.name}</> : 'Opcional'}
                                            </span>
                                        </div>
                                        <span className="form-hint">
                                            El acuse de recibo, el acta de entrega o la captura del correo.
                                        </span>
                                    </div>

                                    <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                        <button className="btn btn-ghost btn-sm" type="button" onClick={cerrarFormulario}>
                                            Cancelar
                                        </button>
                                        <button
                                            className="btn btn-primary btn-sm"
                                            type="button"
                                            disabled={guardando}
                                            onClick={() => registrarEnvio(d.tipo)}
                                        >
                                            {guardando ? 'Registrando…' : 'Registrar constancia'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {resultado.excluidos > 0 && (
                <span className="form-hint">
                    {resultado.excluidos} destinatario(s) fuera del denominador: no existen en este ámbito
                    y no informarles no penaliza.
                </span>
            )}
        </div>
    );
}
