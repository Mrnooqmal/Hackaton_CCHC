import { useCallback, useMemo, useRef, useState } from 'react';
import {
    FiAlertTriangle, FiCalendar, FiCheck, FiExternalLink, FiFileText, FiUploadCloud,
} from 'react-icons/fi';
import { Badge } from './ui';
import { type Document } from '../api/documents.api';
import { subirComoDocumento } from '../utils/subirDocumento';
import { itemFuf } from '../utils/fuf';
import {
    ESTADO_LABEL, ESTADO_VARIANTE, colorProgreso, PREGUNTA_CONDICION,
    type CompletitudAmbito, type RequisitoFuf,
} from '../utils/completitud';

/**
 * Requisitos del DS 44 de una obra, agrupados por fase del ciclo Deming.
 *
 * Es la MISMA evaluación que alimenta el repositorio, el panel de cumplimiento y
 * el export: acá solo cambia el eje por el que se agrupa, que sale del catálogo
 * único (`fase` de cada ítem). Antes esta pantalla tenía sus propias listas de
 * documentos por fase, con sus propias reglas de aplicabilidad, y podía decir
 * cosas distintas del mismo requisito.
 *
 * ACÁ NO SE CALCULA NADA. Si esta vista y el panel pudieran discrepar, estaría
 * mal implementada.
 */

export type FaseDeming = 'plan' | 'hacer' | 'verificar' | 'actuar';

const FASE_FUF: Record<FaseDeming, string> = {
    plan: 'PLAN', hacer: 'DO', verificar: 'CHECK', actuar: 'ACT',
};

/**
 * Requisitos de una fase, tomados de la evaluación del ámbito.
 *
 * Se exporta para que el stepper y esta lista muestren EL MISMO número: dos
 * formas de contar la misma fase en la misma pantalla es justo lo que este
 * módulo vino a eliminar.
 */
export function requisitosDeFase(completitud: CompletitudAmbito | null, fase: FaseDeming): RequisitoFuf[] {
    if (!completitud) return [];
    const objetivo = FASE_FUF[fase];
    return completitud.requisitos
        .filter((r) => r.item != null && itemFuf(r.item)?.fase === objetivo)
        .sort((a, b) => (a.item || 0) - (b.item || 0));
}

/** Avance de la fase con las reglas del motor: lo excluido no penaliza y
 *  `Parcial` cuenta medio. */
export function resumenDeFase(requisitos: RequisitoFuf[]) {
    const exigibles = requisitos.filter(
        (r) => r.estado !== 'NoAplica' && r.estado !== 'FueraDeAlcance');
    const puntaje = exigibles.reduce(
        (n, r) => n + (r.estado === 'Cumplido' ? 1 : r.estado === 'Parcial' ? 0.5 : 0), 0);
    return {
        exigibles: exigibles.length,
        cumplidos: exigibles.filter((r) => r.estado === 'Cumplido').length,
        excluidos: requisitos.length - exigibles.length,
        progreso: exigibles.length > 0 ? Math.round((puntaje / exigibles.length) * 100) : 0,
    };
}

export interface FufPorFaseProps {
    tenantId: string;
    obraId: string;
    fase: FaseDeming;
    /** Evaluación del ámbito, ya cargada por la página. NO se pide acá: el
     *  porcentaje del stepper y esta lista tienen que salir del mismo objeto o
     *  la misma fase mostraría dos números. */
    completitud: CompletitudAmbito | null;
    /** Documentos de la obra, para enlazar la evidencia de cada requisito. */
    documentos: Document[];
    /** Recarga la evaluación tras subir un documento o declarar una condición. */
    onRecargar: () => void | Promise<void>;
    /** Abre el documento en el visor. */
    onVerDocumento?: (doc: Document) => void;
    /** Agenda la actividad que acredita el requisito. */
    onAgendarActividad?: (criterio: { subtipo?: string; titulo?: string; tipos?: string[] }) => void;
    /** Navega al módulo que resuelve el requisito. */
    onIrAModulo?: (modulo: string) => void;
    /**
     * Responde la pregunta que decide si un requisito corresponde a esta obra.
     * Sin esto un requisito en «falta declarar» se quedaría ahí para siempre.
     */
    onDeclarar?: (campo: 'faenaCompartida' | 'tieneMaquinaria' | 'agentesFQB', valor: boolean) => Promise<void> | void;
}

