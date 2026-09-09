import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiAlertTriangle, FiInfo, FiTrash2 } from 'react-icons/fi';
import { AlertBanner, PageHeader, Select, Stepper } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { personasApi } from '../api/personas.api';
import type { PersonaResponse } from '../api/types';
import { estructuraApi, type ConstituirOrganoData } from '../api/estructura.api';
import {
    AMBITO, CALIDAD, CARGO_ORGANO, ESTAMENTO, ORIGEN, TIPO_ORGANO,
    TIPO_ORGANO_LABEL, dotacionDeEmpresa, dotacionDeObra, dotacionEfectiva,
    fechaTerminoMandato, hayCphsVigente, obligacionesDeAmbito, origenSegunObligacion,
    validarMiembros, type Ambito, type Calidad, type CargoOrgano, type Estamento,
    type MiembroBorrador, type TipoOrgano,
} from '../utils/estructuraPreventiva';

/**
 * Asistente de constitución de un órgano preventivo (secciones 5.3, 5.6, 5.7 y 5.8).
 *
 * Un solo asistente para las cuatro figuras: el comité paritario necesita tres
 * pasos (datos, integrantes, documentos) y las demás solo dos, porque su
 * "composición" es una persona. Separarlos en cuatro pantallas duplicaría el
 * cálculo de mandato, las validaciones y el enganche a documentos.
 *
 * ALCANCE: el sistema NO verifica que la persona designada cumpla los requisitos
 * legales del cargo ni que la investidura sea real. Eso es responsabilidad de la
 * entidad empleadora y así se le dice al usuario en pantalla.
 */

type Paso = 'datos' | 'integrantes' | 'documentos';

const ESTAMENTO_OPCIONES = [
    { value: ESTAMENTO.EMPLEADOR, label: 'Entidad empleadora (designado)' },
    { value: ESTAMENTO.TRABAJADORES, label: 'Personas trabajadoras (electo)' },
];
const CALIDAD_OPCIONES = [
    { value: CALIDAD.TITULAR, label: 'Titular' },
    { value: CALIDAD.SUPLENTE, label: 'Suplente' },
];
const CARGO_OPCIONES = [
    { value: CARGO_ORGANO.PRESIDENTE, label: 'Presidente' },
    { value: CARGO_ORGANO.SECRETARIO, label: 'Secretario' },
    { value: CARGO_ORGANO.INTEGRANTE, label: 'Integrante' },
];

/** Cargo único de las figuras unipersonales. */
const CARGO_UNIPERSONAL: Partial<Record<TipoOrgano, CargoOrgano>> = {
    [TIPO_ORGANO.DELEGADO_SST]: CARGO_ORGANO.DELEGADO,
    [TIPO_ORGANO.DEPARTAMENTO_PREVENCION]: CARGO_ORGANO.EXPERTO_RESPONSABLE,
    [TIPO_ORGANO.ENCARGADO_GESTION_RIESGO]: CARGO_ORGANO.ENCARGADO,
};

/** Cómo se llama la fecha de origen en cada figura, en su lenguaje del decreto. */
const LABEL_FECHA_ORIGEN: Record<TipoOrgano, string> = {
    ComiteParitario: 'Fecha de elección de los representantes',
    DelegadoSST: 'Fecha de la asamblea de elección',
    DepartamentoPrevencion: 'Fecha de creación del departamento',
    EncargadoGestionRiesgo: 'Fecha de designación',
};

const hoyISO = () => new Date().toISOString().slice(0, 10);

