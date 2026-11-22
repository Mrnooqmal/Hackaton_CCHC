import { useState } from 'react';
import { FiEdit2, FiPlus } from 'react-icons/fi';
import { incidentsApi, type Incident, type MedidaCorrectiva } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Badge, Select } from './ui';
import SelectorResponsable from './SelectorResponsable';
import { fechaLocal } from '../utils/prescripciones';
import {
    ESTADOS_MEDIDA, JERARQUIA_CONTROL, MAX_MEDIDAS_POR_CASO, MAX_TEXTO_MEDIDA, medidaTerminada,
    type EstadoMedida, type JerarquiaControl,
} from '../utils/casos';
import { plural } from '../utils/plural';

const ETIQUETA_ESTADO: Record<EstadoMedida, string> = {
    pendiente: 'Pendiente',
    en_proceso: 'En proceso',
    completada: 'Completada',
    verificada: 'Verificada',
};

const ETIQUETA_JERARQUIA: Record<JerarquiaControl, string> = {
    eliminacion: 'Eliminar el peligro',
    sustitucion: 'Sustituir por algo menos peligroso',
    ingenieria: 'Control de ingeniería',
    administrativa: 'Control administrativo',
    epp: 'Elementos de protección personal',
};

const VARIANTE_ESTADO: Record<EstadoMedida, 'neutral' | 'info' | 'success' | 'secondary'> = {
    pendiente: 'neutral',
    en_proceso: 'info',
    completada: 'success',
    verificada: 'success',
};

/** AAAA-MM-DD sin zona: con `new Date('2026-11-15')` se leería como UTC y en Chile mostraría el día anterior. */
const fechaCorta = (aaaammdd?: string | null) => {
    const [a, m, d] = String(aaaammdd || '').slice(0, 10).split('-').map(Number);
    return a && m && d ? new Date(a, m - 1, d).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Sin plazo';
};

interface FormMedida {
    medida: string;
    causaRaiz: string;
    responsableId: string;
    fechaMaxEjecucion: string;
    jerarquia: JerarquiaControl | '';
}

const FORM_VACIO: FormMedida = { medida: '', causaRaiz: '', responsableId: '', fechaMaxEjecucion: '', jerarquia: '' };

interface Props {
    incidente: Incident;
    /** `incidentes.reportar`: quien gestiona el caso crea y edita medidas y cambia su estado. */
    puedeGestionar: boolean;
    /** Un caso cerrado no admite medidas nuevas ni ediciones; solo confirmar lo hecho. */
    cerrado: boolean;
    /** Se llama cuando el servidor guardó un cambio, para que la pantalla recargue el caso. */
    onCambio: () => void;
}

/**
 * "Medidas" del caso (fase 3): la lista de medidas correctivas con su responsable,
 * plazo y estado; crear y editar (con permiso) y cambiar el estado.
 *
 * El estado se cambia con la misma ruta que usa la obra (`PUT /incidents/{id}/medidas/
 * {n}`). El nombre de la persona responsable lo pone el servidor desde su ficha, y
 * a ella le llega un aviso a su bandeja al asignársela. El cierre del caso exige que
 * todas estén completadas o verificadas.
 */
