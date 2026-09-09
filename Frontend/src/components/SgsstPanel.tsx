import { useCallback, useEffect, useRef, useState } from 'react';
import { FiAlertTriangle, FiArrowRight, FiCheck, FiUploadCloud } from 'react-icons/fi';
import { Badge } from './ui';
import { estructuraApi } from '../api/estructura.api';
import { documentsApi } from '../api/documents.api';
import { uploadsApi } from '../api/uploads.api';
import {
    ESTADO_REQUISITO, ESTADO_LABEL, ESTADO_VARIANTE, colorProgreso,
    type ComponenteSgsst,
} from '../utils/completitud';

/**
 * Sistema de Gestión de SST — DS 44 Art. 22 (ítem 1 del FUF).
 *
 * El artículo enumera cinco componentes mínimos, de los cuales tres tienen
 * documento propio y dos ya se acreditan en otros módulos. Este panel los
 * muestra juntos porque el fiscalizador pregunta por el sistema, no por sus
 * piezas sueltas; pero NO guarda copias de lo que vive en otra parte: b) y c)
 * se enlazan. Dos copias del mismo documento son dos verdades sobre él.
 *
 * Las letras a) a e) no son decoración: son las del artículo, y son la forma en
 * que el fiscalizador nombra lo que pide.
 */

export interface SgsstPanelProps {
    tenantId: string;
    /** Adónde lleva cada componente que se acredita en otro módulo. */
    onIrA?: (enlace: string) => void;
}

const TITULO_SUBIDA: Record<string, string> = {
    POLITICA_SSO: 'Política de Seguridad y Salud en el Trabajo',
    AUDITORIA_SGSST: 'Evaluación del desempeño del SGSST',
    ACCIONES_MEJORA_SGSST: 'Acciones de mejora continua del SGSST',
};

export default function SgsstPanel({ tenantId, onIrA }: SgsstPanelProps) {
    const [componentes, setComponentes] = useState<ComponenteSgsst[] | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [subiendo, setSubiendo] = useState<string | null>(null);
    const inputs = useRef<Record<string, HTMLInputElement | null>>({});

    const cargar = useCallback(async () => {
        if (!tenantId) return;
        setCargando(true);
        setError(null);
        const res = await estructuraApi.completitud(tenantId, 'empresa', null);
        if (res.success && res.data) setComponentes(res.data.sgsst || []);
        else setError(res.error || 'No se pudo leer el estado del sistema de gestión.');
        setCargando(false);
    }, [tenantId]);

    useEffect(() => { void cargar(); }, [cargar]);

    const subir = useCallback(async (comp: ComponenteSgsst, file: File) => {
        if (!comp.tipo) return;
        setSubiendo(comp.clave);
        setError(null);
        try {
            const up = await uploadsApi.uploadFile(file, 'sgsst', tenantId, tenantId);
            if (!up.success || !up.data) throw new Error(up.error || 'No se pudo subir el archivo.');
            const doc = await documentsApi.create({
                tipo: comp.tipo,
                titulo: TITULO_SUBIDA[comp.tipo] || comp.literal,
                empresaId: tenantId,
                archivoUrl: up.data.url,
                archivoNombre: file.name,
            });
            if (!doc.success) throw new Error(doc.error || 'No se pudo registrar el documento.');
            await cargar();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error al cargar el documento.');
        } finally {
            setSubiendo(null);
        }
    }, [tenantId, cargar]);

    if (cargando) {
        return <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Leyendo el sistema de gestión…</div>;
    }
    if (error && !componentes) {
        return (
            <div className="ds44-alert ds44-alert-danger" style={{ fontSize: '0.85rem' }}>
                <span className="ds44-alert-icon"><FiAlertTriangle size={14} /></span>
                <span>{error}</span>
            </div>
        );
    }
    if (!componentes || componentes.length === 0) return null;

    const cubiertos = componentes.filter((c) => c.estado === ESTADO_REQUISITO.CUMPLIDO).length;
    const progreso = Math.round((cubiertos / componentes.length) * 100);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div className="card" style={{ padding: 'var(--space-4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Contenido mínimo del Art. 22
                    </span>
                    <span style={{ fontWeight: 700, fontSize: '1rem', color: colorProgreso(progreso), flexShrink: 0 }}>
                        {cubiertos} de {componentes.length}
                    </span>
                </div>
                <div className="ds44-progress-track">
                    <div className="ds44-progress-fill" style={{ width: `${progreso}%`, background: colorProgreso(progreso) }} />
                </div>
                {/* Anti contradicción 7: mientras falte un componente el ítem 1 no
                    está cumplido, y el encabezado tiene que decirlo antes de que el
                    usuario lo descubra en la fiscalización. */}
                <div style={{ fontSize: '0.75rem', marginTop: 5, color: 'var(--text-secondary)' }}>
                    {cubiertos === componentes.length
                        ? 'Los cinco componentes están cubiertos. El ítem 1 del formulario queda cumplido.'
                        : 'El ítem 1 no se da por cumplido mientras falte alguno de los cinco componentes.'}
                </div>
            </div>

            {error && (
                <div className="ds44-alert ds44-alert-danger" style={{ fontSize: '0.85rem' }}>
                    <span className="ds44-alert-icon"><FiAlertTriangle size={14} /></span>
                    <span>{error}</span>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {componentes.map((c) => {
                    const cumplido = c.estado === ESTADO_REQUISITO.CUMPLIDO;
                    return (
                        <div key={c.clave} className="ds44-doc-row" style={{ alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                            {/* La letra del literal es la referencia normativa, no un
                                adorno: es como el fiscalizador nombra el componente. */}
                            <span
                                aria-hidden="true"
                                style={{
                                    flexShrink: 0, width: 26, height: 26, borderRadius: 'var(--radius-sm)',
                                    display: 'grid', placeItems: 'center', marginTop: 1,
                                    fontFamily: 'var(--font-display)', fontSize: '0.85rem', fontWeight: 600,
                                    background: cumplido ? 'rgba(16,185,129,0.12)' : 'var(--surface-hover)',
                                    color: cumplido ? '#10b981' : 'var(--text-secondary)',
                                }}
                            >
                                {cumplido ? <FiCheck size={14} /> : c.clave}
                            </span>

                            <div style={{ minWidth: 0, flex: 1 }}>
                                <div className="font-medium" style={{ fontSize: '0.88rem' }}>
                                    {/* El backend ya trae la letra al inicio del literal. */}
                                    {c.literal}
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                    {c.detalle}
                                    {!c.propio && ' Se acredita en su propio módulo.'}
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <Badge variant={ESTADO_VARIANTE[c.estado]}>{ESTADO_LABEL[c.estado]}</Badge>

                                {c.propio ? (
                                    <>
                                        <input
                                            ref={(el) => { inputs.current[c.clave] = el; }}
                                            type="file"
                                            accept="application/pdf,image/*"
                                            style={{ display: 'none' }}
                                            onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                e.target.value = '';
                                                if (f) void subir(c, f);
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            disabled={subiendo !== null}
                                            onClick={() => inputs.current[c.clave]?.click()}
                                        >
                                            <FiUploadCloud size={13} />
                                            {subiendo === c.clave ? 'Subiendo…' : cumplido ? 'Reemplazar' : 'Cargar'}
                                        </button>
                                    </>
                                ) : c.enlace && onIrA ? (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => onIrA(c.enlace as string)}
                                    >
                                        Ver <FiArrowRight size={13} />
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
