import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiAlertTriangle, FiCheckCircle, FiRefreshCw } from 'react-icons/fi';
import { AlertBanner, Badge, Select } from '../ui';
import type { BadgeVariant } from '../ui/Badge';
import { personasApi } from '../../api/personas.api';
import { auditoriaApi, type EventoAuditoria } from '../../api/gobernanza.api';

/**
 * Registro de auditoría de la empresa (Backend/lib/gobernanza/auditoria.js).
 *
 * Solo lectura: no hay forma de editar ni borrar un registro, ni aquí ni en la
 * API. Cada registro muestra si su sello de integridad sigue calzando; uno
 * "alterado" significa que alguien lo cambió fuera del sistema y es, por sí
 * mismo, un incidente a investigar. Cada vez que se abre esta pantalla queda
 * registrado quién la consultó.
 */

const TZ = 'America/Santiago';
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-CL', { timeZone: TZ, dateStyle: 'short', timeStyle: 'medium' });

const CATEGORIAS = [
    { value: '', label: 'Todas' },
    { value: 'alerta', label: 'Alertas' },
    { value: 'seguridad', label: 'Ingresos y verificaciones' },
    { value: 'derechos', label: 'Derechos de los titulares' },
    { value: 'consentimiento', label: 'Consentimientos' },
    { value: 'datos', label: 'Modificaciones de datos' },
    { value: 'administracion', label: 'Roles y permisos' },
    { value: 'salud', label: 'Accesos a datos de salud' },
    { value: 'contencion', label: 'Contención de incidentes' },
    { value: 'auditoria', label: 'Consultas a esta auditoría' },
];

const OPERACION_LABEL: Record<string, string> = {
    'auth.ingreso': 'Inicio de sesión',
    'auth.ingreso_fallido': 'Ingreso fallido',
    'identidad.verificada': 'Identidad confirmada con contraseña',
    'identidad.verificacion_fallida': 'Contraseña incorrecta al confirmar identidad',
    'consentimiento.otorgado': 'Consentimiento otorgado',
    'consentimiento.revocado': 'Consentimiento revocado',
    'derechos.solicitud': 'Solicitud de un titular',
    'derechos.verificacion': 'Verificación de identidad de una solicitud',
    'derechos.prorroga': 'Prórroga de una solicitud',
    'derechos.respuesta': 'Respuesta a una solicitud',
    'derechos.exportacion': 'Exportación de datos de un titular',
    'derechos.exportacion_rechazada': 'Exportación rechazada por límite diario',
    'derechos.rectificacion_aplicada': 'Rectificación aplicada',
    'derechos.supresion_ejecutada': 'Supresión ejecutada',
    'datos.modificacion': 'Modificación de una ficha',
    'admin.cambio_rol': 'Cambio de rol',
    'admin.roles_empresa': 'Cambio de roles y permisos',
    'contencion.revocar_sesiones': 'Sesiones revocadas (contención)',
    'contencion.suspender_cuenta': 'Cuenta suspendida (contención)',
    'contencion.reactivar_cuenta': 'Cuenta reactivada',
    'contencion.preservar_evidencia': 'Evidencia preservada',
    'auditoria.consulta': 'Consulta de la auditoría',
    'alerta.fuerza_bruta_cuenta': 'ALERTA: intentos reiterados de ingreso a una cuenta',
    'alerta.verificacion_reiterada': 'ALERTA: contraseña reiterada al confirmar identidad (sesiones cerradas)',
    'alerta.exportacion_reiterada': 'ALERTA: exportaciones sobre el límite',
    'alerta.acceso_masivo_salud': 'ALERTA: acceso a datos de salud de muchas personas',
    'alerta.escalamiento_privilegios': 'ALERTA: cambio de privilegios de administración',
};

const RESULTADO: Record<string, { label: string; variante: BadgeVariant }> = {
    exito: { label: 'Éxito', variante: 'success' },
    denegado: { label: 'Denegado', variante: 'warning' },
    fallido: { label: 'Fallido', variante: 'danger' },
};
const INTEGRIDAD: Record<EventoAuditoria['integridad'], { label: string; variante: BadgeVariant }> = {
    integro: { label: 'Íntegro', variante: 'success' },
    alterado: { label: 'ALTERADO', variante: 'danger' },
    sin_sello: { label: 'Sin sello (anterior)', variante: 'neutral' },
};

