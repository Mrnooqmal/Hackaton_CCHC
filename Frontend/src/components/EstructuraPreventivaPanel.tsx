import { useCallback, useEffect, useState } from 'react';
import { FiAlertTriangle, FiCheckCircle, FiClock, FiUploadCloud, FiUsers } from 'react-icons/fi';
import { Badge } from './ui';
import { estructuraApi, type ResumenEstructura } from '../api/estructura.api';
import { documentsApi, type Document } from '../api/documents.api';
import { uploadsApi } from '../api/uploads.api';
import { useAuth } from '../context/AuthContext';
import {
    AMBITO, CONTENIDO_REGISTROS_INDICADORES, ESTADO_ORGANO, TIPO_ORGANO,
    TIPO_ORGANO_LABEL, TIPO_ORGANO_LABEL_CORTO, estadoDocumentoPeriodico, periodoAnual,
    resumenObligacionesTexto, type Ambito, type TipoOrgano,
} from '../utils/estructuraPreventiva';

/**
 * Paso "Estructura preventiva" de empresa y obra (secciones 5.1 y 5.2 del encargo).
 *
 * Muestra la dotación del ámbito, qué corresponde constituir y en qué estado está
 * cada figura. NO bloquea nada: un umbral define cuándo un órgano es obligatorio,
 * nunca cuándo está permitido, así que bajo el umbral se ofrece constituirlo
 * igualmente, rotulado como voluntario y sin advertencias disuasivas.
 *
 * El cálculo lo hace el backend (`/estructura/resumen`) sobre la dotación real de
 * personas asignadas. Este componente solo lo presenta.
 */

const ORDEN_EMPRESA: TipoOrgano[] = [
    TIPO_ORGANO.COMITE_PARITARIO,
    TIPO_ORGANO.DELEGADO_SST,
    TIPO_ORGANO.DEPARTAMENTO_PREVENCION,
    TIPO_ORGANO.ENCARGADO_GESTION_RIESGO,
];
const ORDEN_OBRA: TipoOrgano[] = [TIPO_ORGANO.COMITE_PARITARIO, TIPO_ORGANO.DELEGADO_SST];

export interface EstructuraPreventivaPanelProps {
    tenantId: string;
    ambito: Ambito;
    obraId?: string | null;
    /** Abre el asistente de constitución para esa figura. Si no se entrega, el
     *  botón NO se renderiza: una acción que no lleva a ninguna parte es peor que
     *  su ausencia, porque el usuario cree que ya intentó constituirlo. */
    onConstituir?: (tipo: TipoOrgano, esVoluntario: boolean) => void;
    /** Abre el detalle de un órgano ya constituido. Mismo criterio que el anterior. */
    onVerOrgano?: (organoId: string) => void;
    /** Permite ocultar las acciones cuando el panel se usa solo como resumen. */
    soloLectura?: boolean;
}

