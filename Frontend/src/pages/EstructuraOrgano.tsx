import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FiAlertTriangle, FiCheck, FiInfo, FiUploadCloud } from 'react-icons/fi';
import { AlertBanner, Badge, Modal, PageHeader, Select } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { uploadsApi } from '../api/uploads.api';
import { documentsApi } from '../api/documents.api';
import { estructuraApi, type OrganoCompleto, type ReunionOrgano } from '../api/estructura.api';
import {
    CAUSAL_EXTRAORDINARIA, CAUSAL_LABEL, ESTADO_ORGANO, ESTADO_REUNION,
    FUNCIONES_CPHS_ART47, TIPO_ORGANO, TIPO_ORGANO_LABEL, TIPO_REUNION,
    estadoDocumentoPeriodico, fechaLimiteCursoOpr, periodoAnual,
    type CausalExtraordinaria,
} from '../utils/estructuraPreventiva';

/**
 * Detalle de un órgano preventivo: integrantes, acreditaciones, documentos y
 * reuniones (secciones 5.3 a 5.9 del encargo).
 *
 * Reglas que la pantalla respeta y no puede saltarse, porque el backend las
 * valida igual:
 *   - Una reunión no se marca realizada sin acta adjunta.
 *   - Una ordinaria solo se reagenda dentro de su propio mes.
 *   - El curso OPR, la capacitación del OAL y el registro Seremi son lo mismo:
 *     un check más un documento. Sin flujo propio.
 *
 * El CONTENIDO del acta (materias, acuerdos y sus plazos) es responsabilidad del
 * usuario: el sistema no lo desglosa ni lo verifica.
 */

/** Documentos que el órgano puede llevar adjuntos, por tipo de figura. */
const DOCUMENTOS_ORGANO: Record<string, Array<{ clave: string; tipo: string; label: string; ayuda: string }>> = {
    ComiteParitario: [
        { clave: 'actaEleccion', tipo: 'ACTA_ELECCION_REPRESENTANTES', label: 'Acta de elección de representantes', ayuda: 'De las personas trabajadoras (Art. 23).' },
        { clave: 'designacionEmpleador', tipo: 'DESIGNACION_REPRESENTANTES_EMPLEADOR', label: 'Designación de la entidad empleadora', ayuda: 'Representantes designados por la empresa.' },
        { clave: 'actaConstitucion', tipo: 'ACTA_CONSTITUCION_CPHS', label: 'Acta de constitución', ayuda: 'Es la que se registra en la Dirección del Trabajo.' },
        { clave: 'comprobanteDT', tipo: 'COMPROBANTE_REGISTRO_DT', label: 'Comprobante de registro en la DT', ayuda: 'Opcional. Dentro de 15 días hábiles desde la elección (Art. 36).' },
    ],
    DelegadoSST: [
        { clave: 'actaAsamblea', tipo: 'ACTA_ASAMBLEA_DELEGADO', label: 'Acta de asamblea de elección', ayuda: 'Elección cada 2 años (Art. 66).' },
    ],
    DepartamentoPrevencion: [
        { clave: 'registroSeremi', tipo: 'REGISTRO_SEREMI_EXPERTO', label: 'Registro Seremi del experto', ayuda: 'Inscripción del experto que dirige el departamento (Art. 55).' },
    ],
    EncargadoGestionRiesgo: [
        { clave: 'designacion', tipo: 'DESIGNACION_ENCARGADO_RIESGO', label: 'Designación del encargado', ayuda: 'Art. 65.' },
        { clave: 'capacitacionOAL', tipo: 'CERTIFICADO_CAPACITACION_ENCARGADO', label: 'Capacitación del Organismo Administrador', ayuda: 'Ítem 48 del FUF.' },
    ],
};

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CL') : '—');
const hoyISO = () => new Date().toISOString().slice(0, 10);