export default function AuditoriaPanel() {
    const [eventos, setEventos] = useState<EventoAuditoria[]>([]);
    const [resumen, setResumen] = useState<Record<string, number>>({});
    const [nombres, setNombres] = useState<Map<string, string>>(new Map());
    const [categoria, setCategoria] = useState('');
    const [desde, setDesde] = useState('');
    const [hasta, setHasta] = useState('');
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const tenantId = localStorage.getItem('tenant_id') || '';

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        const r = await auditoriaApi.listar({
            categoria: categoria || undefined,
            desde: desde ? new Date(`${desde}T00:00:00`).toISOString() : undefined,
            hasta: hasta ? new Date(`${hasta}T23:59:59`).toISOString() : undefined,
        }).catch(() => null);
        if (r?.success && r.data) { setEventos(r.data.eventos); setResumen(r.data.integridad); } else setError(r?.error || 'No se pudo cargar la auditoría.');
        setCargando(false);
    }, [categoria, desde, hasta]);
    useEffect(() => { cargar(); }, [cargar]);

    useEffect(() => {
        personasApi.list(tenantId, { incluirBloqueadas: true }).then((p) => {
            if (p.success && p.data) setNombres(new Map(p.data.personas.map((x) => [x.personaId, [x.nombre, x.apellido].filter(Boolean).join(' ')])));
        }).catch(() => {});
    }, [tenantId]);

    const actor = (e: EventoAuditoria) => {
        if (e.actorId.startsWith('rut:')) return 'Cuenta (sin sesión)';
        if (e.actorId.startsWith('operador:')) return `Plataforma: ${e.actorId.slice(9)}`;
        return nombres.get(e.actorId) || 'Persona de la empresa';
    };
    const alterados = resumen.alterado || 0;
    const alertas = useMemo(() => eventos.filter((e) => e.categoria === 'alerta').length, [eventos]);

    return (
        <div className="me-panel">
            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
            <section className="me-section">
                <div className="me-section-head">
                    <h3 className="me-section-title">Auditoría</h3>
                    <p className="me-section-hint">
                        Quién hizo qué sobre los datos personales: ingresos, consentimientos, solicitudes de los titulares,
                        exportaciones, cambios de fichas y de roles, accesos a salud y alertas. Los registros no se pueden
                        editar ni borrar, no guardan contraseñas ni valores, y se conservan entre uno y cinco años según su tipo.
                        Esta consulta también queda registrada.
                    </p>
                </div>
                <div className="me-section-body au-filtros">
                    <Select id="au-cat" value={categoria} onChange={setCategoria} options={CATEGORIAS} placeholder="Categoría" />
                    <label className="au-fecha">Desde <input type="date" className="form-input" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
                    <label className="au-fecha">Hasta <input type="date" className="form-input" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
                    <button className="btn btn-secondary btn-sm" onClick={cargar}><FiRefreshCw size={13} /> Actualizar</button>
                </div>
                <div className="me-section-body au-resumen">
                    {alterados > 0
                        ? <AlertBanner variant="error" message={`${alterados} registro(s) no calzan con su sello: fueron alterados fuera del sistema. Trátalo como un incidente.`} />
                        : <span className="au-ok"><FiCheckCircle aria-hidden /> Todos los registros sellados están íntegros.</span>}
                    {alertas > 0 && <span className="au-alerta"><FiAlertTriangle aria-hidden /> {alertas} alerta(s) en esta vista.</span>}
                </div>
            </section>
            <section className="me-section">
                <div className="me-section-body">
                    {cargando ? <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><div className="spinner" /></div>
                        : eventos.length === 0 ? <p className="me-field-hint">No hay registros en esta vista.</p> : (
                            <div className="au-tabla-envoltura">
                                <table className="au-tabla">
                                    <thead><tr><th>Fecha</th><th>Operación</th><th>Quién</th><th>Titulares</th><th>Resultado</th><th>Origen</th><th>Integridad</th></tr></thead>
                                    <tbody>
                                        {eventos.map((e) => (
                                            <tr key={e.sk} className={e.categoria === 'alerta' ? 'au-fila-alerta' : ''}>
                                                <td>{fechaHora(e.en)}</td>
                                                <td>{e.operacion ? (OPERACION_LABEL[e.operacion] || e.operacion) : `Acceso a salud (${(e.tipos || []).join(', ')})`}</td>
                                                <td>{actor(e)}</td>
                                                <td>{(e.titulares || []).length || '-'}</td>
                                                <td>{e.categoria === 'alerta' ? <Badge variant="warning">Alerta</Badge>
                                                    : e.resultado ? <Badge variant={RESULTADO[e.resultado].variante}>{RESULTADO[e.resultado].label}</Badge> : <Badge variant="success">Éxito</Badge>}</td>
                                                <td>{e.origen?.ip || e.ip || e.origen?.canal || '-'}</td>
                                                <td><Badge variant={INTEGRIDAD[e.integridad].variante}>{INTEGRIDAD[e.integridad].label}</Badge></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                </div>
            </section>
            <style>{`
                .au-filtros { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
                .au-filtros > div:first-child { min-width: 220px; }
                .au-fecha { display: flex; gap: 6px; align-items: center; font-size: 0.85rem; color: var(--text-secondary); }
                .au-resumen { display: flex; flex-direction: column; gap: 6px; }
                .au-ok { display: flex; gap: 6px; align-items: center; font-size: 0.86rem; color: var(--success-700, #15803d); }
                .au-alerta { display: flex; gap: 6px; align-items: center; font-size: 0.86rem; color: var(--warning-800, #92400e); }
                .au-tabla-envoltura { overflow-x: auto; }
                .au-tabla { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
                .au-tabla th, .au-tabla td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--surface-border); vertical-align: top; }
                .au-tabla th { font-size: 0.75rem; color: var(--text-secondary); font-weight: 600; white-space: nowrap; }
                .au-tabla td:first-child { white-space: nowrap; }
                .au-fila-alerta { background: rgba(245, 158, 11, 0.07); }
            `}</style>
        </div>
    );
}
