import { useCallback, useRef, useState } from 'react';
import { FiCalendar, FiCheck, FiClock, FiPaperclip, FiSend, FiUploadCloud } from 'react-icons/fi';
import { Select } from './ui';
import { documentsApi } from '../api/documents.api';
import { subirComoDocumento } from '../utils/subirDocumento';
import { DESTINATARIO_LABEL, MEDIO_LABEL } from '../utils/difusion';
import type { DistribucionRequisito, EstadoDestinatario } from '../utils/completitud';
import '../css/obra.css';
import '../css/repositorio-ds44.css';

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

/** Mismas etiquetas de estado que la obra y el repositorio (clases ob-etiqueta). */
const ESTADO_META: Record<EstadoDestinatario['estado'], { label: string; clase: string }> = {
    Enviado: { label: 'Enviado', clase: 'Cumplido' },
    FueraDePlazo: { label: 'Fuera de plazo', clase: 'Vencido' },
    Pendiente: { label: 'Sin constancia', clase: 'Pendiente' },
    NoAplica: { label: 'No aplica', clase: 'NoAplica' },
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
        <div className="dp">
            {/* La fecha de vigencia es la que hace medible el plazo. Sin ella el
                requisito queda parcial para siempre, así que se pide primero y con
                la consecuencia escrita, no como un campo más. */}
            <section className="dp-bloque" aria-label="Vigencia del documento">
                <span className="ob-rotulo">Vigencia</span>
                <div className="dp-vigencia">
                    <FiCalendar size={14} aria-hidden="true" />
                    <span className={faltaVigencia ? 'dp-vigencia__falta' : undefined}>
                        {fechaVigencia ? `Rige desde el ${fmt(fechaVigencia)}` : 'Falta declarar desde cuándo rige'}
                    </span>
                    {!editandoVigencia && (
                        <button className="ob-btn" type="button" onClick={() => setEditandoVigencia(true)}>
                            {fechaVigencia ? 'Cambiar' : 'Declarar fecha'}
                        </button>
                    )}
                </div>
                {editandoVigencia ? (
                    <div className="dp-acciones">
                        <input
                            type="date"
                            className="form-input dp-campo--fecha"
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
                    <p className="dp-nota">
                        {faltaVigencia
                            ? `El ${articulo} mide la anticipación del envío contra esta fecha. Sin declararla el requisito no se puede cerrar, aunque ya se haya informado a todos.`
                            : diasExigidos
                                ? `Se exige informar con ${diasExigidos} días corridos de anticipación (${articulo}).`
                                : `Se exige informar a los destinatarios del ${articulo}.`}
                    </p>
                )}
            </section>

            {error && (
                <div className="ds44-alert ds44-alert-danger" style={{ fontSize: 'var(--text-sm)' }}>
                    <span className="ds44-alert-icon"><FiClock size={14} /></span>
                    <span>{error}</span>
                </div>
            )}

            <section className="dp-bloque" aria-label="Destinatarios">
                <span className="ob-rotulo">Destinatarios</span>
                <div className="ob-lista">
                    {resultado.detalle.map((d) => {
                        const meta = ESTADO_META[d.estado];
                        const abierto = registrando === d.tipo;
                        const puedeRegistrar = d.estado !== 'NoAplica';
                        const accion = d.estado === 'Pendiente' ? 'Registrar envío' : 'Registrar otro envío';

                        return (
                            <div key={d.tipo} className="dp-destinatario">
                                <div className="dp-destinatario__fila">
                                    <span className="dp-destinatario__texto">
                                        <span className="dp-destinatario__nombre">{DESTINATARIO_LABEL[d.tipo] || d.tipo}</span>
                                        {/* La razón del "no aplica" se muestra siempre: ocultar por
                                            qué algo salió del denominador es peor que no excluirlo. */}
                                        <span className="dp-destinatario__detalle">{d.detalle}</span>
                                    </span>
                                    <span className={`ob-etiqueta ob-etiqueta--${meta.clase}`}>
                                        {d.estado === 'Enviado' && <FiCheck size={11} />} {meta.label}
                                    </span>
                                    {puedeRegistrar && !abierto ? (
                                        <button
                                            className="rd-icono" type="button" aria-label={accion} title={accion}
                                            onClick={() => { cerrarFormulario(); setRegistrando(d.tipo); }}
                                        >
                                            <FiSend size={15} />
                                        </button>
                                    ) : <span />}
                                </div>

                                {abierto && (
                                    <div className="dp-formulario">
                                        <div className="dp-campos">
                                            <label className="dp-campo">
                                                <span className="form-label">Medio</span>
                                                <Select
                                                    ariaLabel="Medio del envío"
                                                    value={medio}
                                                    onChange={setMedio}
                                                    options={MEDIOS.map((m) => ({ value: m, label: MEDIO_LABEL[m] }))}
                                                />
                                            </label>
                                            <label className="dp-campo dp-campo--fecha">
                                                <span className="form-label">Fecha del envío</span>
                                                <input
                                                    type="date"
                                                    className="form-input"
                                                    max={hoyISO()}
                                                    value={fechaEnvio}
                                                    onChange={(e) => setFechaEnvio(e.target.value)}
                                                />
                                            </label>
                                        </div>

                                        <label className="dp-campo dp-campo--ancho">
                                            <span className="form-label">Observación</span>
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder="Opcional: a qué correo, quién recibió, número de acta"
                                                value={observacion}
                                                onChange={(e) => setObservacion(e.target.value)}
                                            />
                                        </label>

                                        <div className="dp-campo dp-campo--ancho">
                                            <span className="form-label">Respaldo</span>
                                            <input
                                                ref={evidenciaRef}
                                                type="file"
                                                accept="application/pdf,image/*"
                                                style={{ display: 'none' }}
                                                onChange={(e) => setEvidencia(e.target.files?.[0] || null)}
                                            />
                                            <span className="dp-acciones">
                                                <button className="ob-btn" type="button" onClick={() => evidenciaRef.current?.click()}>
                                                    <FiUploadCloud size={14} /> Seleccionar archivo
                                                </button>
                                                <span className="dp-archivo">
                                                    {evidencia ? <><FiPaperclip size={11} /> {evidencia.name}</> : 'Opcional'}
                                                </span>
                                            </span>
                                            <span className="dp-nota">El acuse de recibo, el acta de entrega o la captura del correo.</span>
                                        </div>

                                        <div className="dp-acciones">
                                            <button className="btn btn-primary btn-sm" type="button" disabled={guardando} onClick={() => registrarEnvio(d.tipo)}>
                                                {guardando ? 'Registrando…' : 'Registrar constancia'}
                                            </button>
                                            <button className="btn btn-ghost btn-sm" type="button" onClick={cerrarFormulario}>
                                                Cancelar
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                {resultado.excluidos > 0 && (
                    <p className="dp-nota">
                        {resultado.excluidos} destinatario(s) fuera del denominador: no existen en este ámbito
                        y no informarles no penaliza.
                    </p>
                )}
            </section>
        </div>
    );
}