export default function EstructuraConstituir() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { user } = useAuth();
    const { toast } = useToast();

    const tenantId = (user as any)?.tenantId as string | undefined;
    const ambito = (params.get('ambito') === AMBITO.OBRA ? AMBITO.OBRA : AMBITO.EMPRESA) as Ambito;
    const obraId = params.get('obraId');
    const tipo = (params.get('tipo') || TIPO_ORGANO.COMITE_PARITARIO) as TipoOrgano;
    const esComite = tipo === TIPO_ORGANO.COMITE_PARITARIO;

    const [paso, setPaso] = useState<Paso>('datos');
    const [personas, setPersonas] = useState<PersonaResponse[]>([]);
    const [organosAmbito, setOrganosAmbito] = useState<{ tipo: TipoOrgano; estado?: string; fechaTerminoMandato?: string | null }[]>([]);
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [fechaOrigen, setFechaOrigen] = useState(hoyISO());
    const [fechaConstitucion, setFechaConstitucion] = useState(hoyISO());
    const [terminoMandato, setTerminoMandato] = useState<string>('');
    const [miembros, setMiembros] = useState<MiembroBorrador[]>([]);

    // ── Carga ────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!tenantId) return;
        let vivo = true;
        (async () => {
            setCargando(true);
            const [resPersonas, resOrganos] = await Promise.all([
                personasApi.list(tenantId).catch(() => null),
                estructuraApi.listar(tenantId, { ambito, obraId }).catch(() => null),
            ]);
            if (!vivo) return;
            const lista = (resPersonas as any)?.data?.personas || (resPersonas as any)?.data || [];
            setPersonas(Array.isArray(lista) ? lista : []);
            setOrganosAmbito(resOrganos?.success ? (resOrganos.data?.organos || []) as any : []);
            setCargando(false);
        })();
        return () => { vivo = false; };
    }, [tenantId, ambito, obraId]);

    // El mandato por defecto son 2 años; el usuario solo puede acortarlo.
    useEffect(() => {
        const calc = fechaTerminoMandato(fechaOrigen);
        if (calc) setTerminoMandato(calc.slice(0, 10));
    }, [fechaOrigen]);

    // ── Cálculo local (funciona sin conexión) ────────────────────────────────
    const dotacion = useMemo(() => {
        const calculada = ambito === AMBITO.OBRA
            ? dotacionDeObra(personas as any, obraId || '')
            : dotacionDeEmpresa(personas as any);
        return dotacionEfectiva({ calculada });
    }, [personas, ambito, obraId]);

    const obligaciones = useMemo(() => obligacionesDeAmbito({
        dotacion: dotacion.dotacion, ambito, hayCphsVigente: hayCphsVigente(organosAmbito as any),
    }), [dotacion.dotacion, ambito, organosAmbito]);

    const esObligatorio = Boolean(obligaciones[tipo]?.obligatorio);
    const origen = origenSegunObligacion(esObligatorio);

    const tieneMandatoFigura = esComite || tipo === TIPO_ORGANO.DELEGADO_SST;
    const topeMandato = useMemo(() => fechaTerminoMandato(fechaOrigen)?.slice(0, 10) || '', [fechaOrigen]);

    const erroresComposicion = useMemo(
        () => (miembros.length > 0 || esComite ? validarMiembros(miembros, tipo) : []),
        [miembros, tipo, esComite]
    );

    const pasos = useMemo(() => (esComite
        ? [{ id: 'datos', label: 'Datos' }, { id: 'integrantes', label: 'Integrantes' }, { id: 'documentos', label: 'Documentos' }]
        : [{ id: 'datos', label: 'Datos' }, { id: 'integrantes', label: 'Persona designada' }]
    ), [esComite]);

    // ── Integrantes ──────────────────────────────────────────────────────────
    const agregarMiembro = () => setMiembros((prev) => [...prev, {
        personaId: '', nombre: '',
        estamento: esComite ? ESTAMENTO.EMPLEADOR : ESTAMENTO.NO_APLICA,
        calidad: CALIDAD.TITULAR,
        cargo: esComite ? CARGO_ORGANO.INTEGRANTE : (CARGO_UNIPERSONAL[tipo] || CARGO_ORGANO.INTEGRANTE),
    }]);

    const actualizarMiembro = (i: number, cambios: Partial<MiembroBorrador>) =>
        setMiembros((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...cambios } : m)));

    const quitarMiembro = (i: number) => setMiembros((prev) => prev.filter((_, idx) => idx !== i));

    const nombreDe = (personaId: string) => {
        const p = personas.find((x) => x.personaId === personaId);
        return p ? `${p.nombre} ${(p as any).apellido || ''}`.trim() : '';
    };

    // ── Guardar ──────────────────────────────────────────────────────────────
    const constituir = useCallback(async () => {
        if (!tenantId) return;
        setError(null);

        const errores = validarMiembros(miembros, tipo);
        if (errores.length > 0) { setError(errores.join(' ')); return; }

        setGuardando(true);
        const data: ConstituirOrganoData = {
            ambito, obraId,
            tipo,
            fechaEleccionODesignacion: new Date(`${fechaOrigen}T12:00:00`).toISOString(),
            fechaConstitucion: new Date(`${fechaConstitucion}T12:00:00`).toISOString(),
            fechaTerminoMandato: tieneMandatoFigura && terminoMandato
                ? new Date(`${terminoMandato}T12:00:00`).toISOString()
                : null,
            miembros: miembros.map((m) => ({
                personaId: m.personaId,
                nombre: m.nombre || nombreDe(m.personaId),
                estamento: m.estamento,
                calidad: m.calidad,
                cargo: m.cargo,
                origenDesignacion: m.estamento === ESTAMENTO.TRABAJADORES ? 'Electo' : 'Designado',
            })),
            solicitanteId: (user as any)?.personaId,
        };

        const res = await estructuraApi.constituir(tenantId, data);
        setGuardando(false);

        if (!res.success || !res.data) {
            // El backend valida lo mismo que el formulario: si algo pasó igual,
            // su mensaje es el que manda.
            setError(res.error || 'No se pudo constituir el órgano.');
            return;
        }
        toast.success(
            tieneMandatoFigura
                ? 'Órgano constituido. Se generaron las reuniones ordinarias del mandato.'
                : 'Órgano constituido.'
        );
        navigate(`/estructura/organos/${res.data.organo.organoId}`);
    }, [tenantId, miembros, tipo, ambito, obraId, fechaOrigen, fechaConstitucion,
        terminoMandato, tieneMandatoFigura, user, toast, navigate, personas]);

    if (!tenantId) return <div className="page"><AlertBanner variant="error" message="No hay empresa activa." /></div>;

    return (
        <div className="page">
            <PageHeader
                title={`Constituir ${TIPO_ORGANO_LABEL[tipo]}`}
                description={ambito === AMBITO.OBRA ? 'Ámbito: esta obra o faena' : 'Ámbito: entidad empleadora'}
            />

            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

            <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                <Stepper
                    steps={pasos}
                    currentIndex={pasos.findIndex((p) => p.id === paso)}
                />
            </div>

            {cargando ? (
                <div className="text-muted">Cargando…</div>
            ) : (
                <>
                    {/* ── Paso 1: datos ──────────────────────────────────── */}
                    {paso === 'datos' && (
                        <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                            {/* El origen se CALCULA y no se elige: constituir bajo el umbral
                                está permitido y queda registrado como voluntario. */}
                            <div className={`ds44-alert ${esObligatorio ? 'ds44-alert-warning' : 'ds44-alert-info'}`} style={{ fontSize: '0.85rem' }}>
                                <span className="ds44-alert-icon"><FiInfo size={14} /></span>
                                <span>
                                    {obligaciones[tipo]?.motivo}
                                    {' '}Quedará registrado como <strong>{origen === ORIGEN.OBLIGATORIO ? 'obligatorio' : 'voluntario'}</strong>.
                                </span>
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="ep-origen">{LABEL_FECHA_ORIGEN[tipo]} *</label>
                                <input id="ep-origen" type="date" className="form-input" max={hoyISO()}
                                    value={fechaOrigen} onChange={(e) => setFechaOrigen(e.target.value)} />
                                <span className="form-hint">No puede ser una fecha futura.</span>
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="ep-const">Fecha de constitución *</label>
                                <input id="ep-const" type="date" className="form-input" max={hoyISO()} min={fechaOrigen}
                                    value={fechaConstitucion} onChange={(e) => setFechaConstitucion(e.target.value)} />
                            </div>

                            {tieneMandatoFigura && (
                                <div className="form-group">
                                    <label className="form-label" htmlFor="ep-mandato">Término del mandato</label>
                                    <input id="ep-mandato" type="date" className="form-input" max={topeMandato} min={fechaOrigen}
                                        value={terminoMandato} onChange={(e) => setTerminoMandato(e.target.value)} />
                                    <span className="form-hint">
                                        Se calcula en 2 años desde la elección (Art. 23). Solo se puede acortar, nunca extender.
                                    </span>
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                                <button className="btn btn-secondary" type="button" onClick={() => navigate(-1)}>Cancelar</button>
                                <button className="btn btn-primary" type="button" onClick={() => setPaso('integrantes')}>Continuar</button>
                            </div>
                        </div>
                    )}

                    {/* ── Paso 2: integrantes ────────────────────────────── */}
                    {paso === 'integrantes' && (
                        <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                            <div className="ds44-alert ds44-alert-info" style={{ fontSize: '0.82rem' }}>
                                <span className="ds44-alert-icon"><FiInfo size={14} /></span>
                                <span>
                                    El sistema no verifica que las personas cumplan los requisitos legales del cargo
                                    ni que la designación sea válida: eso es responsabilidad de la entidad empleadora.
                                    Aquí solo se registra quién integra el órgano.
                                </span>
                            </div>

                            {esComite && (
                                <div className="text-muted" style={{ fontSize: '0.82rem' }}>
                                    El comité se compone de 3 representantes titulares de la entidad empleadora
                                    (designados) y 3 de las personas trabajadoras (electos), más sus suplentes.
                                    Uno debe ser presidente y otro secretario.
                                </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                {miembros.map((m, i) => (
                                    <div key={i} className="card" style={{ padding: 'var(--space-3)', display: 'grid', gap: 'var(--space-2)', gridTemplateColumns: esComite ? '2fr 1.4fr 1fr 1.2fr auto' : '2fr auto', alignItems: 'end' }}>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label className="form-label">Persona</label>
                                            <Select
                                                ariaLabel="Persona"
                                                placeholder="Seleccione"
                                                searchable
                                                value={m.personaId}
                                                onChange={(v) => actualizarMiembro(i, { personaId: v, nombre: nombreDe(v) })}
                                                options={personas.map((p) => ({
                                                    value: p.personaId,
                                                    label: `${p.nombre} ${(p as any).apellido || ''}`.trim(),
                                                    description: (p as any).rut || undefined,
                                                }))}
                                            />
                                        </div>
                                        {esComite && (
                                            <>
                                                <div className="form-group" style={{ margin: 0 }}>
                                                    <label className="form-label">Estamento</label>
                                                    <Select ariaLabel="Estamento" value={m.estamento}
                                                        onChange={(v) => actualizarMiembro(i, { estamento: v as Estamento })}
                                                        options={ESTAMENTO_OPCIONES} />
                                                </div>
                                                <div className="form-group" style={{ margin: 0 }}>
                                                    <label className="form-label">Calidad</label>
                                                    <Select ariaLabel="Calidad" value={m.calidad}
                                                        onChange={(v) => actualizarMiembro(i, { calidad: v as Calidad })}
                                                        options={CALIDAD_OPCIONES} />
                                                </div>
                                                <div className="form-group" style={{ margin: 0 }}>
                                                    <label className="form-label">Cargo</label>
                                                    <Select ariaLabel="Cargo" value={m.cargo}
                                                        onChange={(v) => actualizarMiembro(i, { cargo: v as CargoOrgano })}
                                                        options={CARGO_OPCIONES} />
                                                </div>
                                            </>
                                        )}
                                        <button className="btn btn-ghost btn-sm" type="button" title="Quitar"
                                            onClick={() => quitarMiembro(i)}>
                                            <FiTrash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div>
                                <button className="btn btn-secondary btn-sm" type="button" onClick={agregarMiembro}
                                    disabled={!esComite && miembros.length >= 1}>
                                    {esComite ? 'Agregar integrante' : 'Designar persona'}
                                </button>
                            </div>

                            {erroresComposicion.length > 0 && (
                                <div className="ds44-alert ds44-alert-warning" style={{ fontSize: '0.82rem', display: 'block' }}>
                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: 4 }}>
                                        <FiAlertTriangle size={14} /> <strong>Falta corregir</strong>
                                    </div>
                                    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                                        {erroresComposicion.map((e, i) => <li key={i}>{e}</li>)}
                                    </ul>
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                                <button className="btn btn-secondary" type="button" onClick={() => setPaso('datos')}>Atrás</button>
                                {esComite ? (
                                    <button className="btn btn-primary" type="button"
                                        disabled={erroresComposicion.length > 0}
                                        onClick={() => setPaso('documentos')}>Continuar</button>
                                ) : (
                                    <button className="btn btn-primary" type="button"
                                        disabled={guardando || erroresComposicion.length > 0 || miembros.length === 0}
                                        onClick={constituir}>
                                        {guardando ? 'Constituyendo…' : 'Constituir'}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Paso 3: documentos ─────────────────────────────── */}
                    {paso === 'documentos' && (
                        <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                            {/* Se permite constituir con documentos pendientes (§5.3): el
                                órgano queda vigente y la completitud lo muestra parcial. */}
                            <div className="ds44-alert ds44-alert-info" style={{ fontSize: '0.82rem' }}>
                                <span className="ds44-alert-icon"><FiInfo size={14} /></span>
                                <span>
                                    El acta de elección, la designación de la entidad empleadora y el acta de
                                    constitución se cargan y se envían a firma desde el detalle del órgano.
                                    Puedes constituirlo ahora y adjuntarlas después: quedará vigente, con la
                                    documentación marcada como pendiente.
                                </span>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                                <button className="btn btn-secondary" type="button" onClick={() => setPaso('integrantes')}>Atrás</button>
                                <button className="btn btn-primary" type="button" disabled={guardando} onClick={constituir}>
                                    {guardando ? 'Constituyendo…' : 'Constituir comité'}
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
