import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    FiAlertTriangle, FiCheck, FiClock, FiPaperclip, FiPlus, FiUploadCloud,
} from 'react-icons/fi';
import { AlertBanner, Badge, DataTable, Drawer, EmptyState, PageHeader, Select, SegmentedControl } from '../components/ui';
import type { DataTableColumn } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { useToast } from '../context/ToastContext';
import { subirComoDocumento } from '../utils/subirDocumento';
import {
    estructuraApi, ORIGEN_PRESCRIPCION_LABEL,
    type EstadoPrescripcion, type OrigenPrescripcion, type Prescripcion,
} from '../api/estructura.api';

/**
 * Prescripciones de medidas — DS 44 Art. 70 (ítem 58 del FUF).
 *
 * La norma obliga a IMPLEMENTAR lo que ordenen los fiscalizadores, el Organismo
 * Administrador, el Departamento de Prevención o el comité. Recibir la
 * prescripción no cierra nada, así que esta pantalla es de seguimiento: lo que
 * importa de un vistazo es qué está vencido.
 *
 * Decisiones de interfaz:
 *   - El formulario va en panel lateral y no en modal: son seis campos con dos
 *     adjuntos, y el listado tiene que seguir visible mientras se registra.
 *   - El estado NO se elige. Se deriva del plazo y de la evidencia, igual que en
 *     el backend. Un selector de estado invitaría a marcar "implementada" sin
 *     respaldo, que es justo lo que la norma no admite.
 *   - Vacío no es un error: sin prescripciones el ítem 58 está cumplido, y el
 *     estado vacío lo dice en vez de mostrar un hueco.
 */

const ESTADO_META: Record<EstadoPrescripcion, {
    label: string; variant: 'success' | 'warning' | 'danger'; icono: React.ReactNode;
}> = {
    Implementada: { label: 'Implementada', variant: 'success', icono: <FiCheck size={12} /> },
    Pendiente: { label: 'Pendiente', variant: 'warning', icono: <FiClock size={12} /> },
    Vencida: { label: 'Vencida', variant: 'danger', icono: <FiAlertTriangle size={12} /> },
};

const ORIGENES: OrigenPrescripcion[] = [
    'OrganismoFiscalizador', 'OrganismoAdministrador', 'DepartamentoPrevencion', 'ComiteParitario',
];

type Filtro = 'todas' | EstadoPrescripcion;

const hoyISO = () => new Date().toISOString().slice(0, 10);
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CL') : '—');
const aISO = (fecha: string) => new Date(`${fecha}T12:00:00`).toISOString();

const FORM_VACIO = {
    origen: 'OrganismoFiscalizador' as OrigenPrescripcion,
    fechaPrescripcion: hoyISO(),
    descripcion: '',
    conPlazo: false,
    plazoImplementacion: '',
};