export default function EstructuraPreventivaPanel({
    tenantId, ambito, obraId = null, onConstituir, onVerOrgano, soloLectura = false,
}: EstructuraPreventivaPanelProps) {
    const { user } = useAuth();
    const [resumen, setResumen] = useState<ResumenEstructura | null>(null);
    const [regDocs, setRegDocs] = useState<Document[]>([]);
    const [subiendoReg, setSubiendoReg] = useState(false);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const cargar = useCallback(async () => {
        if (!tenantId) return;
        setCargando(true);
        setError(null);
        const res = await estructuraApi.resumen(tenantId, ambito, obraId);
        if (res.success && res.data) setResumen(res.data);
        else setError(res.error || 'No se pudo cargar la estructura preventiva.');

        // Los registros e indicadores (ítems 46 y 47) son documentos del tenant con
        // período, no una entidad aparte: se leen del repositorio por tipo.
        if (ambito === AMBITO.EMPRESA) {
            const docs = await documentsApi.list({ tipo: 'REGISTROS_INDICADORES_SST' } as any).catch(() => null);
            const lista = (docs as any)?.data?.documents || [];
            setRegDocs(Array.isArray(lista) ? lista : []);
        }
        setCargando(false);
    }, [tenantId, ambito, obraId]);

    /** Carga el documento del período vigente. Sin firma: es evidencia estadística. */
    const subirRegistros = useCallback(async (file: File, periodo: string) => {
        if (!tenantId) return;
        setSubiendoReg(true);
        try {
            const up = await uploadsApi.uploadFile(file, 'registros-indicadores', tenantId, tenantId);
            if (!up.success || !up.data) throw new Error(up.error || 'No se pudo subir el archivo.');
            const res = await documentsApi.create({
                tipo: 'REGISTROS_INDICADORES_SST',
                titulo: `Registros e indicadores de SST ${periodo}`,
                periodo,
                archivoUrl: (up.data as any).url || (up.data as any).fileKey,
                archivoNombre: file.name,
                createdBy: (user as any)?.personaId,
            } as any);
            if (!res.success) throw new Error(res.error || 'No se pudo registrar el documento.');
            await cargar();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error al cargar el documento.');
        } finally {
            setSubiendoReg(false);
        }
    }, [tenantId, user, cargar]);

    useEffect(() => { void cargar(); }, [cargar]);

    if (cargando) {
        return <div className="text-muted" style={{ fontSize: '0.85rem' }}>Cargando estructura preventiva…</div>;
    }
    if (error) {
        return (
            <div className="ds44-alert ds44-alert-danger" style={{ fontSize: '0.85rem' }}>
                <span className="ds44-alert-icon"><FiAlertTriangle size={14} /></span>
                <span>{error}</span>
            </div>
        );
    }
    if (!resumen) return null;

    const figuras = ambito === AMBITO.EMPRESA ? ORDEN_EMPRESA : ORDEN_OBRA;
    const { dotacion, obligaciones, organos } = resumen;

    const organoDe = (tipo: TipoOrgano) =>
        organos.find((o) => o.tipo === tipo && o.estado === ESTADO_ORGANO.VIGENTE)
        || organos.find((o) => o.tipo === tipo && o.estado === ESTADO_ORGANO.VENCIDO)
        || null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

            {/* Dotación y qué corresponde, en lenguaje llano (§5.1.2). */}
            <div className="card" style={{ padding: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                    <FiUsers size={16} />
                    <span className="font-medium">
                        {dotacion.dotacion} {dotacion.dotacion === 1 ? 'persona trabajadora' : 'personas trabajadoras'}
                    </span>
                    <Badge variant={dotacion.origen === 'declarada' ? 'warning' : 'info'}>
                        {dotacion.origen === 'declarada' ? 'Dotación declarada' : 'Calculada del sistema'}
                    </Badge>
                </div>

                {/* Si hay override, se muestra la calculada al lado: un fiscalizador
                    pregunta por la dotación y la respuesta necesita procedencia. */}
                {dotacion.origen === 'declarada' && (
                    <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 'var(--space-2)' }}>
                        El sistema cuenta {dotacion.calculada} persona(s) asignada(s).
                        {dotacion.observacion ? ` Observación: ${dotacion.observacion}` : ''}
                    </div>
                )}

                <div style={{ fontSize: '0.88rem', lineHeight: 1.55 }}>
                    {resumenObligacionesTexto(obligaciones)}
                </div>

                {ambito === AMBITO.OBRA && (
                    <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: 'var(--space-2)' }}>
                        El conteo es de esta faena. Un comité paritario constituido en la empresa
                        no reemplaza al que corresponde a este lugar de trabajo (Art. 23).
                    </div>
                )}
            </div>

            {/* Estado por figura. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {figuras.map((tipo) => {
                    const ob = obligaciones[tipo];
                    if (!ob?.aplica) return null;
                    const organo = organoDe(tipo);
                    const vigente = organo?.estado === ESTADO_ORGANO.VIGENTE;
                    const vencido = organo?.estado === ESTADO_ORGANO.VENCIDO;

                    const badge = vigente
                        ? { variant: 'success' as const, texto: organo?.origen === 'Voluntario' ? 'Vigente · voluntario' : 'Vigente' }
                        : vencido
                            ? { variant: 'danger' as const, texto: 'Mandato vencido' }
                            : ob.obligatorio
                                ? { variant: 'danger' as const, texto: 'Obligatorio · pendiente' }
                                : { variant: 'info' as const, texto: 'No obligatorio' };

                    return (
                        <div key={tipo} className="ds44-doc-row">
                            <div style={{ minWidth: 0 }}>
                                <div className="font-medium" style={{ fontSize: '0.9rem' }}>
                                    {TIPO_ORGANO_LABEL[tipo]}
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                                    {ob.motivo}
                                    {vigente && organo?.fechaTerminoMandato && (
                                        <> · Mandato hasta {new Date(organo.fechaTerminoMandato).toLocaleDateString('es-CL')}</>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                                <Badge variant={badge.variant}>
                                    {vigente ? <FiCheckCircle size={12} /> : vencido ? <FiClock size={12} /> : null}
                                    {badge.texto}
                                </Badge>
                                {!soloLectura && organo && onVerOrgano && (
                                    <button className="btn btn-secondary btn-sm" type="button"
                                        onClick={() => onVerOrgano?.(organo.organoId)}>
                                        Ver
                                    </button>
                                )}
                                {!soloLectura && !vigente && onConstituir && (
                                    <button
                                        className={ob.obligatorio ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                                        type="button"
                                        onClick={() => onConstituir?.(tipo, !ob.obligatorio)}
                                    >
                                        {/* Bajo el umbral la acción existe igual y se rotula sin
                                            disuadir: constituir siempre está permitido. */}
                                        {vencido
                                            ? 'Renovar'
                                            : ob.obligatorio
                                                ? `Constituir ${TIPO_ORGANO_LABEL_CORTO[tipo]}`
                                                : 'Constituir de todas formas'}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Registros e indicadores de SST (ítems 46 y 47 del FUF).
                Son EXCLUYENTES: el sistema exige uno u otro según la obligación
                calculada, nunca ambos. El contenido no se valida — se lista como
                ayuda para que quien lo prepara sepa qué debe incluir. */}
            {resumen.registrosIndicadores && (() => {
                const perfil = resumen.registrosIndicadores.perfil;
                const periodo = periodoAnual();
                const { estado, documento } = estadoDocumentoPeriodico(regDocs, periodo);
                return (
                    <div className="card" style={{ padding: 'var(--space-4)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 0 }}>
                                <div className="font-medium" style={{ fontSize: '0.9rem' }}>
                                    Registros e indicadores de SST · {periodo}
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                                    Perfil {perfil === 'extendido' ? 'extendido' : 'mínimo'}
                                    {' '}({resumen.registrosIndicadores.articulo}) · ítem {resumen.registrosIndicadores.itemFuf} del FUF
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                                <Badge variant={estado === 'Cargado' ? 'success' : estado === 'Vencido' ? 'danger' : 'warning'}>
                                    {estado}
                                </Badge>
                                {!soloLectura && (
                                    <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                                        {subiendoReg ? 'Subiendo…' : <><FiUploadCloud size={13} /> {documento ? 'Reemplazar' : 'Cargar'}</>}
                                        <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                                            disabled={subiendoReg}
                                            onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f) void subirRegistros(f, periodo);
                                                e.target.value = '';
                                            }} />
                                    </label>
                                )}
                            </div>
                        </div>
                        <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: 'var(--space-2)' }}>
                            Debe contener:
                            <ul style={{ margin: '4px 0 0', paddingLeft: '1.1rem' }}>
                                {CONTENIDO_REGISTROS_INDICADORES[perfil].map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
