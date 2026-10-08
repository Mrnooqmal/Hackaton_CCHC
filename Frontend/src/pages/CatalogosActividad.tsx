import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiPlus, FiTrash2, FiCheck, FiCornerUpLeft, FiAlertTriangle } from 'react-icons/fi';
import { tenantsApi, type CatalogosActividad as Catalogos, type CatalogoItem } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/ui';

type Clave = keyof Catalogos;

const SECCIONES: { key: Clave; titulo: string; hint: string; singular: string }[] = [
    { key: 'temas', titulo: 'Temas tratados', hint: 'Temas estandarizados de la charla diaria.', singular: 'tema' },
    { key: 'recursos', titulo: 'Recursos y equipos', hint: 'Equipos y herramientas de la planificación diaria.', singular: 'recurso' },
    { key: 'riesgos', titulo: 'Riesgos comunes', hint: 'Riesgos identificables en el frente de trabajo.', singular: 'riesgo' },
    { key: 'medidas', titulo: 'Medidas de prevención', hint: 'Medidas aplicables a los riesgos.', singular: 'medida' },
];

// El código se deriva del label solo al CREAR un ítem; después es estable
// (las actividades ya creadas lo referencian).
const codigoDesdeLabel = (label: string) => label
    .trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const DESHACER_MS = 6000;

type Estado = 'inicial' | 'guardando' | 'guardado' | 'error';
interface Eliminado { key: Clave; idx: number; item: CatalogoItem }

