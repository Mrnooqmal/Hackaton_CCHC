import { useMemo, useRef, useState } from 'react';
import { LuPaperclip, LuSearch, LuUpload } from 'react-icons/lu';
import { Drawer } from '../ui';
import { documentsApi } from '../../api/documents.api';
import { subirComoDocumento } from '../../utils/subirDocumento';
import { caducidadPorDefecto } from '../../utils/vigenciaDocumento';
// El día en hora de Chile: en UTC salta a mañana desde las ~20:00.
import { hoyISO as hoy } from '../../utils/seguimientoActividad';

export interface PersonaFirmante {
    personaId: string;
    nombre: string;
    apellido?: string;
    cargo?: string;
}

export interface CargaEvidenciaProps {
    /** `cargar`: sube el archivo y, si se eligen, asigna firmantes.
     *  `firmantes`: el documento ya está; solo se eligen quiénes lo firman. */
    modo: 'cargar' | 'firmantes';
    tenantId: string;
    obraId?: string | null;
    /** Nombre del requisito: va de título del documento y del panel. */
    titulo: string;
    /** Qué se está cargando, en palabras del motor. */
    que?: string | null;
    /** Tipo del documento a crear (modo `cargar`). */
    tipo?: string;
    /** Documento existente (modo `firmantes`). */
    documentId?: string;
    personas: PersonaFirmante[];
    onCerrar: () => void;
    onListo: () => void | Promise<void>;
}

// El mismo tope que aplica el backend (handlers/uploads): mejor avisarlo antes de subir.
const MAX_BYTES = 10 * 1024 * 1024;
const nombreDe = (p: PersonaFirmante) => `${p.nombre} ${p.apellido || ''}`.trim();

/**
 * Carga de evidencia de un requisito del DS 44, con sus firmantes.
 *
 * Existía en la obra hasta el 10 de septiembre (commit d559ef3), cuando la lista
 * de la fase pasó al motor FUF y el modal dejó de abrirse: desde entonces subir
 * no pedía quiénes firman, ni la fecha del hecho, ni la caducidad. Sin firmantes
 * un registro de capacitación no deja constancia de QUIÉNES asistieron (Art. 13
 * inc. 4), y el requisito no se podía cerrar.
 */