export default function Prescripciones() {
    const { user } = useAuth();
    const { selectedObraId, selectedObra } = useObraContext();
    const { toast } = useToast();
    const tenantId = (user as any)?.tenantId as string | undefined;

    const [lista, setLista] = useState<Prescripcion[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<Filtro>('todas');

    const [panelAbierto, setPanelAbierto] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [form, setForm] = useState(FORM_VACIO);
    const [archivoPrescripcion, setArchivoPrescripcion] = useState<File | null>(null);
    const archivoRef = useRef<HTMLInputElement>(null);

    const [implementando, setImplementando] = useState<Prescripcion | null>(null);
    const [fechaImpl, setFechaImpl] = useState(hoyISO());
    const [archivoEvidencia, setArchivoEvidencia] = useState<File | null>(null);
    const [subiendoEvidencia, setSubiendoEvidencia] = useState(false);
    const evidenciaRef = useRef<HTMLInputElement>(null);

    const cargar = useCallback(async () => {
        if (!tenantId) return;
        setCargando(true);
        setError(null);
        const res = await estructuraApi.listarPrescripciones(tenantId, selectedObraId);
        if (res.success && res.data) setLista(res.data.prescripciones);
        else setError(res.error || 'No se pudieron cargar las prescripciones.');
        setCargando(false);
    }, [tenantId, selectedObraId]);

    useEffect(() => { void cargar(); }, [cargar]);

    const conteos = useMemo(() => ({
        todas: lista.length,
        Vencida: lista.filter((p) => p.estado === 'Vencida').length,
        Pendiente: lista.filter((p) => p.estado === 'Pendiente').length,
        Implementada: lista.filter((p) => p.estado === 'Implementada').length,
    }), [lista]);

    const visibles = useMemo(
        () => (filtro === 'todas' ? lista : lista.filter((p) => p.estado === filtro)),
        [lista, filtro]
    );

    const subirEvidencia = useCallback(
        (file: File, titulo: string) => subirComoDocumento({
            file, tipo: 'ACTA_REGISTRO', titulo,
            tenantId: tenantId || '', obraId: selectedObraId, categoria: 'prescripciones',
        }),
        [tenantId, selectedObraId]
    );

    const registrar = useCallback(async () => {
        if (!tenantId) return;
        setGuardando(true);
        try {
            let documentoPrescripcionId: string | null = null;
            if (archivoPrescripcion) {
                documentoPrescripcionId = await subirEvidencia(
                    archivoPrescripcion, `Prescripción de medidas · ${fmt(aISO(form.fechaPrescripcion))}`
                );
            }
            const res = await estructuraApi.crearPrescripcion(tenantId, {
                obraId: selectedObraId || null,
                origen: form.origen,
                fechaPrescripcion: aISO(form.fechaPrescripcion),
                descripcion: form.descripcion.trim(),
                plazoImplementacion: form.conPlazo && form.plazoImplementacion ? aISO(form.plazoImplementacion) : null,
                documentoPrescripcionId,
                solicitanteId: (user as any)?.personaId,
            });
            if (!res.success) throw new Error(res.error || 'No se pudo registrar la prescripción.');
            toast.success('Prescripción registrada.');
            setPanelAbierto(false);
            setForm(FORM_VACIO);
            setArchivoPrescripcion(null);
            await cargar();
        } catch (e: any) {
            setError(e?.message || 'Error al registrar la prescripción.');
        } finally {
            setGuardando(false);
        }
    }, [tenantId, selectedObraId, form, archivoPrescripcion, subirEvidencia, user, toast, cargar]);

    /** Art. 70: sin evidencia no se puede dar por implementada. El backend valida lo mismo. */
    const marcarImplementada = useCallback(async () => {
        if (!tenantId || !implementando || !archivoEvidencia) return;
        setSubiendoEvidencia(true);
        try {
            const evidenciaId = await subirEvidencia(
                archivoEvidencia, `Evidencia de implementación · ${implementando.descripcion.slice(0, 60)}`
            );
            const res = await estructuraApi.actualizarPrescripcion(tenantId, implementando.prescripcionId, {
                fechaImplementacion: aISO(fechaImpl),
                evidenciaImplementacionDocumentoId: evidenciaId,
            });
            if (!res.success) throw new Error(res.error || 'No se pudo registrar la implementación.');
            toast.success('Implementación registrada.');
            setImplementando(null);
            setArchivoEvidencia(null);
            await cargar();
        } catch (e: any) {
            setError(e?.message || 'Error al registrar la implementación.');
        } finally {
            setSubiendoEvidencia(false);
        }
    }, [tenantId, implementando, archivoEvidencia, fechaImpl, subirEvidencia, toast, cargar]);

    const columnas: DataTableColumn<Prescripcion>[] = [
        {
            key: 'estado', header: 'Estado', width: '150px', sortable: true,
            sortValue: (p) => ({ Vencida: 0, Pendiente: 1, Implementada: 2 }[p.estado]),
            render: (p) => (
                <Badge variant={ESTADO_META[p.estado].variant}>
                    {ESTADO_META[p.estado].icono} {ESTADO_META[p.estado].label}
                </Badge>
            ),
        },
        {
            key: 'descripcion', header: 'Medida prescrita',
            render: (p) => (
                <div style={{ minWidth: 0 }}>
                    <div style={{ color: 'var(--text-primary)' }}>{p.descripcion}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                        {ORIGEN_PRESCRIPCION_LABEL[p.origen]}
                        {p.documentoPrescripcionId && (
                            <> · <FiPaperclip size={11} style={{ verticalAlign: '-1px' }} /> con documento</>
                        )}
                    </div>
                </div>
            ),
        },
        {
            key: 'fechaPrescripcion', header: 'Prescrita', width: '120px', sortable: true, hideOnMobile: true,
            sortValue: (p) => p.fechaPrescripcion,
            render: (p) => <span style={{ color: 'var(--text-secondary)' }}>{fmt(p.fechaPrescripcion)}</span>,
        },
        {
            key: 'plazo', header: 'Plazo', width: '130px', sortable: true, hideOnMobile: true,
            sortValue: (p) => p.plazoImplementacion || '9999',
            render: (p) => (p.plazoImplementacion
                ? (
                    <span style={{ color: p.estado === 'Vencida' ? 'var(--danger-400)' : 'var(--text-secondary)' }}>
                        {fmt(p.plazoImplementacion)}
                    </span>
                )
                : <span style={{ color: 'var(--text-secondary)' }}>Sin plazo</span>),
        },
        {
            key: 'accion', header: '', width: '160px', align: 'right',
            render: (p) => (p.estado === 'Implementada'
                ? (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        {fmt(p.fechaImplementacion)}
                    </span>
                )
                : (
                    <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setImplementando(p); setFechaImpl(hoyISO()); }}
                    >
                        Registrar implementación
                    </button>
                )),
        },
    ];

    const puedeRegistrar = form.descripcion.trim().length > 0 && !guardando;

    return (
        <div className="page">
            <PageHeader
                title="Prescripciones de medidas"
                description={selectedObra?.nombre
                    ? `Medidas ordenadas para ${selectedObra.nombre} y para la empresa`
                    : 'Medidas ordenadas por fiscalizadores, el Organismo Administrador, el Departamento de Prevención o el comité'}
                actions={
                    <button className="btn btn-primary" type="button" onClick={() => setPanelAbierto(true)}>
                        <FiPlus size={15} /> Registrar prescripción
                    </button>
                }
            />

            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

            {/* Las vencidas son lo primero que revisa un fiscalizador en una segunda
                visita: se avisan arriba en vez de esconderse en una fila de la tabla. */}
            {conteos.Vencida > 0 && (
                <div className="ds44-alert ds44-alert-danger" style={{ marginBottom: 'var(--space-4)' }}>
                    <span className="ds44-alert-icon"><FiAlertTriangle size={14} /></span>
                    <span>
                        {conteos.Vencida} medida{conteos.Vencida === 1 ? '' : 's'} con el plazo vencido sin implementar.
                        El Art. 70 obliga a implementarlas, no solo a recibirlas.
                    </span>
                </div>
            )}

            {lista.length > 0 && (
                <div className="ds44-filtros" style={{ marginBottom: 'var(--space-4)' }}>
                    <SegmentedControl
                        ariaLabel="Filtrar prescripciones por estado"
                        value={filtro}
                        onChange={(v) => setFiltro(v as Filtro)}
                        options={[
                            { value: 'todas', label: `Todas (${conteos.todas})` },
                            { value: 'Vencida', label: `Vencidas (${conteos.Vencida})` },
                            { value: 'Pendiente', label: `Pendientes (${conteos.Pendiente})` },
                            { value: 'Implementada', label: `Implementadas (${conteos.Implementada})` },
                        ]}
                    />
                </div>
            )}

            <DataTable
                columns={columnas}
                rows={visibles}
                rowKey={(p) => p.prescripcionId}
                loading={cargando}
                emptyState={
                    lista.length === 0 ? (
                        // Vacío no es incumplimiento: el ítem 58 obliga a implementar lo
                        // que exista, así que sin prescripciones está cumplido. El estado
                        // vacío lo explica en vez de dejar un hueco.
                        <EmptyState
                            icon={<FiCheck size={34} />}
                            title="Sin prescripciones registradas"
                            description="El Art. 70 obliga a implementar las medidas que ordenen los fiscalizadores, el Organismo Administrador, el Departamento de Prevención o el comité paritario. Mientras no haya ninguna, el ítem 58 del formulario está cumplido."
                            action={{
                                label: 'Registrar la primera',
                                onClick: () => setPanelAbierto(true),
                                icon: <FiPlus size={15} />,
                            }}
                        />
                    ) : (
                        <EmptyState
                            icon={<FiClock size={34} />}
                            title="Nada en este estado"
                            description="Cambia el filtro para ver el resto de las prescripciones."
                        />
                    )
                }
            />

            {/* ── Registrar prescripción ─────────────────────────────────── */}
            <Drawer
                isOpen={panelAbierto}
                onClose={() => setPanelAbierto(false)}
                title="Registrar prescripción"
                subtitle="Medida ordenada a la entidad empleadora (Art. 70)"
                width={520}
                footer={
                    <>
                        <button className="btn btn-secondary" type="button" onClick={() => setPanelAbierto(false)}>
                            Cancelar
                        </button>
                        <button className="btn btn-primary" type="button" disabled={!puedeRegistrar} onClick={registrar}>
                            {guardando ? 'Registrando…' : 'Registrar'}
                        </button>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    <div className="form-group">
                        <label className="form-label">Quién la ordenó</label>
                        <Select
                            ariaLabel="Origen de la prescripción"
                            value={form.origen}
                            onChange={(v) => setForm((f) => ({ ...f, origen: v as OrigenPrescripcion }))}
                            options={ORIGENES.map((o) => ({ value: o, label: ORIGEN_PRESCRIPCION_LABEL[o] }))}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="pr-desc">Medida prescrita</label>
                        <textarea
                            id="pr-desc"
                            className="form-input"
                            rows={3}
                            style={{ resize: 'vertical' }}
                            placeholder="Qué se ordenó implementar"
                            value={form.descripcion}
                            onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="pr-fecha">Fecha de la prescripción</label>
                        <input
                            id="pr-fecha" type="date" className="form-input" max={hoyISO()}
                            value={form.fechaPrescripcion}
                            onChange={(e) => setForm((f) => ({ ...f, fechaPrescripcion: e.target.value }))}
                        />
                    </div>

                    {/* El plazo es opcional porque no toda prescripción lo trae; sin él
                        la medida nunca vence, y decirlo evita un vencimiento inventado. */}
                    <div className="form-group">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={form.conPlazo}
                                onChange={(e) => setForm((f) => ({ ...f, conPlazo: e.target.checked }))}
                            />
                            <span className="form-label" style={{ margin: 0 }}>La prescripción indica un plazo</span>
                        </label>
                        {form.conPlazo ? (
                            <input
                                type="date" className="form-input" min={form.fechaPrescripcion}
                                style={{ marginTop: 'var(--space-2)' }}
                                value={form.plazoImplementacion}
                                onChange={(e) => setForm((f) => ({ ...f, plazoImplementacion: e.target.value }))}
                            />
                        ) : (
                            <span className="form-hint">Sin plazo la medida queda pendiente, pero no vence.</span>
                        )}
                    </div>

                    <div className="form-group">
                        <label className="form-label">Documento que la origina</label>
                        <input
                            ref={archivoRef} type="file" accept="application/pdf,image/*"
                            style={{ display: 'none' }}
                            onChange={(e) => setArchivoPrescripcion(e.target.files?.[0] || null)}
                        />
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => archivoRef.current?.click()}>
                                <FiUploadCloud size={14} /> Seleccionar archivo
                            </button>
                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {archivoPrescripcion?.name || 'Opcional'}
                            </span>
                        </div>
                        <span className="form-hint">
                            El informe de fiscalización, el acta o la prescripción de medidas.
                        </span>
                    </div>
                </div>
            </Drawer>

            {/* ── Registrar implementación ───────────────────────────────── */}
            <Drawer
                isOpen={Boolean(implementando)}
                onClose={() => { setImplementando(null); setArchivoEvidencia(null); }}
                title="Registrar implementación"
                subtitle={implementando?.descripcion}
                width={480}
                footer={
                    <>
                        <button
                            className="btn btn-secondary" type="button"
                            onClick={() => { setImplementando(null); setArchivoEvidencia(null); }}
                        >
                            Cancelar
                        </button>
                        <button
                            className="btn btn-primary" type="button"
                            disabled={!archivoEvidencia || subiendoEvidencia}
                            onClick={marcarImplementada}
                        >
                            {subiendoEvidencia ? 'Guardando…' : 'Marcar implementada'}
                        </button>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    {/* Una regla permanente no es una alarma: se explica como texto
                        y el botón queda deshabilitado hasta que haya archivo. */}
                    <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        El Art. 70 exige implementar la medida, no solo recibirla. Sin evidencia
                        adjunta no se puede dar por implementada.
                    </p>

                    <div className="form-group">
                        <label className="form-label" htmlFor="pr-fimpl">Fecha de implementación</label>
                        <input
                            id="pr-fimpl" type="date" className="form-input" max={hoyISO()}
                            min={implementando?.fechaPrescripcion?.slice(0, 10)}
                            value={fechaImpl}
                            onChange={(e) => setFechaImpl(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Evidencia</label>
                        <input
                            ref={evidenciaRef} type="file" accept="application/pdf,image/*"
                            style={{ display: 'none' }}
                            onChange={(e) => setArchivoEvidencia(e.target.files?.[0] || null)}
                        />
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => evidenciaRef.current?.click()}>
                                <FiUploadCloud size={14} /> Seleccionar archivo
                            </button>
                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {archivoEvidencia?.name || 'Ningún archivo seleccionado'}
                            </span>
                        </div>
                        <span className="form-hint">
                            El sistema guarda el respaldo; que demuestre la implementación es responsabilidad de quien lo sube.
                        </span>
                    </div>
                </div>
            </Drawer>
        </div>
    );
}