export default function CatalogosActividad() {
    const { user } = useAuth();
    const tenantId = user?.tenantId || '';
    const { toast } = useToast();
    const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
    const [loading, setLoading] = useState(true);
    const [estado, setEstado] = useState<Estado>('inicial');
    const [nuevos, setNuevos] = useState<Record<string, string>>({});
    const [eliminado, setEliminado] = useState<Eliminado | null>(null);

    // Cada acción se guarda en el momento. Los guardados van en fila, en el
    // orden en que se hicieron: el PUT reemplaza el catálogo entero, así que dos
    // en paralelo podrían llegar al revés y dejar guardado el más viejo.
    const confirmado = useRef<Catalogos | null>(null);
    const cola = useRef<Promise<void>>(Promise.resolve());
    const envios = useRef(0);
    const timerDeshacer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!tenantId) return;
        tenantsApi.getCatalogosActividad(tenantId).then((res) => {
            if (res.success && res.data) {
                confirmado.current = res.data.catalogos;
                setCatalogos(res.data.catalogos);
            } else toast.error(res.error || 'No se pudieron cargar los catálogos');
        }).finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId]);

    // Salir con un guardado en curso lo perdería: el navegador pide confirmar.
    useEffect(() => {
        if (estado !== 'guardando') return;
        const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); };
        window.addEventListener('beforeunload', avisar);
        return () => window.removeEventListener('beforeunload', avisar);
    }, [estado]);

    useEffect(() => () => { if (timerDeshacer.current) clearTimeout(timerDeshacer.current); }, []);

    const aplicar = useCallback((siguiente: Catalogos) => {
        setCatalogos(siguiente);
        setEstado('guardando');
        const n = ++envios.current;
        cola.current = cola.current.then(async () => {
            try {
                const res = await tenantsApi.saveCatalogosActividad(tenantId, siguiente);
                if (!res.success || !res.data) throw new Error(res.error || 'No se pudo guardar el cambio');
                confirmado.current = res.data.catalogos;
                // Solo el último envío pinta la respuesta: si hay otro detrás, la
                // pantalla ya muestra algo más nuevo que esto.
                if (n === envios.current) {
                    setCatalogos(res.data.catalogos);
                    setEstado('guardado');
                }
            } catch (e) {
                // Se vuelve a lo último que el servidor aceptó y se descarta lo que
                // venía detrás, que se construyó sobre el cambio rechazado.
                envios.current++;
                setCatalogos(confirmado.current);
                setEstado('error');
                toast.error(e instanceof Error ? e.message : 'No se pudo guardar el cambio');
            }
        });
    }, [tenantId, toast]);

    const codigosUsados = useMemo(() => {
        const s = new Set<string>();
        if (catalogos) for (const sec of SECCIONES) for (const i of catalogos[sec.key]) s.add(`${sec.key}:${i.codigo}`);
        return s;
    }, [catalogos]);

    const agregar = (key: Clave) => {
        const label = (nuevos[key] || '').trim();
        if (!label || !catalogos) return;
        const codigo = codigoDesdeLabel(label);
        if (!codigo) return;
        if (codigosUsados.has(`${key}:${codigo}`)) { toast.error('Ya existe un ítem equivalente en esta lista'); return; }
        aplicar({ ...catalogos, [key]: [...catalogos[key], { codigo, label }] });
        setNuevos({ ...nuevos, [key]: '' });
    };

    const renombrar = (key: Clave, codigo: string, label: string) => {
        if (!catalogos) return;
        aplicar({ ...catalogos, [key]: catalogos[key].map((it) => (it.codigo === codigo ? { ...it, label } : it)) });
    };

    const eliminar = (key: Clave, idx: number) => {
        if (!catalogos) return;
        const item = catalogos[key][idx];
        aplicar({ ...catalogos, [key]: catalogos[key].filter((_, i) => i !== idx) });
        setEliminado({ key, idx, item });
        if (timerDeshacer.current) clearTimeout(timerDeshacer.current);
        timerDeshacer.current = setTimeout(() => setEliminado(null), DESHACER_MS);
    };

    const deshacer = () => {
        if (!eliminado || !catalogos) return;
        const { key, idx, item } = eliminado;
        const lista = [...catalogos[key]];
        if (!lista.some((it) => it.codigo === item.codigo)) lista.splice(Math.min(idx, lista.length), 0, item);
        aplicar({ ...catalogos, [key]: lista });
        setEliminado(null);
        if (timerDeshacer.current) clearTimeout(timerDeshacer.current);
    };

    return (
        <div className="page-content">
            <PageHeader
                banner
                title="Catálogos de actividades"
                description="Listas desplegables de la planificación diaria: temas tratados, recursos, riesgos y medidas de prevención. Aplican a todas las obras de la empresa."
                actions={<EstadoGuardado estado={estado} />}
            />

            <p className="cat-nota">
                Cada cambio se guarda al hacerlo. Renombrar un ítem no afecta a las actividades ya registradas.
            </p>

            {loading ? <CatalogosSkeleton /> : catalogos && (
                <div className="cat-grid">
                    {SECCIONES.map(({ key, titulo, hint, singular }) => {
                        const lista = catalogos[key];
                        const hueco = eliminado?.key === key ? Math.min(eliminado.idx, lista.length) : -1;
                        const filas = lista.map((item, idx) => (
                            <ItemFila
                                key={item.codigo}
                                item={item}
                                onRenombrar={(label) => renombrar(key, item.codigo, label)}
                                onEliminar={() => eliminar(key, idx)}
                            />
                        ));
                        if (hueco >= 0 && eliminado) {
                            filas.splice(hueco, 0, (
                                <div key={`eliminado-${eliminado.item.codigo}`} className="cat-fila cat-fila--eliminado" role="status">
                                    <span className="cat-eliminado-texto">«{eliminado.item.label}» eliminado</span>
                                    <button type="button" className="cat-deshacer" onClick={deshacer}>
                                        <FiCornerUpLeft size={14} /> Deshacer
                                    </button>
                                </div>
                            ));
                        }
                        return (
                            <section key={key} className="cat-seccion" aria-labelledby={`cat-${key}`}>
                                <div className="cat-seccion-head">
                                    <h2 id={`cat-${key}`} className="cat-seccion-titulo">{titulo}</h2>
                                    <span className="cat-count">{lista.length}</span>
                                    <p className="cat-seccion-hint">{hint}</p>
                                </div>
                                <div className="cat-lista">
                                    {filas}
                                    <label className="cat-agregar">
                                        <FiPlus size={15} aria-hidden="true" />
                                        <input
                                            placeholder={`Agregar ${singular}…`}
                                            value={nuevos[key] || ''}
                                            maxLength={80}
                                            onChange={(e) => setNuevos({ ...nuevos, [key]: e.target.value })}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(key); } }}
                                            aria-label={`Nuevo ítem en ${titulo}`}
                                        />
                                        {(nuevos[key] || '').trim() && (
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => agregar(key)}>
                                                Agregar
                                            </button>
                                        )}
                                    </label>
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}

            <style>{styles}</style>
        </div>
    );
}

