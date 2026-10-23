import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { FiAlertCircle, FiArrowLeft, FiCheck, FiInfo, FiPaperclip } from 'react-icons/fi';
import { EmptyState, FieldSection, FormPage, PageHeader } from '../components/ui';
import {
    CampoArchivo, ChipEstado, Cronologia, ErrorCampo, ResumenErrores, type EstadoSubida,
} from '../components/prescripciones/PrescripcionUi';
import { useVistaDocumento } from '../hooks/useVistaDocumento';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { useToast } from '../context/ToastContext';
import { subirComoDocumento } from '../utils/subirDocumento';
import { estructuraApi, ORIGEN_PRESCRIPCION_LABEL, type Prescripcion } from '../api/estructura.api';
import {
    campoDeErrorServidor, describirCumplimiento, describirPlazo, fechaDe, fmt, fmtFecha, hoy, inicioDelDia,
    validarImplementacion, type CampoImplementacion, type ErrorCampo as ErrorDeCampo,
} from '../utils/prescripciones';
import '../css/prescripciones.css';

/**
 * Registrar la implementación de una prescripción — DS 44 Art. 70.
 * Pantalla completa (canvas: PrescripcionImplementarPantalla[Errores]).
 *
 * Primero se muestra QUÉ se cierra (la medida y su línea de tiempo) y después
 * los dos datos que exige la norma: fecha y evidencia. Si la subida de la
 * evidencia falla, el error queda en el archivo con "Reintentar".
 */

const ETIQUETA: Record<CampoImplementacion, string> = {
    fechaImplementacion: 'Fecha de implementación',
    evidencia: 'Evidencia',
};

const separarErrores = (msg: string) => msg.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ])/).filter(Boolean);