export default function EstructuraOrgano() {
    const { organoId } = useParams<{ organoId: string }>();
    const { user } = useAuth();
    const { toast } = useToast();
    const tenantId = (user as any)?.tenantId as string | undefined;

    const [organo, setOrgano] = useState<OrganoCompleto | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [subiendo, setSubiendo] = useState<string | null>(null);

    const [reunionActa, setReunionActa] = useState<ReunionOrgano | null>(null);
    const [fechaActa, setFechaActa] = useState(hoyISO());
    const [archivoActa, setArchivoActa] = useState<File | null>(null);
    const [guardandoActa, setGuardandoActa] = useState(false);
    const actaRef = useRef<HTMLInputElement>(null);

    const [subiendoAcuerdos, setSubiendoAcuerdos] = useState(false);
    const [programaDocs, setProgramaDocs] = useState<any[]>([]);
    const [subiendoPrograma, setSubiendoPrograma] = useState(false);
    const [nuevaExtra, setNuevaExtra] = useState(false);
    const [causal, setCausal] = useState<CausalExtraordinaria>(CAUSAL_EXTRAORDINARIA.PETICION_CONJUNTA);

    const cargar = useCallback(async () => {
        if (!tenantId || !organoId) return;
        setCargando(true);
        const res = await estructuraApi.obtener(tenantId, organoId);
        if (res.success && res.data) setOrgano(res.data);
        else setError(res.error || 'No se pudo cargar el órgano.');

        // El programa de trabajo (ítem 38) es un documento por período, no un
        // adjunto único del órgano: se lee del repositorio por tipo.
        const docs = await documentsApi.list({ tipo: 'PROGRAMA_TRABAJO_CPHS' } as any).catch(() => null);
        const lista = (docs as any)?.data?.documents || [];
        setProgramaDocs(Array.isArray(lista) ? lista : []);
        setCargando(false);
    }, [tenantId, organoId]);

    useEffect(() => { void cargar(); }, [cargar]);

    /** Sube un archivo y lo deja como Documento tipificado vinculado al órgano. */
    const subirDocumento = useCallback(async (clave: string, tipo: string, titulo: string, file: File) => {
        if (!tenantId || !organoId) return;
        setSubiendo(clave);
        try {
            const up = await uploadsApi.uploadFile(file, 'estructura-preventiva', tenantId, tenantId);
            if (!up.success || !up.data) throw new Error(up.error || 'No se pudo subir el archivo.');

            const doc = await documentsApi.create({
                tipo, titulo,
                archivoUrl: (up.data as any).url || (up.data as any).fileKey,
                archivoNombre: file.name,
                createdBy: (user as any)?.personaId,
                creatorName: user ? `${(user as any).nombre} ${(user as any).apellido || ''}`.trim() : undefined,
            } as any);
            const documentoId = (doc as any)?.data?.documentId;
            if (!doc.success || !documentoId) throw new Error(doc.error || 'No se pudo registrar el documento.');

            const res = await estructuraApi.vincularDocumento(tenantId, organoId, clave, documentoId);
            if (!res.success) throw new Error(res.error || 'No se pudo vincular el documento.');

            toast.success('Documento cargado.');
            await cargar();
        } catch (e: any) {
            toast.error(e?.message || 'Error al cargar el documento.');
        } finally {
            setSubiendo(null);
        }
    }, [tenantId, organoId, user, toast, cargar]);

    /** Registrar una reunión como realizada. Sin acta el backend responde 400. */
    const registrarActa = useCallback(async () => {
        if (!tenantId || !organoId || !reunionActa || !archivoActa) return;
        setGuardandoActa(true);
        try {
            const up = await uploadsApi.uploadFile(archivoActa, 'actas-cphs', tenantId, tenantId);
            if (!up.success || !up.data) throw new Error(up.error || 'No se pudo subir el acta.');

            const doc = await documentsApi.create({
                tipo: 'ACTA_REUNION_CPHS',
                titulo: `Acta de reunión ${reunionActa.periodoMes || 'extraordinaria'}`,
                archivoUrl: (up.data as any).url || (up.data as any).fileKey,
                archivoNombre: archivoActa.name,
                createdBy: (user as any)?.personaId,
            } as any);
            const documentoId = (doc as any)?.data?.documentId;
            if (!documentoId) throw new Error('No se pudo registrar el acta.');

            const res = await estructuraApi.registrarReunion(tenantId, organoId, reunionActa.reunionId, {
                fechaRealizada: new Date(`${fechaActa}T12:00:00`).toISOString(),
                actaDocumentoId: documentoId,
                solicitanteId: (user as any)?.personaId,
            });
            if (!res.success) throw new Error(res.error || 'No se pudo registrar la reunión.');

            toast.success('Reunión registrada.');
            setReunionActa(null);
            setArchivoActa(null);
            await cargar();
        } catch (e: any) {
            toast.error(e?.message || 'Error al registrar la reunión.');
        } finally {
            setGuardandoActa(false);
        }
    }, [tenantId, organoId, reunionActa, archivoActa, fechaActa, user, toast, cargar]);

    /** Ítem 36: la comunicación escrita de los acuerdos a la entidad empleadora es
     *  un documento más su fecha. Típicamente una captura del correo. No requiere
     *  firma: es evidencia de un envío, no una declaración que alguien suscribe. */
    const comunicarAcuerdos = useCallback(async (reunion: ReunionOrgano, file: File) => {
        if (!tenantId || !organoId) return;
        setSubiendoAcuerdos(true);
        try {
            const up = await uploadsApi.uploadFile(file, 'acuerdos-cphs', tenantId, tenantId);
            if (!up.success || !up.data) throw new Error(up.error || 'No se pudo subir el archivo.');
            const doc = await documentsApi.create({
                tipo: 'COMUNICACION_ACUERDOS_CPHS',
                titulo: `Comunicación de acuerdos ${reunion.periodoMes || ''}`.trim(),
                archivoUrl: (up.data as any).url || (up.data as any).fileKey,
                archivoNombre: file.name,
                createdBy: (user as any)?.personaId,
            } as any);
            const documentoId = (doc as any)?.data?.documentId;
            if (!documentoId) throw new Error('No se pudo registrar el documento.');

            const res = await estructuraApi.comunicarAcuerdos(tenantId, organoId, reunion.reunionId, documentoId);
            if (!res.success) throw new Error(res.error || 'No se pudo registrar la comunicación.');
            toast.success('Comunicación de acuerdos registrada.');
            await cargar();
        } catch (e: any) {
            toast.error(e?.message || 'Error al registrar la comunicación.');
        } finally {
            setSubiendoAcuerdos(false);
        }
    }, [tenantId, organoId, user, toast, cargar]);

    /** Programa de trabajo del comité, uno por período (ítem 38). */
    const subirPrograma = useCallback(async (file: File, periodo: string) => {
        if (!tenantId) return;
        setSubiendoPrograma(true);
        try {
            const up = await uploadsApi.uploadFile(file, 'programa-cphs', tenantId, tenantId);
            if (!up.success || !up.data) throw new Error(up.error || 'No se pudo subir el archivo.');
            const doc = await documentsApi.create({
                tipo: 'PROGRAMA_TRABAJO_CPHS',
                titulo: `Programa de trabajo del comité ${periodo}`,
                periodo,
                archivoUrl: (up.data as any).url || (up.data as any).fileKey,
                archivoNombre: file.name,
                createdBy: (user as any)?.personaId,
            } as any);
            if (!doc.success) throw new Error(doc.error || 'No se pudo registrar el programa.');
            toast.success('Programa de trabajo cargado.');
            await cargar();
        } catch (e: any) {
            toast.error(e?.message || 'Error al cargar el programa.');
        } finally {
            setSubiendoPrograma(false);
        }
    }, [tenantId, user, toast, cargar]);

    const crearExtraordinaria = useCallback(async () => {
        if (!tenantId || !organoId) return;
        const res = await estructuraApi.crearReunionExtraordinaria(tenantId, organoId, {
            causal, solicitanteId: (user as any)?.personaId,
        });
        if (res.success) { toast.success('Reunión extraordinaria creada.'); setNuevaExtra(false); await cargar(); }
        else toast.error(res.error || 'No se pudo crear la reunión.');
    }, [tenantId, organoId, causal, user, toast, cargar]);

    const marcarAcreditacion = useCallback(async (miembroId: string, realizada: boolean) => {
        if (!tenantId || !organoId) return;
        const res = await estructuraApi.acreditar(tenantId, organoId, miembroId, {
            realizada, fecha: realizada ? new Date().toISOString() : null,
        });
        if (res.success) await cargar();
        else toast.error(res.error || 'No se pudo actualizar.');
    }, [tenantId, organoId, toast, cargar]);

    const ordinarias = useMemo(
        () => (organo?.reuniones || []).filter((r) => r.tipo === TIPO_REUNION.ORDINARIA),
        [organo]
    );
    const extraordinarias = useMemo(
        () => (organo?.reuniones || []).filter((r) => r.tipo === TIPO_REUNION.EXTRAORDINARIA),
        [organo]
    );

    if (cargando) return <div className="page"><div className="text-muted">Cargando órgano…</div></div>;
    if (error || !organo) return <div className="page"><AlertBanner variant="error" message={error || 'Órgano no encontrado.'} /></div>;

    const docsFigura = DOCUMENTOS_ORGANO[organo.tipo] || [];
    const esComite = organo.tipo === TIPO_ORGANO.COMITE_PARITARIO;
    const limiteOpr = fechaLimiteCursoOpr(organo.fechaEleccionODesignacion);

    return (
        <div className="page">
            <PageHeader
                title={TIPO_ORGANO_LABEL[organo.tipo]}
                description={organo.ambito === 'obra' ? 'Ámbito: obra o faena' : 'Ámbito: entidad empleadora'}
                backTo={organo.obraId ? `/obras/${organo.obraId}` : '/mi-empresa'}
                actions={
                    organo.estado === ESTADO_ORGANO.VIGENTE ? (
                        <button className="btn btn-secondary btn-sm" type="button"
                            onClick={async () => {
                                if (!tenantId || !organoId) return;
                                const res = await estructuraApi.disolver(tenantId, organoId, undefined, (user as any)?.personaId);
                                if (res.success) { toast.success('Órgano disuelto.'); await cargar(); }
                                else toast.error(res.error || 'No se pudo disolver.');
                            }}>
                            Disolver
                        </button>
                    ) : null
                }
            />

            {/* ── Datos ─────────────────────────────────────────────────── */}
            <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-3)', display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                <div>
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>Estado</div>
                    <Badge variant={organo.estado === ESTADO_ORGANO.VIGENTE ? 'success' : organo.estado === ESTADO_ORGANO.VENCIDO ? 'danger' : 'neutral'}>
                        {organo.estado}
                    </Badge>
                </div>
                <div>
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>Origen</div>
                    <Badge variant={organo.origen === 'Obligatorio' ? 'info' : 'secondary'}>{organo.origen}</Badge>
                </div>
                <div>
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>Elección / designación</div>
                    <div style={{ fontSize: '0.9rem' }}>{fmt(organo.fechaEleccionODesignacion)}</div>
                </div>
                <div>
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>Constitución</div>
                    <div style={{ fontSize: '0.9rem' }}>{fmt(organo.fechaConstitucion)}</div>
                </div>
                {organo.fechaTerminoMandato && (
                    <div>
                        <div className="text-muted" style={{ fontSize: '0.75rem' }}>Término del mandato</div>
                        <div style={{ fontSize: '0.9rem' }}>{fmt(organo.fechaTerminoMandato)}</div>
                    </div>
                )}
                <div>
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>Dotación al constituir</div>
                    <div style={{ fontSize: '0.9rem' }}>{organo.dotacionAlConstituir}</div>
                </div>
            </div>

            {/* ── Integrantes ───────────────────────────────────────────── */}
            <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-3)' }}>
                <div className="font-medium" style={{ marginBottom: 'var(--space-2)' }}>Integrantes</div>
                {esComite && limiteOpr && (
                    <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 'var(--space-2)' }}>
                        Los integrantes electos que no tengan el curso de orientación en prevención de riesgos
                        deben realizarlo antes del {fmt(limiteOpr)} (Art. 32, primer semestre del mandato).
                    </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {organo.miembros.map((m) => (
                        <div key={m.miembroId} className="ds44-doc-row">
                            <div style={{ minWidth: 0 }}>
                                <div className="font-medium" style={{ fontSize: '0.9rem' }}>{m.nombre || m.personaId}</div>
                                <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                                    {m.cargo}
                                    {esComite && ` · ${m.estamento === 'Empleador' ? 'Entidad empleadora' : 'Personas trabajadoras'} · ${m.calidad}`}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                                <Badge variant={m.acreditacion?.realizada ? 'success' : 'warning'}>
                                    {m.acreditacion?.realizada ? <><FiCheck size={12} /> Acreditado</> : 'Sin acreditar'}
                                </Badge>
                                <button className="btn btn-secondary btn-sm" type="button"
                                    onClick={() => marcarAcreditacion(m.miembroId, !m.acreditacion?.realizada)}>
                                    {m.acreditacion?.realizada ? 'Quitar' : 'Marcar realizada'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Documentos ────────────────────────────────────────────── */}
            <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-3)' }}>
                <div className="font-medium" style={{ marginBottom: 'var(--space-2)' }}>Documentos</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {docsFigura.map((d) => {
                        const cargado = Boolean(organo.documentos?.[d.clave]);
                        return (
                            <div key={d.clave} className="ds44-doc-row">
                                <div style={{ minWidth: 0 }}>
                                    <div className="font-medium" style={{ fontSize: '0.9rem' }}>{d.label}</div>
                                    <div className="text-muted" style={{ fontSize: '0.78rem' }}>{d.ayuda}</div>
                                </div>
                                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                                    <Badge variant={cargado ? 'success' : 'warning'}>{cargado ? 'Cargado' : 'Pendiente'}</Badge>
                                    <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                                        {subiendo === d.clave ? 'Subiendo…' : <><FiUploadCloud size={13} /> {cargado ? 'Reemplazar' : 'Cargar'}</>}
                                        <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                                            disabled={subiendo !== null}
                                            onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f) void subirDocumento(d.clave, d.tipo, d.label, f);
                                                e.target.value = '';
                                            }} />
                                    </label>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Programa de trabajo del comité (ítem 38) ──────────────── */}
            {esComite && (() => {
                const periodo = periodoAnual();
                const { estado, documento } = estadoDocumentoPeriodico(programaDocs, periodo);
                return (
                    <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-3)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 0 }}>
                                <div className="font-medium">Programa de trabajo · {periodo}</div>
                                <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                                    Un programa por período. Las funciones del Art. 47 son su contenido.
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                                <Badge variant={estado === 'Cargado' ? 'success' : estado === 'Vencido' ? 'danger' : 'warning'}>
                                    {estado}
                                </Badge>
                                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                                    {subiendoPrograma ? 'Subiendo…' : <><FiUploadCloud size={13} /> {documento ? 'Reemplazar' : 'Cargar'}</>}
                                    <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                                        disabled={subiendoPrograma}
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) void subirPrograma(f, periodo);
                                            e.target.value = '';
                                        }} />
                                </label>
                            </div>
                        </div>
                        {/* Texto informativo, NO checklist: el sistema no verifica que el
                            archivo cubra estas funciones, y marcarlas daría una falsa
                            sensación de validación sobre algo que nadie comprobó. */}
                        <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: 'var(--space-2)' }}>
                            Funciones mínimas del comité (Art. 47), como referencia de contenido:
                            <ul style={{ margin: '4px 0 0', paddingLeft: '1.1rem' }}>
                                {FUNCIONES_CPHS_ART47.map((f, i) => <li key={i}>{f}</li>)}
                            </ul>
                        </div>
                    </div>
                );
            })()}

            {/* ── Reuniones ─────────────────────────────────────────────── */}
            {esComite && (
                <div className="card" style={{ padding: 'var(--space-4)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                        <div className="font-medium">Reuniones</div>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => setNuevaExtra(true)}>
                            Convocar extraordinaria
                        </button>
                    </div>
                    <div className="ds44-alert ds44-alert-info" style={{ fontSize: '0.8rem', marginBottom: 'var(--space-3)' }}>
                        <span className="ds44-alert-icon"><FiInfo size={14} /></span>
                        <span>
                            Las ordinarias son mensuales y se generaron al constituir el comité (Art. 39).
                            Para marcar una como realizada hay que adjuntar su acta. Las materias, los acuerdos
                            y sus plazos son contenido del acta: el sistema no los desglosa.
                        </span>
                    </div>

                    {[...extraordinarias, ...ordinarias].map((r) => {
                        const vencidaSinActa = r.estado === ESTADO_REUNION.PROGRAMADA
                            && new Date(r.fechaProgramada) < new Date();
                        return (
                            <div key={r.reunionId} className="ds44-doc-row">
                                <div style={{ minWidth: 0 }}>
                                    <div className="font-medium" style={{ fontSize: '0.9rem' }}>
                                        {r.tipo === TIPO_REUNION.ORDINARIA
                                            ? `Ordinaria ${r.periodoMes}`
                                            : `Extraordinaria · ${CAUSAL_LABEL[r.causalExtraordinaria as CausalExtraordinaria] || ''}`}
                                    </div>
                                    <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                                        {r.estado === ESTADO_REUNION.REALIZADA
                                            ? `Realizada el ${fmt(r.fechaRealizada)}`
                                            : `Programada para el ${fmt(r.fechaProgramada)}`}
                                        {r.comunicacionAcuerdosDocumentoId && ' · Acuerdos comunicados'}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                                    <Badge variant={
                                        r.estado === ESTADO_REUNION.REALIZADA ? 'success'
                                            : r.estado === ESTADO_REUNION.NO_REALIZADA ? 'neutral'
                                                : vencidaSinActa ? 'danger' : 'info'
                                    }>
                                        {r.estado === ESTADO_REUNION.REALIZADA ? 'Realizada'
                                            : r.estado === ESTADO_REUNION.NO_REALIZADA ? 'No realizada'
                                                : vencidaSinActa ? 'Sin acta' : 'Programada'}
                                    </Badge>
                                    {r.estado === ESTADO_REUNION.PROGRAMADA && (
                                        <button className="btn btn-secondary btn-sm" type="button"
                                            onClick={() => { setReunionActa(r); setFechaActa(r.fechaProgramada.slice(0, 10)); }}>
                                            Registrar acta
                                        </button>
                                    )}
                                    {r.estado === ESTADO_REUNION.REALIZADA && !r.comunicacionAcuerdosDocumentoId && (
                                        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                                            {subiendoAcuerdos ? 'Subiendo…' : 'Comunicar acuerdos'}
                                            <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                                                disabled={subiendoAcuerdos}
                                                onChange={(e) => {
                                                    const f = e.target.files?.[0];
                                                    if (f) void comunicarAcuerdos(r, f);
                                                    e.target.value = '';
                                                }} />
                                        </label>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Modal: registrar acta ─────────────────────────────────── */}
            <Modal
                isOpen={Boolean(reunionActa)}
                onClose={() => { setReunionActa(null); setArchivoActa(null); }}
                title="Registrar reunión realizada"
                footer={
                    <>
                        <button className="btn btn-secondary" type="button"
                            onClick={() => { setReunionActa(null); setArchivoActa(null); }}>Cancelar</button>
                        <button className="btn btn-primary" type="button"
                            disabled={!archivoActa || guardandoActa}
                            onClick={registrarActa}>
                            {guardandoActa ? 'Guardando…' : 'Registrar'}
                        </button>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div className="ds44-alert ds44-alert-warning" style={{ fontSize: '0.82rem' }}>
                        <span className="ds44-alert-icon"><FiAlertTriangle size={14} /></span>
                        <span>Sin el acta adjunta la reunión no se puede dar por realizada.</span>
                    </div>
                    <div className="form-group">
                        <label className="form-label" htmlFor="ep-fecha-acta">Fecha efectiva *</label>
                        <input id="ep-fecha-acta" type="date" className="form-input" max={hoyISO()}
                            value={fechaActa} onChange={(e) => setFechaActa(e.target.value)} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Acta de la reunión *</label>
                        <input ref={actaRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                            onChange={(e) => setArchivoActa(e.target.files?.[0] || null)} />
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => actaRef.current?.click()}>
                                <FiUploadCloud size={13} /> Seleccionar archivo
                            </button>
                            <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                                {archivoActa?.name || 'Ningún archivo seleccionado'}
                            </span>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* ── Modal: extraordinaria ─────────────────────────────────── */}
            <Modal
                isOpen={nuevaExtra}
                onClose={() => setNuevaExtra(false)}
                title="Convocar reunión extraordinaria"
                footer={
                    <>
                        <button className="btn btn-secondary" type="button" onClick={() => setNuevaExtra(false)}>Cancelar</button>
                        <button className="btn btn-primary" type="button" onClick={crearExtraordinaria}>Convocar</button>
                    </>
                }
            >
                <div className="form-group">
                    <label className="form-label">Causal *</label>
                    <Select
                        ariaLabel="Causal"
                        value={causal}
                        onChange={(v) => setCausal(v as CausalExtraordinaria)}
                        options={Object.values(CAUSAL_EXTRAORDINARIA).map((c) => ({ value: c, label: CAUSAL_LABEL[c] }))}
                    />
                    <span className="form-hint">Art. 39. La extraordinaria no cuenta para la periodicidad mensual.</span>
                </div>
            </Modal>
        </div>
    );
}