export default function CargaEvidencia({
    modo, tenantId, obraId = null, titulo, que, tipo, documentId, personas, onCerrar, onListo,
}: CargaEvidenciaProps) {
    const inputArchivo = useRef<HTMLInputElement | null>(null);
    const [archivo, setArchivo] = useState<File | null>(null);
    const [fecha, setFecha] = useState(hoy());
    const [conCaducidad, setConCaducidad] = useState(true);
    const [caducidad, setCaducidad] = useState(caducidadPorDefecto());
    const [firmantes, setFirmantes] = useState<Set<string>>(new Set());
    const [filtro, setFiltro] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [arrastrando, setArrastrando] = useState(false);

    // En una capacitación los firmantes son los asistentes: es lo que el
    // registro tiene que acreditar.
    const esCapacitacion = Boolean(tipo?.startsWith('CAPACITACION') || /capacitaci/i.test(titulo));
    const rotuloFirmantes = esCapacitacion ? 'Asistentes (firman el registro)' : 'Quiénes deben firmarlo';

    const visibles = useMemo(() => {
        const q = filtro.trim().toLowerCase();
        return q ? personas.filter((p) => `${nombreDe(p)} ${p.cargo || ''}`.toLowerCase().includes(q)) : personas;
    }, [personas, filtro]);

    const alternar = (id: string) => setFirmantes((prev) => {
        const s = new Set(prev);
        if (s.has(id)) s.delete(id); else s.add(id);
        return s;
    });
    const todosVisibles = visibles.length > 0 && visibles.every((p) => firmantes.has(p.personaId));
    const alternarTodos = () => setFirmantes((prev) => {
        const s = new Set(prev);
        visibles.forEach((p) => (todosVisibles ? s.delete(p.personaId) : s.add(p.personaId)));
        return s;
    });

    const guardar = async () => {
        setError(null);
        if (modo === 'cargar' && !archivo) { setError('Selecciona el archivo.'); return; }
        if (modo === 'firmantes' && firmantes.size === 0) { setError('Elige al menos a una persona.'); return; }
        setGuardando(true);
        try {
            let id = documentId || null;
            if (modo === 'cargar') {
                if (!tipo || !archivo) return;
                id = await subirComoDocumento({
                    file: archivo, tipo, titulo, tenantId, obraId,
                    fecha, fechaCaducidad: conCaducidad ? caducidad : null,
                });
            }
            if (id && firmantes.size > 0) {
                const ids = [...firmantes];
                const res = await documentsApi.assign(id, { workerIds: ids, personaIds: ids, notificar: true });
                if (!res.success) throw new Error(res.error || 'El documento se cargó, pero no se pudieron asignar los firmantes.');
            }
            await onListo();
            onCerrar();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudo guardar.');
        } finally {
            setGuardando(false);
        }
    };

    const elegir = (f: File | null | undefined) => {
        if (!f) return;
        if (f.size > MAX_BYTES) { setError('El archivo pesa más de 10 MB.'); return; }
        setError(null);
        setArchivo(f);
    };
    const alSoltar = (e: React.DragEvent) => {
        e.preventDefault();
        setArrastrando(false);
        elegir(e.dataTransfer.files?.[0]);
    };

    return (
        <Drawer
            isOpen
            onClose={guardando ? () => undefined : onCerrar}
            title={modo === 'cargar' ? 'Cargar documento' : 'Elegir firmantes'}
            subtitle={titulo}
            width={520}
            footer={(
                <>
                    <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>Cancelar</button>
                    <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando}>
                        {guardando ? 'Guardando…' : modo === 'cargar' ? 'Cargar documento' : 'Asignar firmantes'}
                    </button>
                </>
            )}
        >
            <div className="ce">
                {que && <p className="ce-falta">Falta {que}.</p>}

                {modo === 'cargar' && (
                    <>
                        <section className="dp-bloque" aria-label="Archivo">
                            <span className="ob-rotulo">Archivo</span>
                            <input
                                ref={inputArchivo} type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                                onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ''; }}
                            />
                            {archivo ? (
                                <div className="ce-archivo">
                                    <LuPaperclip size={16} aria-hidden="true" />
                                    <span className="ce-archivo__texto">
                                        <span className="ce-archivo__nombre">{archivo.name}</span>
                                        <span className="ce-archivo__peso">{(archivo.size / 1024 / 1024).toFixed(2)} MB</span>
                                    </span>
                                    <button type="button" className="ob-btn" onClick={() => inputArchivo.current?.click()}>Cambiar</button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    className={`ce-zona${arrastrando ? ' ce-zona--activa' : ''}`}
                                    onClick={() => inputArchivo.current?.click()}
                                    onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
                                    onDragLeave={() => setArrastrando(false)}
                                    onDrop={alSoltar}
                                >
                                    <LuUpload size={22} aria-hidden="true" />
                                    <span className="ce-zona__titulo">Selecciona o arrastra el archivo</span>
                                    <span className="ce-zona__nota">PDF o imagen, hasta 10 MB</span>
                                </button>
                            )}
                        </section>

                        <section className="dp-bloque" aria-label="Fechas">
                            <span className="ob-rotulo">Fechas</span>
                            <div className="dp-campos">
                                <label className="dp-campo dp-campo--fecha">
                                    <span className="form-label">Fecha del hecho</span>
                                    <input type="date" className="form-input" max={hoy()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
                                </label>
                                <div className="dp-campo dp-campo--fecha">
                                    <label className="ce-check">
                                        <input type="checkbox" checked={conCaducidad} onChange={(e) => setConCaducidad(e.target.checked)} />
                                        <span className="form-label" style={{ margin: 0 }}>Caduca el</span>
                                    </label>
                                    <input type="date" className="form-input" min={fecha} value={caducidad} disabled={!conCaducidad}
                                        onChange={(e) => setCaducidad(e.target.value)} aria-label="Fecha de caducidad" />
                                </div>
                            </div>
                            <p className="dp-nota">
                                La fecha del hecho es cuándo ocurrió lo que el documento acredita (la capacitación, el ensayo), no el día en que se sube.
                            </p>
                        </section>
                    </>
                )}

                <section className="dp-bloque" aria-label={rotuloFirmantes}>
                    <span className="ce-firmantes__cabeza">
                        <span className="ob-rotulo">{rotuloFirmantes}</span>
                        <span className="dp-nota">{firmantes.size > 0 ? `${firmantes.size} seleccionada(s)` : modo === 'cargar' ? 'Opcional' : ''}</span>
                    </span>
                    {personas.length === 0 ? (
                        <p className="dp-nota">No hay personas asignadas a esta obra.</p>
                    ) : (
                        <>
                            <label className="rd-buscar" style={{ margin: 0 }}>
                                <LuSearch size={14} aria-hidden="true" />
                                <input type="search" placeholder="Buscar por nombre o cargo" aria-label="Buscar persona"
                                    value={filtro} onChange={(e) => setFiltro(e.target.value)} />
                            </label>
                            <div className="ce-firmantes" role="group" aria-label={rotuloFirmantes}>
                                <label className="ce-firmante ce-firmante--todos">
                                    <input type="checkbox" checked={todosVisibles} onChange={alternarTodos} />
                                    <span>{filtro ? 'Todos los resultados' : 'Todas las personas de la obra'}</span>
                                </label>
                                {visibles.map((p) => (
                                    <label key={p.personaId} className="ce-firmante">
                                        <input type="checkbox" checked={firmantes.has(p.personaId)} onChange={() => alternar(p.personaId)} />
                                        <span className="ce-firmante__texto">
                                            <span>{nombreDe(p)}</span>
                                            {p.cargo && <span className="ce-firmante__cargo">{p.cargo}</span>}
                                        </span>
                                    </label>
                                ))}
                                {visibles.length === 0 && <p className="dp-nota" style={{ padding: '12px' }}>Nadie coincide con la búsqueda.</p>}
                            </div>
                        </>
                    )}
                    <p className="dp-nota">Cada persona elegida lo recibe en "Mis firmas" y lo firma con su PIN.</p>
                </section>

                {error && <div className="ds44-alert ds44-alert-danger" style={{ fontSize: '0.85rem' }}>{error}</div>}
            </div>
        </Drawer>
    );
}