export default function PrescripcionImplementar() {
    const { id } = useParams<{ id: string }>();
    const location = useLocation();
    const { user } = useAuth();
    const { selectedObraId } = useObraContext();
    const { toast } = useToast();
    const navigate = useNavigate();
    const tenantId = user?.tenantId;

    // Desde el listado llega en el estado de la navegación; igual se recarga,
    // para no cerrar una medida con datos viejos (o al entrar por URL directa).
    const desdeListado = (location.state as { prescripcion?: Prescripcion } | null)?.prescripcion;
    const [p, setP] = useState<Prescripcion | null>(desdeListado?.prescripcionId === id ? desdeListado ?? null : null);
    const [cargando, setCargando] = useState(!p);
    const [noEncontrada, setNoEncontrada] = useState(false);

    const [fecha, setFecha] = useState(hoy());
    const [archivo, setArchivo] = useState<File | null>(null);
    const [subida, setSubida] = useState<EstadoSubida>('listo');
    const [errorSubida, setErrorSubida] = useState<string | null>(null);
    const [evidenciaId, setEvidenciaId] = useState<string | null>(null);

    const [intentado, setIntentado] = useState(false);
    const [erroresServidor, setErroresServidor] = useState<ErrorDeCampo<CampoImplementacion>[]>([]);
    const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    const resumenRef = useRef<HTMLDivElement>(null);

    const { abrir: abrirDocumento, visor } = useVistaDocumento(useCallback((m: string) => toast.error(m), [toast]));

    useEffect(() => {
        if (!tenantId || !id) return;
        let vigente = true;
        estructuraApi.listarPrescripciones(tenantId, selectedObraId).then((res) => {
            if (!vigente) return;
            const encontrada = res.success ? res.data?.prescripciones.find((x) => x.prescripcionId === id) : undefined;
            if (encontrada) setP(encontrada);
            else if (res.success) setNoEncontrada(true);
            else if (!p) setErrorGeneral(res.error || 'No se pudo cargar la prescripción.');
            setCargando(false);
        });
        return () => { vigente = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId, id, selectedObraId]);

    const fechaPrescripcion = fechaDe(p?.fechaPrescripcion);
    const plazo = fechaDe(p?.plazoImplementacion);

    const errores = useMemo(() => {
        const lista = intentado && p
            ? validarImplementacion({ fechaImplementacion: fecha, tieneEvidencia: Boolean(archivo) }, fechaPrescripcion)
            : [];
        const porCampo = new Map(lista.map((e) => [e.campo, e]));
        for (const e of erroresServidor) if (!porCampo.has(e.campo)) porCampo.set(e.campo, e);
        if (subida === 'error') {
            porCampo.set('evidencia', {
                campo: 'evidencia', resumen: 'el archivo no se pudo subir',
                mensaje: `No se pudo subir: ${errorSubida || 'error de conexión'}`,
            });
        }
        return porCampo;
    }, [intentado, p, fecha, archivo, fechaPrescripcion, erroresServidor, subida, errorSubida]);

    const errorDe = (c: CampoImplementacion) => errores.get(c);

    const irA = (campo: string) => {
        const el = document.getElementById(`pr-${campo}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.focus({ preventScroll: true });
    };
    const enfocarResumen = () => requestAnimationFrame(() => {
        resumenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        resumenRef.current?.focus({ preventScroll: true });
    });

    const elegirArchivo = (f: File | null) => {
        setArchivo(f);
        setEvidenciaId(null);
        setSubida('listo');
        setErrorSubida(null);
        setErroresServidor([]);
    };

    const guardar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!tenantId || !p || guardando) return;
        setIntentado(true);
        setErroresServidor([]);
        setErrorGeneral(null);
        if (validarImplementacion({ fechaImplementacion: fecha, tieneEvidencia: Boolean(archivo) }, fechaPrescripcion).length > 0) {
            enfocarResumen();
            return;
        }

        setGuardando(true);
        try {
            let docId = evidenciaId;
            if (!docId) {
                setSubida('subiendo');
                try {
                    docId = await subirComoDocumento({
                        file: archivo!, tipo: 'ACTA_REGISTRO',
                        titulo: `Evidencia de implementación · ${p.descripcion.slice(0, 60)}`,
                        tenantId, obraId: selectedObraId, fecha,
                    });
                    setEvidenciaId(docId);
                    setSubida('subido');
                } catch (err) {
                    setSubida('error');
                    setErrorSubida(err instanceof Error ? err.message : 'error de conexión');
                    enfocarResumen();
                    return;
                }
            }

            // Implementada el mismo día en que se prescribió: el inicio del día
            // quedaría antes del instante guardado de la prescripción y el
            // servidor lo rechazaría como "anterior". Se usa ese instante.
            const instante = inicioDelDia(fecha);
            const fechaImplementacion = instante < p.fechaPrescripcion ? p.fechaPrescripcion : instante;

            const res = await estructuraApi.actualizarPrescripcion(tenantId, p.prescripcionId, {
                fechaImplementacion,
                evidenciaImplementacionDocumentoId: docId,
            });
            if (!res.success) {
                const deCampo: ErrorDeCampo<CampoImplementacion>[] = [];
                const sueltos: string[] = [];
                for (const m of separarErrores(res.error || 'No se pudo registrar la implementación.')) {
                    const campo = campoDeErrorServidor(m);
                    if (campo && campo in ETIQUETA) deCampo.push({ campo: campo as CampoImplementacion, resumen: m, mensaje: m });
                    else sueltos.push(m);
                }
                setErroresServidor(deCampo);
                setErrorGeneral(sueltos.length ? sueltos.join(' ') : null);
                enfocarResumen();
                return;
            }
            toast.success('Implementación registrada.');
            navigate('/prescripciones');
        } catch {
            setErrorGeneral('Error de conexión. La fecha y el archivo siguen acá: intenta nuevamente.');
            enfocarResumen();
        } finally {
            setGuardando(false);
        }
    };

    const encabezado = (
        <div className="page-content">
            <PageHeader
                banner
                title="Registrar implementación"
                breadcrumb={[{ label: 'Prescripciones', to: '/prescripciones' }]}
                description="Con fecha y evidencia la medida pasa a Implementada. Registrarla tarde está bien: queda la fecha real junto al plazo."
            />
        </div>
    );

    if (cargando) {
        return (
            <>
                {encabezado}
                <div className="page-content" aria-busy="true" aria-label="Cargando la prescripción">
                    <div className="pr-medida">
                        <div className="pr-medida-info">
                            <div className="ui-skel ui-skel--linea" style={{ width: 200, height: 10 }} />
                            <div className="ui-skel ui-skel--linea" style={{ width: '80%', height: 16 }} />
                        </div>
                        <div className="ui-skel" style={{ height: 44 }} />
                    </div>
                </div>
            </>
        );
    }

    if (!p || noEncontrada || p.estado === 'Implementada') {
        return (
            <>
                {encabezado}
                <div className="page-content">
                    <EmptyState
                        icon={p?.estado === 'Implementada' ? <FiCheck size={34} /> : <FiInfo size={34} />}
                        title={p?.estado === 'Implementada' ? 'Esta medida ya está implementada' : 'No encontramos la prescripción'}
                        description={p?.estado === 'Implementada'
                            ? `Se registró como implementada el ${fmt(p.fechaImplementacion)}, con su evidencia.`
                            : errorGeneral || 'Puede que se haya eliminado o que pertenezca a otra obra.'}
                        action={{ label: 'Volver a prescripciones', onClick: () => navigate('/prescripciones'), icon: <FiArrowLeft size={15} /> }}
                    />
                </div>
            </>
        );
    }

    const nErrores = errores.size;
    const fechaValida = !errorDe('fechaImplementacion') && fecha && fecha <= hoy() && fecha >= fechaPrescripcion;
    const cumplimiento = fechaValida ? describirCumplimiento(fecha, plazo || null) : null;

    return (
        <>
            {encabezado}

            <FormPage
                maxWidth={1040}
                onSubmit={guardar}
                header={<></>}
                actions={
                    <>
                        {nErrores > 0 ? (
                            <span className="pr-pie-form pr-pie-form--error">
                                <FiAlertCircle size={13} /> {nErrores} punto{nErrores === 1 ? '' : 's'} por resolver
                            </span>
                        ) : (
                            <span className="pr-pie-form">
                                <FiCheck size={13} style={{ color: 'var(--success-apagado)' }} />
                                Pasará a Implementada{cumplimiento ? ` · ${cumplimiento}` : ''}
                            </span>
                        )}
                        <button type="button" className="btn btn-secondary" onClick={() => navigate('/prescripciones')}>
                            Cancelar
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={guardando}>
                            {subida === 'subiendo' ? 'Subiendo evidencia…' : guardando ? 'Guardando…' : 'Marcar implementada'}
                        </button>
                    </>
                }
            >
                {(nErrores > 0 || errorGeneral) && (
                    <ResumenErrores
                        ref={resumenRef}
                        titulo={`No se guardó: la medida sigue ${p.estado}`}
                        general={errorGeneral}
                        items={[...errores.values()].map((e) => ({ campo: e.campo, etiqueta: ETIQUETA[e.campo], resumen: e.resumen }))}
                        onIr={irA}
                    />
                )}

                <FieldSection title="Medida que se cierra" inline>
                    <div className="pr-full pr-medida">
                        <div className="pr-medida-info">
                            <div className="pr-eyebrow" style={{ marginBottom: 0 }}>
                                {ORIGEN_PRESCRIPCION_LABEL[p.origen]}
                                <ChipEstado estado={p.estado} />
                            </div>
                            <div className="pr-medida-titulo">{p.descripcion}</div>
                            {p.documentoPrescripcionId && (
                                <button
                                    type="button" className="pr-enlace" style={{ alignSelf: 'flex-start', fontSize: 12.5 }}
                                    onClick={() => abrirDocumento(p.documentoPrescripcionId!, 'Documento de la prescripción')}
                                >
                                    <FiPaperclip size={13} /> Ver el documento que la origina
                                </button>
                            )}
                        </div>
                        <Cronologia hitos={[
                            { etiqueta: 'Prescrita', valor: fmt(p.fechaPrescripcion) },
                            plazo
                                ? { etiqueta: 'Plazo', valor: `${fmtFecha(plazo, false)} · ${describirPlazo(plazo)}`, tono: p.estado === 'Vencida' ? 'alerta' : undefined }
                                : { etiqueta: 'Plazo', valor: 'Sin plazo' },
                            { etiqueta: 'Implementación', valor: fechaValida ? fmtFecha(fecha) : 'la que registres ahora', tono: 'accent' },
                        ]} />
                    </div>
                </FieldSection>

                <FieldSection title="Implementación" inline description="El Art. 70 exige implementarla, no solo recibirla: fecha y evidencia son obligatorias">
                    <div className="pr-full pr-impl-grid">
                        <div className={`pr-campo${errorDe('fechaImplementacion') ? ' pr-campo--error' : ''}`}>
                            <label className="form-label" htmlFor="pr-fechaImplementacion">Fecha de implementación <span className="pr-req">*</span></label>
                            <input
                                id="pr-fechaImplementacion" type="date" min={fechaPrescripcion} max={hoy()}
                                className={`form-input pr-fecha${errorDe('fechaImplementacion') ? ' pr-input-error' : ''}`}
                                value={fecha}
                                aria-invalid={Boolean(errorDe('fechaImplementacion')) || undefined}
                                aria-describedby={errorDe('fechaImplementacion') ? 'pr-fechaImplementacion-error pr-fechaImplementacion-hint' : 'pr-fechaImplementacion-hint'}
                                onChange={(e) => { setFecha(e.target.value); setErroresServidor([]); setErrorGeneral(null); }}
                            />
                            {errorDe('fechaImplementacion') && (
                                <ErrorCampo id="pr-fechaImplementacion-error">{errorDe('fechaImplementacion')!.mensaje}</ErrorCampo>
                            )}
                            <span id="pr-fechaImplementacion-hint" className="pr-hint">
                                Entre el {fmtFecha(fechaPrescripcion)}, cuando se prescribió, y hoy.
                            </span>
                            {errorDe('fechaImplementacion') && fecha > hoy() && (
                                <button type="button" className="pr-arreglo" onClick={() => setFecha(hoy())}>Usar hoy, {fmtFecha(hoy(), false)}</button>
                            )}
                        </div>

                        <div className={`pr-campo${errorDe('evidencia') ? ' pr-campo--error' : ''}`}>
                            <span className="form-label" id="pr-evidencia-label">Evidencia <span className="pr-req">*</span></span>
                            <CampoArchivo
                                id="pr-evidencia"
                                archivo={archivo}
                                onArchivo={elegirArchivo}
                                estado={subida}
                                errorSubida={errorSubida}
                                invalido={Boolean(errorDe('evidencia'))}
                                describedBy={errorDe('evidencia') && subida !== 'error' ? 'pr-evidencia-error' : undefined}
                                descripcion="Fotos, acta de cierre, informe o factura · PDF o imagen"
                            />
                            {errorDe('evidencia') && subida !== 'error' && (
                                <ErrorCampo id="pr-evidencia-error">{errorDe('evidencia')!.mensaje}</ErrorCampo>
                            )}
                            {subida === 'error' && (
                                <span className="pr-hint">El archivo y la fecha se mantienen: vuelve a intentar.</span>
                            )}
                        </div>

                        <aside className="pr-guia" aria-label="Qué sirve como evidencia">
                            <span className="pr-guia-titulo"><FiInfo size={14} style={{ color: 'var(--text-secondary)' }} />Qué sirve como evidencia</span>
                            <p>Fotos de la medida instalada, acta de cierre firmada, informe técnico o factura de la compra. PDF o imagen.</p>
                            <p>El sistema guarda el respaldo; que demuestre la implementación es responsabilidad de quien lo sube.</p>
                        </aside>
                    </div>
                </FieldSection>
            </FormPage>

            {visor}
        </>
    );
}
