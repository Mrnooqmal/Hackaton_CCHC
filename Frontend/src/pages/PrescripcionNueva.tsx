import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiAlertCircle, FiClock } from 'react-icons/fi';
import { FieldSection, FormPage, PageHeader, SegmentedControl } from '../components/ui';
import { CampoArchivo, ErrorCampo, ResumenErrores, type EstadoSubida } from '../components/prescripciones/PrescripcionUi';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { useToast } from '../context/ToastContext';
import { subirComoDocumento } from '../utils/subirDocumento';
import { estructuraApi, type OrigenPrescripcion } from '../api/estructura.api';
import {
    campoDeErrorServidor, diasEntre, finDelDia, fmtFecha, hoy, inicioDelDia, sumarDias, validarNueva,
    type CampoNueva, type ErrorCampo as ErrorDeCampo,
} from '../utils/prescripciones';
import '../css/prescripciones.css';

/**
 * Registrar una prescripción — DS 44 Art. 70. Pantalla completa, mismo patrón
 * que Nueva persona (canvas: PrescripcionNuevaPantalla[Errores]).
 *
 * Los errores viven en el formulario: un resumen bajo el encabezado que recibe
 * el foco, y el mensaje bajo el campo que lo causa, con la forma de arreglarlo.
 * Nada de lo escrito se pierde al fallar, tampoco el archivo ya subido.
 */

const ORIGENES: { value: OrigenPrescripcion; nombre: string; desc: string }[] = [
    { value: 'OrganismoFiscalizador', nombre: 'Organismo fiscalizador', desc: 'Dirección del Trabajo, SEREMI de Salud' },
    { value: 'OrganismoAdministrador', nombre: 'Organismo Administrador', desc: 'Mutualidad o ISL · Ley 16.744' },
    { value: 'DepartamentoPrevencion', nombre: 'Departamento de Prevención', desc: 'El de la propia empresa' },
    { value: 'ComiteParitario', nombre: 'Comité Paritario', desc: 'Acuerdo del comité de la obra' },
];

const ETIQUETA: Record<CampoNueva, string> = {
    descripcion: 'Medida prescrita',
    fechaPrescripcion: 'Fecha de la prescripción',
    plazo: 'Plazo de implementación',
    documento: 'Documento que la origina',
};

/** El servidor junta sus errores en una sola frase: se separan por oración. */
const separarErrores = (msg: string) => msg.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ])/).filter(Boolean);