export default function FufPorFase({
    tenantId, obraId, fase, completitud, documentos, onRecargar,
    onVerDocumento, onAgendarActividad, onIrAModulo, onDeclarar,
}: FufPorFaseProps) {
    const data = completitud;
    const [error, setError] = useState<string | null>(null);
    const [subiendo, setSubiendo] = useState<string | null>(null);
    const [declarando, setDeclarando] = useState<string | null>(null);
    const inputs = useRef<Record<string, HTMLInputElement | null>>({});

    const cargar = useCallback(async () => { await onRecargar(); }, [onRecargar]);

    const requisitos = useMemo(() => requisitosDeFase(data, fase), [data, fase]);

    const resumen = useMemo(() => resumenDeFase(requisitos), [requisitos]);

    const evidenciaDe = useCallback((r: RequisitoFuf): Document[] => {
        const tipos = new Set(r.tipos || []);
        if (tipos.size === 0) return [];
        return documentos.filter((d) => tipos.has(d.tipo) && (d.s3Key || d.archivoUrl));
    }, [documentos]);

    const subir = useCallback(async (r: RequisitoFuf, file: File) => {
        const tipo = (r.tipos || [])[0];
        if (!tipo) return;
        setSubiendo(r.id);
        setError(null);
        try {
            await subirComoDocumento({ file, tipo, titulo: r.titulo, tenantId, obraId, categoria: 'ds44' });
            await cargar();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error al cargar el documento.');
        } finally {
            setSubiendo(null);
        }
    }, [tenantId, obraId, cargar]);

    if (!data) {
        return <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Cargando los requisitos de la fase…</div>;
    }
    if (requisitos.length === 0) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {resumen.cumplidos} de {resumen.exigibles} requisitos exigibles de esta fase
                </span>
                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: colorProgreso(resumen.progreso) }}>
                    {resumen.progreso}%
                </span>
            </div>

            {error && (
                <div className="ds44-alert ds44-alert-danger" style={{ fontSize: '0.85rem' }}>
                    <span className="ds44-alert-icon"><FiAlertTriangle size={14} /></span>
                    <span>{error}</span>
                </div>
            )}

            {requisitos.map((r) => {
                const item = r.item != null ? itemFuf(r.item) : null;
                const evidencia = evidenciaDe(r);
                const noAplica = r.estado === 'NoAplica';
                const puedeSubir = (r.tipos || []).length > 0 && !noAplica;
                // Un requisito que admite las dos vías trae su criterio: se puede
                // agendar la actividad o cargar el certificado de una dictada fuera.
                const agendable = r.acreditacion && !noAplica && r.estado !== 'Cumplido';

                return (
                    <div key={r.id} className="ds44-doc-row" style={{ alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0 }}>
                            <div className="font-medium" style={{ fontSize: '0.88rem' }}>
                                {/* Los requisitos fuera del formulario se nombran por su
                                    artículo: un número de ítem inventado engañaría. */}
                                <span style={{ color: 'var(--text-secondary)' }}>
                                    {item?.fueraDelFormulario ? `${item.articulo} · ` : `FUF ${r.item} · `}
                                </span>
                                {r.titulo}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                {r.justificacion || r.detalle || '—'}
                            </div>

                            {evidencia.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                                    {evidencia.map((d) => (
                                        <button
                                            key={d.documentId}
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            style={{ fontSize: '0.75rem' }}
                                            onClick={() => onVerDocumento?.(d)}
                                        >
                                            <FiFileText size={12} /> {d.archivoNombre || d.titulo}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* La pregunta que decide si el requisito corresponde.
                                Se hace en la fila, donde el usuario ya está mirando
                                el requisito, y no en un formulario aparte de la obra
                                que nadie abre. */}
                            {r.aplicabilidad === 'verificar' && r.condicion && onDeclarar && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                        {PREGUNTA_CONDICION[r.condicion]?.pregunta}
                                    </span>
                                    {([['Sí', true], ['No', false]] as const).map(([etiqueta, valor]) => (
                                        <button
                                            key={etiqueta}
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            style={{ fontSize: '0.74rem' }}
                                            disabled={declarando !== null}
                                            onClick={async () => {
                                                const campo = PREGUNTA_CONDICION[r.condicion as string]?.campo;
                                                if (!campo) return;
                                                setDeclarando(r.id);
                                                try {
                                                    await onDeclarar(campo, valor);
                                                    await cargar();
                                                } finally {
                                                    setDeclarando(null);
                                                }
                                            }}
                                        >
                                            {declarando === r.id ? '…' : etiqueta}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Actividades ya agendadas que acreditan o van a acreditar. */}
                            {r.acreditacion?.actividades?.map((a) => (
                                <div key={a.actividadId || a.titulo} style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    <FiCalendar size={11} style={{ verticalAlign: '-1px' }} />{' '}
                                    {a.titulo || 'Actividad'}
                                    {a.fecha ? ` · ${new Date(a.fecha).toLocaleDateString('es-CL')}` : ''}
                                    {a.asistentes > 0 ? ` · ${a.firmados}/${a.asistentes} firmas` : ''}
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <Badge variant={ESTADO_VARIANTE[r.estado]}>
                                {r.estado === 'Cumplido' && <FiCheck size={12} />} {ESTADO_LABEL[r.estado]}
                            </Badge>

                            {/* Las dos vías conviven: agendar la capacitación acá, o
                                cargar el certificado de una dictada por el Organismo
                                Administrador. Ninguna reemplaza a la otra. */}
                            {agendable && onAgendarActividad && (
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => onAgendarActividad(r.acreditacion!.criterio)}
                                >
                                    <FiCalendar size={13} /> Agendar
                                </button>
                            )}

                            {puedeSubir && (
                                <>
                                    <input
                                        ref={(el) => { inputs.current[r.id] = el; }}
                                        type="file"
                                        accept="application/pdf,image/*"
                                        style={{ display: 'none' }}
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            e.target.value = '';
                                            if (f) void subir(r, f);
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        disabled={subiendo !== null}
                                        onClick={() => inputs.current[r.id]?.click()}
                                    >
                                        <FiUploadCloud size={13} />
                                        {subiendo === r.id ? 'Subiendo…' : evidencia.length > 0 ? 'Reemplazar' : 'Cargar'}
                                    </button>
                                </>
                            )}

                            {!puedeSubir && r.modulo && !r.acreditacion && onIrAModulo && (
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => onIrAModulo(r.modulo as string)}
                                >
                                    <FiExternalLink size={13} /> Ir al módulo
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