export default function MedidasDelCaso({ incidente, puedeGestionar, cerrado, onCambio }: Props) {
    const { toast } = useToast();
    const medidas = incidente.medidasCorrectivas ?? [];
    const id = incidente.incidentId;

    // `editando`: null = formulario cerrado; 'nueva' = crear; si no, el número de la medida.
    const [editando, setEditando] = useState<null | 'nueva' | string>(null);
    const [form, setForm] = useState<FormMedida>(FORM_VACIO);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const [cambiando, setCambiando] = useState<string | null>(null);

    const hoy = fechaLocal();
    const llena = medidas.length >= MAX_MEDIDAS_POR_CASO;

    const abrirNueva = () => { setForm(FORM_VACIO); setError(''); setEditando('nueva'); };
    const abrirEdicion = (m: MedidaCorrectiva) => {
        setForm({
            medida: m.medida || '',
            causaRaiz: m.causaRaiz || '',
            responsableId: m.responsableId || '',
            fechaMaxEjecucion: m.fechaMaxEjecucion ? String(m.fechaMaxEjecucion).slice(0, 10) : '',
            jerarquia: m.jerarquia ?? '',
        });
        setError('');
        setEditando(String(m.numero));
    };

    const guardar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (guardando || editando === null) return;
        if (!form.medida.trim()) { setError('Escribe qué hay que hacer.'); return; }
        if (!form.responsableId) { setError('Elige a la persona responsable.'); return; }
        if (!form.fechaMaxEjecucion) { setError('Elige el plazo.'); return; }
        setError('');
        setGuardando(true);
        try {
            const base = {
                medida: form.medida.trim(),
                causaRaiz: form.causaRaiz.trim(),
                responsableId: form.responsableId,
                fechaMaxEjecucion: form.fechaMaxEjecucion,
                jerarquia: form.jerarquia || null,
            };
            const res = editando === 'nueva'
                ? await incidentsApi.crearMedida(id, { ...base, jerarquia: form.jerarquia || undefined })
                : await incidentsApi.editarMedida(id, editando, base);
            if (!res.success) { setError(res.error || 'No se pudo guardar la medida.'); return; }
            toast.success(editando === 'nueva' ? 'Medida agregada' : 'Medida actualizada');
            setEditando(null);
            onCambio();
        } catch {
            setError('Error de conexión al guardar la medida. Intenta de nuevo.');
        } finally {
            setGuardando(false);
        }
    };

    const cambiarEstado = async (m: MedidaCorrectiva, estado: EstadoMedida) => {
        if (estado === m.estado) return;
        setCambiando(String(m.numero));
        try {
            const res = await incidentsApi.updateMedidaEstado(id, m.numero, estado);
            if (!res.success) { toast.error(res.error || 'No se pudo cambiar el estado de la medida.'); return; }
            onCambio();
        } catch {
            toast.error('Error de conexión al cambiar el estado de la medida.');
        } finally {
            setCambiando(null);
        }
    };

    const completadas = medidas.filter((m) => medidaTerminada(m)).length;

    return (
        <section className="inc-ficha-card" aria-label="Medidas del caso">
            <div>
                <h2 className="inc-papeles-titulo">Medidas</h2>
                <p className="inc-ficha-texto inc-papeles-ayuda">
                    Lo que se va a hacer para corregir lo ocurrido y evitar que se repita, con quién lo hace y para cuándo. Para cerrar el caso, todas tienen que estar completadas.
                </p>
            </div>

            <div>
                <div className="inc-ficha-label">
                    {medidas.length === 0 ? 'Todavía no hay medidas' : `${completadas} de ${plural(medidas.length, 'medida completada', 'medidas completadas')}`}
                </div>
                {medidas.length > 0 && (
                    <ul className="inc-papeles-lista">
                        {medidas.map((m) => {
                            const numero = String(m.numero);
                            const terminada = medidaTerminada(m);
                            const vencida = !terminada && Boolean(m.fechaMaxEjecucion) && String(m.fechaMaxEjecucion).slice(0, 10) < hoy;
                            // En un caso cerrado solo se puede dejar completada o verificada.
                            const estados = cerrado ? ESTADOS_MEDIDA.filter((e) => e === 'completada' || e === 'verificada') : ESTADOS_MEDIDA;
                            return (
                                <li key={numero} className="inc-papeles-fila">
                                    <div className="inc-papeles-nombre">
                                        <div>{numero}. {m.medida}</div>
                                        <div className="inc-papeles-meta">
                                            {m.responsableNombre || 'Sin responsable'} · plazo {fechaCorta(m.fechaMaxEjecucion)}
                                            {m.jerarquia ? ` · ${ETIQUETA_JERARQUIA[m.jerarquia] ?? m.jerarquia}` : ''}
                                            {m.causaRaiz ? ` · causa: ${m.causaRaiz}` : ''}
                                        </div>
                                    </div>
                                    {vencida && <Badge variant="danger" size="sm">Vencida</Badge>}
                                    {puedeGestionar ? (
                                        <div className="inc-medidas-estado">
                                            <Select
                                                ariaLabel={`Estado de la medida ${numero}`}
                                                value={m.estado}
                                                onChange={(v) => cambiarEstado(m, v as EstadoMedida)}
                                                options={estados.map((e) => ({ value: e, label: ETIQUETA_ESTADO[e] }))}
                                                disabled={cambiando === numero}
                                            />
                                        </div>
                                    ) : (
                                        <Badge variant={VARIANTE_ESTADO[m.estado] ?? 'neutral'} size="sm">{ETIQUETA_ESTADO[m.estado] ?? m.estado}</Badge>
                                    )}
                                    {puedeGestionar && !cerrado && !terminada && (
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => abrirEdicion(m)}>
                                            <FiEdit2 size={14} /> Editar
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {puedeGestionar && !cerrado && editando === null && (
                <div>
                    <button type="button" className="btn btn-secondary" onClick={abrirNueva} disabled={llena}>
                        <FiPlus size={16} /> Agregar una medida
                    </button>
                    {llena && <p className="inc-ficha-texto inc-papeles-ayuda">El caso admite hasta {MAX_MEDIDAS_POR_CASO} medidas.</p>}
                </div>
            )}

            {puedeGestionar && !cerrado && editando !== null && (
                <form className="inc-papeles-form" onSubmit={guardar}>
                    <div className="inc-ficha-label">{editando === 'nueva' ? 'Nueva medida' : `Editar la medida ${editando}`}</div>
                    <div className="form-group">
                        <label className="form-label" htmlFor="medida-texto">Qué hay que hacer</label>
                        <textarea
                            id="medida-texto"
                            className="form-input"
                            rows={2}
                            maxLength={MAX_TEXTO_MEDIDA}
                            value={form.medida}
                            disabled={guardando}
                            onChange={(e) => setForm({ ...form, medida: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label" htmlFor="medida-causa">Causa que corrige (opcional)</label>
                        <textarea
                            id="medida-causa"
                            className="form-input"
                            rows={2}
                            maxLength={MAX_TEXTO_MEDIDA}
                            value={form.causaRaiz}
                            disabled={guardando}
                            onChange={(e) => setForm({ ...form, causaRaiz: e.target.value })}
                        />
                    </div>
                    <div className="inc-papeles-campos">
                        <div className="form-group">
                            <label className="form-label">Responsable</label>
                            <SelectorResponsable value={form.responsableId} onChange={(v) => setForm({ ...form, responsableId: v })} disabled={guardando} />
                        </div>
                        <div className="form-group">
                            <label className="form-label" htmlFor="medida-plazo">Plazo</label>
                            <input
                                id="medida-plazo"
                                className="form-input"
                                type="date"
                                min={editando === 'nueva' ? hoy : undefined}
                                value={form.fechaMaxEjecucion}
                                disabled={guardando}
                                onChange={(e) => setForm({ ...form, fechaMaxEjecucion: e.target.value })}
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Tipo de control (opcional)</label>
                            <Select
                                ariaLabel="Tipo de control"
                                value={form.jerarquia}
                                onChange={(v) => setForm({ ...form, jerarquia: v as JerarquiaControl })}
                                placeholder="Sin especificar"
                                options={JERARQUIA_CONTROL.map((j) => ({ value: j, label: ETIQUETA_JERARQUIA[j] }))}
                                disabled={guardando}
                            />
                        </div>
                    </div>
                    {editando === 'nueva' && (
                        <p className="inc-ficha-texto inc-papeles-ayuda">A la persona responsable le llega un aviso en su bandeja.</p>
                    )}
                    {error && <div className="alert alert-danger" role="alert"><div>{error}</div></div>}
                    <div className="inc-medidas-acciones">
                        <button type="submit" className="btn btn-primary" disabled={guardando}>
                            {guardando ? 'Guardando…' : editando === 'nueva' ? 'Agregar medida' : 'Guardar cambios'}
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => setEditando(null)} disabled={guardando}>Cancelar</button>
                    </div>
                </form>
            )}
        </section>
    );
}