function EstadoGuardado({ estado }: { estado: Estado }) {
    return (
        <span className={`cat-estado ${estado}`} role="status" aria-live="polite">
            {estado === 'guardando' && <><span className="cat-estado-punto" aria-hidden="true" /> Guardando…</>}
            {estado === 'guardado' && <><FiCheck size={14} aria-hidden="true" /> Cambios guardados</>}
            {estado === 'error' && <><FiAlertTriangle size={14} aria-hidden="true" /> No se guardó el último cambio</>}
        </span>
    );
}

/**
 * Un ítem se edita en su lugar. El texto que se escribe es local y se guarda al
 * salir del campo o con Enter; Escape lo descarta. Así no se manda un guardado
 * por cada tecla y la respuesta del servidor no pisa lo que se está escribiendo.
 */
function ItemFila({ item, onRenombrar, onEliminar }: {
    item: CatalogoItem;
    onRenombrar: (label: string) => void;
    onEliminar: () => void;
}) {
    const [borrador, setBorrador] = useState(item.label);
    const [editando, setEditando] = useState(false);
    // Si el nombre cambia desde fuera (respuesta del servidor, reversión por
    // error) y no se está escribiendo, el campo lo toma.
    const [base, setBase] = useState(item.label);
    if (item.label !== base) {
        setBase(item.label);
        if (!editando) setBorrador(item.label);
    }

    const confirmar = (valor: string) => {
        setEditando(false);
        const label = valor.trim();
        if (!label) { setBorrador(item.label); return; }
        if (label !== item.label) onRenombrar(label);
        else setBorrador(item.label);
    };

    return (
        <div className="cat-fila">
            <input
                className="cat-input"
                value={borrador}
                maxLength={80}
                aria-label={`Nombre de ${item.label}`}
                onFocus={() => setEditando(true)}
                onChange={(e) => setBorrador(e.target.value)}
                onBlur={(e) => confirmar(e.currentTarget.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                    if (e.key === 'Escape') {
                        // El blur que sigue confirma: se deja el borrador igual al
                        // nombre para que no haya nada que guardar.
                        setBorrador(item.label);
                        (e.target as HTMLInputElement).value = item.label;
                        (e.target as HTMLInputElement).blur();
                    }
                }}
            />
            <button type="button" className="cat-borrar" onClick={onEliminar} aria-label={`Eliminar ${item.label}`} title="Eliminar">
                <FiTrash2 size={15} />
            </button>
        </div>
    );
}

// ── Esqueleto ────────────────────────────────────────────────────────────────
// Mismas clases que la página cargada y los largos del catálogo de fábrica
// (14 temas, 10 recursos, 12 riesgos, 10 medidas), que es lo que ve la mayoría.
const LARGOS: Record<Clave, number> = { temas: 14, recursos: 10, riesgos: 12, medidas: 10 };
const ANCHOS = ['46%', '62%', '38%', '54%', '70%', '42%', '58%', '50%'];