export default function PrescripcionNueva() {
    const { user } = useAuth();
    const { selectedObraId } = useObraContext();
    const { toast } = useToast();
    const navigate = useNavigate();
    const tenantId = user?.tenantId;

    const [form, setForm] = useState({
        origen: 'OrganismoFiscalizador' as OrigenPrescripcion,
        descripcion: '',
        fechaPrescripcion: hoy(),
        conPlazo: false,
        plazo: '',
    });
    const [archivo, setArchivo] = useState<File | null>(null);
    const [subida, setSubida] = useState<EstadoSubida>('listo');
    const [errorSubida, setErrorSubida] = useState<string | null>(null);
    // El documento subido se guarda: si después falla el registro, reintentar
    // no lo vuelve a subir.
    const [documentoId, setDocumentoId] = useState<string | null>(null);

    const [intentado, setIntentado] = useState(false);
    const [erroresServidor, setErroresServidor] = useState<ErrorDeCampo<CampoNueva>[]>([]);
    const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    const resumenRef = useRef<HTMLDivElement>(null);

    const cambiar = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
        setForm((f) => ({ ...f, [k]: v }));
        setErroresServidor([]);
        setErrorGeneral(null);
    };

    const elegirArchivo = (f: File | null) => {
        setArchivo(f);
        setDocumentoId(null);
        setSubida('listo');
        setErrorSubida(null);
    };

    // Tras el primer intento la validación corre en vivo: el error desaparece
    // en cuanto el campo queda bien, sin volver a enviar.
    const errores = useMemo(() => {
        const lista = intentado ? validarNueva(form) : [];
        const porCampo = new Map(lista.map((e) => [e.campo, e]));
        for (const e of erroresServidor) if (!porCampo.has(e.campo)) porCampo.set(e.campo, e);
        if (subida === 'error') {
            porCampo.set('documento', {
                campo: 'documento', resumen: 'el archivo no se pudo subir',
                mensaje: `No se pudo subir: ${errorSubida || 'error de conexión'}`,
            });
        }
        return porCampo;
    }, [intentado, form, erroresServidor, subida, errorSubida]);

    const errorDe = (c: CampoNueva) => errores.get(c);

    const irA = (campo: string) => {
        const el = document.getElementById(`pr-${campo}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.focus({ preventScroll: true });
    };

    const enfocarResumen = () => requestAnimationFrame(() => {
        resumenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        resumenRef.current?.focus({ preventScroll: true });
    });

    const registrar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!tenantId || guardando) return;
        setIntentado(true);
        setErroresServidor([]);
        setErrorGeneral(null);
        if (validarNueva(form).length > 0) { enfocarResumen(); return; }

        setGuardando(true);
        try {
            let docId = documentoId;
            if (archivo && !docId) {
                setSubida('subiendo');
                try {
                    docId = await subirComoDocumento({
                        file: archivo, tipo: 'ACTA_REGISTRO',
                        titulo: `Prescripción de medidas · ${fmtFecha(form.fechaPrescripcion)}`,
                        tenantId, obraId: selectedObraId, fecha: form.fechaPrescripcion,
                    });
                    setDocumentoId(docId);
                    setSubida('subido');
                } catch (err) {
                    setSubida('error');
                    setErrorSubida(err instanceof Error ? err.message : 'error de conexión');
                    enfocarResumen();
                    return;
                }
            }

            const res = await estructuraApi.crearPrescripcion(tenantId, {
                obraId: selectedObraId || null,
                origen: form.origen,
                fechaPrescripcion: inicioDelDia(form.fechaPrescripcion),
                descripcion: form.descripcion.trim(),
                plazoImplementacion: form.conPlazo && form.plazo ? finDelDia(form.plazo) : null,
                documentoPrescripcionId: docId,
                solicitanteId: user?.personaId,
            });
            if (!res.success) {
                const deCampo: ErrorDeCampo<CampoNueva>[] = [];
                const sueltos: string[] = [];
                for (const m of separarErrores(res.error || 'No se pudo registrar la prescripción.')) {
                    const campo = campoDeErrorServidor(m);
                    if (campo && campo in ETIQUETA) deCampo.push({ campo: campo as CampoNueva, resumen: m, mensaje: m });
                    else sueltos.push(m);
                }
                setErroresServidor(deCampo);
                setErrorGeneral(sueltos.length ? sueltos.join(' ') : null);
                enfocarResumen();
                return;
            }
            toast.success('Prescripción registrada.');
            navigate('/prescripciones');
        } catch {
            setErrorGeneral('Error de conexión. Tus datos siguen acá: intenta nuevamente.');
            enfocarResumen();
        } finally {
            setGuardando(false);
        }
    };

    // ── Lo que va a pasar, dicho antes de guardar ──────────────────────────────
    const plazoValido = form.conPlazo && form.plazo && !errorDe('plazo') && form.plazo >= form.fechaPrescripcion;
    let avisoPlazo: React.ReactNode = null;
    if (plazoValido) {
        const dias = diasEntre(hoy(), form.plazo);
        avisoPlazo = dias < 0
            ? <>El plazo ya pasó: quedará como <b>Vencida</b> al registrarla.</>
            : <>{dias === 0 ? 'Vence hoy.' : `${dias} día${dias === 1 ? '' : 's'} para implementarla.`} Desde el {fmtFecha(sumarDias(form.plazo, 1))} aparecerá como <b>Vencida</b>.</>;
    }

    const nErrores = errores.size;
    const hayResumen = nErrores > 0 || Boolean(errorGeneral);

    return (
        <>
            <div className="page-content">
                <PageHeader
                    banner
                    title="Registrar prescripción"
                    breadcrumb={[{ label: 'Prescripciones', to: '/prescripciones' }]}
                    description="Regístrala tal como la recibiste. Queda Pendiente y pasa sola a Vencida si se cumple el plazo · DS 44 Art. 70."
                />
            </div>

            <FormPage
                maxWidth={960}
                onSubmit={registrar}
                header={<></>}
                actions={
                    <>
                        {nErrores > 0 ? (
                            <span className="pr-pie-form pr-pie-form--error">
                                <FiAlertCircle size={13} /> {nErrores} campo{nErrores === 1 ? '' : 's'} por revisar
                            </span>
                        ) : (
                            <span className="pr-pie-form">
                                <FiClock size={13} />
                                {plazoValido ? `Quedará Pendiente · vence el ${fmtFecha(form.plazo)}` : 'Quedará Pendiente · sin plazo, no vence'}
                            </span>
                        )}
                        <button type="button" className="btn btn-secondary" onClick={() => navigate('/prescripciones')}>
                            Cancelar
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={guardando}>
                            {subida === 'subiendo' ? 'Subiendo documento…' : guardando ? 'Registrando…' : 'Registrar prescripción'}
                        </button>
                    </>
                }
            >
                {hayResumen && (
                    <ResumenErrores
                        ref={resumenRef}
                        titulo={nErrores > 0
                            ? `Aún no se registra: revisa ${nErrores} campo${nErrores === 1 ? '' : 's'}`
                            : 'Aún no se registra'}
                        general={errorGeneral}
                        items={[...errores.values()].map((e) => ({ campo: e.campo, etiqueta: ETIQUETA[e.campo], resumen: e.resumen }))}
                        onIr={irA}
                    />
                )}

                <FieldSection title="Quién la ordenó" inline description="El organismo que emitió la orden">
                    <div className="pr-full pr-origenes-grid" role="radiogroup" aria-label="Quién la ordenó">
                        {ORIGENES.map((o) => (
                            <label key={o.value} className={`pr-origen${form.origen === o.value ? ' pr-origen--on' : ''}`}>
                                <input
                                    type="radio" name="origen" value={o.value}
                                    checked={form.origen === o.value}
                                    onChange={() => cambiar('origen', o.value)}
                                />
                                <span className="pr-radio" aria-hidden="true" />
                                <span className="pr-origen-texto">
                                    <span className="pr-origen-nombre">{o.nombre}</span>
                                    <span className="pr-origen-desc">{o.desc}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                </FieldSection>

                <FieldSection title="La medida" inline description="Cópiala como aparece en el documento: así se reconoce en una segunda visita">
                    <div className={`pr-campo pr-full${errorDe('descripcion') ? ' pr-campo--error' : ''}`}>
                        <label className="form-label" htmlFor="pr-descripcion">Medida prescrita <span className="pr-req">*</span></label>
                        <textarea
                            id="pr-descripcion"
                            className={`form-input${errorDe('descripcion') ? ' pr-input-error' : ''}`}
                            rows={3}
                            style={{ resize: 'vertical' }}
                            placeholder="Qué se ordenó implementar y dónde"
                            value={form.descripcion}
                            aria-invalid={Boolean(errorDe('descripcion')) || undefined}
                            aria-describedby={errorDe('descripcion') ? 'pr-descripcion-error' : undefined}
                            onChange={(e) => cambiar('descripcion', e.target.value)}
                        />
                        {errorDe('descripcion') && <ErrorCampo id="pr-descripcion-error">{errorDe('descripcion')!.mensaje}</ErrorCampo>}
                    </div>
                </FieldSection>

                <FieldSection title="Fechas y plazo" inline cols={3} description="El plazo define cuándo pasa a Vencida. Sin plazo queda pendiente, pero no vence">
                    <div className={`pr-campo${errorDe('fechaPrescripcion') ? ' pr-campo--error' : ''}`}>
                        <label className="form-label" htmlFor="pr-fechaPrescripcion">Fecha de la prescripción <span className="pr-req">*</span></label>
                        <input
                            id="pr-fechaPrescripcion" type="date" max={hoy()}
                            className={`form-input pr-fecha${errorDe('fechaPrescripcion') ? ' pr-input-error' : ''}`}
                            value={form.fechaPrescripcion}
                            aria-invalid={Boolean(errorDe('fechaPrescripcion')) || undefined}
                            aria-describedby={errorDe('fechaPrescripcion') ? 'pr-fechaPrescripcion-error' : 'pr-fechaPrescripcion-hint'}
                            onChange={(e) => cambiar('fechaPrescripcion', e.target.value)}
                        />
                        {errorDe('fechaPrescripcion') ? (
                            <>
                                <ErrorCampo id="pr-fechaPrescripcion-error">{errorDe('fechaPrescripcion')!.mensaje}</ErrorCampo>
                                {form.fechaPrescripcion > hoy() && (
                                    <button type="button" className="pr-arreglo" onClick={() => cambiar('fechaPrescripcion', hoy())}>
                                        Usar hoy, {fmtFecha(hoy(), false)}
                                    </button>
                                )}
                            </>
                        ) : (
                            <span id="pr-fechaPrescripcion-hint" className="pr-hint">La que figura en el documento. Hoy o antes.</span>
                        )}
                    </div>

                    <div className="pr-campo">
                        <span className="form-label" id="pr-conplazo-label">¿Indica un plazo?</span>
                        <SegmentedControl
                            ariaLabel="¿La prescripción indica un plazo?"
                            value={form.conPlazo ? 'si' : 'no'}
                            onChange={(v) => cambiar('conPlazo', v === 'si')}
                            options={[{ value: 'no', label: 'Sin plazo' }, { value: 'si', label: 'Con plazo' }]}
                        />
                    </div>

                    {form.conPlazo ? (
                        <div className={`pr-campo${errorDe('plazo') ? ' pr-campo--error' : ''}`}>
                            <label className="form-label" htmlFor="pr-plazo">Plazo de implementación <span className="pr-req">*</span></label>
                            <input
                                id="pr-plazo" type="date" min={form.fechaPrescripcion}
                                className={`form-input pr-fecha${errorDe('plazo') ? ' pr-input-error' : ''}`}
                                value={form.plazo}
                                aria-invalid={Boolean(errorDe('plazo')) || undefined}
                                aria-describedby={errorDe('plazo') ? 'pr-plazo-error' : 'pr-plazo-hint'}
                                onChange={(e) => cambiar('plazo', e.target.value)}
                            />
                            {errorDe('plazo') ? (
                                <ErrorCampo id="pr-plazo-error">{errorDe('plazo')!.mensaje}</ErrorCampo>
                            ) : avisoPlazo ? (
                                <span id="pr-plazo-hint" className="pr-hint pr-hint-icono" style={{ color: 'var(--text-primary)' }}>
                                    <FiClock size={13} style={{ color: 'var(--text-secondary)' }} /><span>{avisoPlazo}</span>
                                </span>
                            ) : (
                                <span id="pr-plazo-hint" className="pr-hint">La fecha límite que indica el documento.</span>
                            )}
                        </div>
                    ) : (
                        <div className="pr-campo">
                            <span className="form-label">Plazo de implementación</span>
                            <span className="pr-hint" style={{ paddingTop: 10 }}>
                                Sin plazo la medida queda pendiente hasta que registres su implementación, pero no vence.
                            </span>
                        </div>
                    )}
                </FieldSection>

                <FieldSection title="Documento que la origina" inline description="Opcional. Sin él queda registrada igual, pero un fiscalizador lo pedirá como respaldo">
                    <div className={`pr-campo pr-full${errorDe('documento') ? ' pr-campo--error' : ''}`}>
                        <CampoArchivo
                            id="pr-documento"
                            archivo={archivo}
                            onArchivo={elegirArchivo}
                            estado={subida}
                            errorSubida={errorSubida}
                            descripcion="Informe de fiscalización, acta u orden · PDF o imagen"
                        />
                        {subida === 'error' && (
                            <span className="pr-hint">El archivo y el resto del formulario se mantienen: vuelve a intentar.</span>
                        )}
                    </div>
                </FieldSection>
            </FormPage>
        </>
    );
}