function CatalogosSkeleton() {
    return (
        <div className="cat-grid" aria-busy="true" aria-live="polite" aria-label="Cargando los catálogos">
            {SECCIONES.map(({ key }, s) => (
                <section key={key} className="cat-seccion">
                    <div className="cat-seccion-head" style={{ alignItems: 'center' }}>
                        <div className="cat-sk-renglon" style={{ height: 23 }}><div className="ui-skel" style={{ width: [120, 140, 116, 150][s], height: 14 }} /></div>
                        <div className="ui-skel" style={{ width: 26, height: 22, borderRadius: 999 }} />
                        <div className="cat-sk-renglon" style={{ height: 17 }}><div className="ui-skel" style={{ width: 240, height: 10 }} /></div>
                    </div>
                    <div className="cat-lista">
                        {Array.from({ length: LARGOS[key] }, (_, i) => (
                            <div key={i} className="cat-fila">
                                <div className="cat-sk-renglon" style={{ flex: 1, height: 32, padding: '0 9px' }}>
                                    <div className="ui-skel" style={{ width: ANCHOS[(i + s) % ANCHOS.length], height: 12 }} />
                                </div>
                            </div>
                        ))}
                        <div className="cat-agregar"><div className="ui-skel" style={{ width: 130, height: 12 }} /></div>
                    </div>
                </section>
            ))}
        </div>
    );
}

// Traducción del canvas "Catálogos" (CatalogosActividad.dc.html).
const styles = `
.cat-nota { margin: calc(-1 * var(--space-2)) 0 var(--space-6); font-size: 12.5px; color: var(--text-muted); }

.cat-estado { display: inline-flex; align-items: center; gap: 7px; min-height: 20px; font-size: 12.5px; color: var(--text-secondary); white-space: nowrap; }
.cat-estado.guardado svg { color: var(--success-apagado); }
.cat-estado.error { color: var(--danger-alerta); }
.cat-estado-punto { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: ui-latido 1s ease-in-out infinite; }

.cat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px 28px; align-items: start; }
.cat-seccion { display: flex; flex-direction: column; min-width: 0; }
.cat-seccion-head {
    display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px;
    padding-bottom: 9px; margin-bottom: 14px; border-bottom: 1px solid var(--surface-border);
}
.cat-seccion-titulo { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.cat-seccion-hint { margin: 0; flex: 1 1 200px; font-size: 11.5px; line-height: 1.5; color: var(--text-secondary); }
.cat-count {
    padding: 1px 8px; border: 1px solid var(--surface-border); border-radius: 999px;
    font-size: 11.5px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums;
}

.cat-lista { display: flex; flex-direction: column; border: 1px solid var(--surface-border); border-radius: 12px; overflow: hidden; }
.cat-fila {
    display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 8px 0 6px;
    border-bottom: 1px solid var(--surface-border);
}
.cat-input {
    flex: 1; min-width: 0; height: 32px; padding: 0 8px;
    border: 1px solid transparent; border-radius: 6px; background: none;
    color: var(--text-primary); font-family: inherit; font-size: 13.5px; outline: none;
    transition: border-color var(--transition-fast), background var(--transition-fast);
}
.cat-input:hover { border-color: var(--surface-border); }
.cat-input:focus { border-color: var(--accent); background: var(--surface-elevated); }
.cat-borrar {
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    width: 30px; height: 30px; padding: 0; border: none; border-radius: 6px;
    background: none; color: var(--text-muted); cursor: pointer; opacity: 0;
    transition: opacity var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}
.cat-fila:hover .cat-borrar, .cat-borrar:focus-visible { opacity: 1; }
.cat-borrar:hover { background: var(--surface-hover); color: var(--danger-alerta); }
@media (hover: none) { .cat-borrar { opacity: 1; } }

.cat-fila--eliminado { padding: 0 8px 0 14px; background: var(--surface-elevated); }
.cat-eliminado-texto { flex: 1; min-width: 0; font-size: 13px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cat-deshacer {
    display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border: none; border-radius: 6px;
    background: none; color: var(--accent-text); font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
}
.cat-deshacer:hover { background: var(--accent-tint); }

.cat-agregar { display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 8px 0 14px; color: var(--text-muted); cursor: text; }
.cat-agregar input {
    flex: 1; min-width: 0; height: 32px; border: none; background: none; outline: none;
    color: var(--text-primary); font-family: inherit; font-size: 13.5px;
}
.cat-agregar:focus-within { color: var(--accent-text); }

.cat-sk-renglon { display: flex; align-items: center; }

@media (max-width: 900px) { .cat-grid { grid-template-columns: minmax(0, 1fr); } }
`;
