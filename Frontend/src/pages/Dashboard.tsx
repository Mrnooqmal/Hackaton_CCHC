import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
    FiAlertTriangle,
    FiArrowRight,
    FiCalendar,
    FiCheckCircle,
    FiChevronRight,
    FiClipboard,
    FiClock,
    FiEdit3,
} from 'react-icons/fi';
import { activitiesApi, documentsApi, surveysApi } from '../api/client';
import type { Activity } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';

/**
 * Inicio de obra.
 *
 * Antes eran cinco vistas por rol, cada una con su grilla de métricas
 * (trabajadores, documentos, avance DS 44) y una tarjeta para "entrar" a la
 * obra en la que ya estabas. Nada de eso se accionaba desde la portada.
 *
 * Ahora hay UNA vista para todos, la del trabajador de terreno, que responde
 * qué tengo que hacer y por dónde entro. Los accesos son SIEMPRE los mismos
 * cuatro: repositorio y equipo de la obra son herramientas administrativas,
 * ya viven en la barra lateral de quien las necesita y acá solo agregaban
 * ruido para quien está en terreno. Ver css/dashboard.css para el diseño.
 */

const MAX_PENDIENTES = 4;
const MAX_AGENDA = 3;

type Urgencia = 'atrasado' | 'hoy' | 'normal';

interface Pendiente {
    id: string;
    titulo: string;
    meta: string;
    urgencia: Urgencia;
    /** Ítem marcado `bloqueante` en el kit del cargo: cuenta para "apto para terreno". */
    bloqueante: boolean;
    marca: string | null;
    icono: ReactNode;
    to: string;
}

interface AgendaItem {
    id: string;
    hora: string;
    titulo: string;
    meta: string;
    estado: 'hecha' | 'ahora' | 'proxima';
}

const ROL_LABELS: Record<string, string> = {
    admin: 'Administrador',
    prevencionista: 'Prevencionista',
    supervisor: 'Supervisor',
    jefe_obra: 'Jefe de obra',
    trabajador: 'Trabajador',
    relator: 'Relator',
};

/** Fecha local en ISO. `toISOString()` a secas es UTC: en Chile, después de las
 *  21:00 la portada daría por "hoy" el día siguiente y vaciaría la agenda. */
const fechaLocalISO = (d: Date = new Date()): string => {
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().split('T')[0];
};

const horaLocalHHMM = (d: Date = new Date()): string =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const aDate = (iso: string): Date => {
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(a, (m || 1) - 1, d || 1);
};

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Viernes 25 de septiembre", sin la coma que `Intl` mete tras el día. */
const fechaLarga = (iso: string): string => {
    const d = aDate(iso);
    const dia = new Intl.DateTimeFormat('es-CL', { weekday: 'long' }).format(d);
    const resto = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long' }).format(d);
    return `${capitalizar(dia)} ${resto}`;
};

const fechaCorta = (iso: string): string =>
    new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' }).format(aDate(iso));

/** Urgencia a partir del plazo de la asignación. `fechaLimite` es opcional en
 *  el backend: sin plazo no hay atraso que declarar. */
const urgenciaDePlazo = (limite: string | null | undefined, hoy: string): Urgencia => {
    if (!limite) return 'normal';
    if (limite < hoy) return 'atrasado';
    if (limite === hoy) return 'hoy';
    return 'normal';
};

const textoDePlazo = (limite: string | null | undefined, hoy: string): string => {
    if (!limite) return '';
    if (limite < hoy) return `Venció el ${fechaCorta(limite)}`;
    if (limite === hoy) return 'Vence hoy';
    return `Vence el ${fechaCorta(limite)}`;
};

const marcaDeUrgencia = (u: Urgencia): string | null =>
    u === 'atrasado' ? 'Atrasado' : u === 'hoy' ? 'Hoy' : null;

const PESO_URGENCIA: Record<Urgencia, number> = { atrasado: 0, hoy: 1, normal: 2 };

const valor = <T,>(r: PromiseSettledResult<T>): T | null =>
    r.status === 'fulfilled' ? r.value : null;

export default function Dashboard() {
    const { user } = useAuth();
    const { obras, selectedObraId } = useObraContext();

    const [cargando, setCargando] = useState(true);
    const [pendientes, setPendientes] = useState<Pendiente[]>([]);
    const [agenda, setAgenda] = useState<AgendaItem[]>([]);
    const [totalActividadesHoy, setTotalActividadesHoy] = useState(0);
    const [proxima, setProxima] = useState<{ titulo: string; cuando: string } | null>(null);
    const [firmasPendientes, setFirmasPendientes] = useState(0);
    const [encuestasPendientes, setEncuestasPendientes] = useState(0);
    const [bloqueantes, setBloqueantes] = useState(0);

    const personaId = user?.personaId;
    const obraActual = selectedObraId ? obras.find((o) => o.obraId === selectedObraId) : null;
    const hoy = fechaLocalISO();

    useEffect(() => {
        if (!user) return;
        let vivo = true;

        const cargar = async () => {
            setCargando(true);

            const [docsRes, encuestasRes, actividadesRes] = await Promise.allSettled([
                personaId ? documentsApi.list({ asignadoA: personaId }) : Promise.resolve(null),
                surveysApi.list(),
                activitiesApi.list({ obraId: selectedObraId || undefined }),
            ]);
            if (!vivo) return;

            const lista: Pendiente[] = [];
            let bloqueantesPend = 0;

            // ── Documentos asignados a mí ─────────────────────────────────────
            const docs = valor(docsRes)?.data?.documents || [];
            docs.forEach((doc) => {
                const asig = (doc.asignaciones || []).find(
                    (a) => a.personaId === personaId || a.workerId === personaId,
                );
                if (!asig) return;
                if (asig.estado === 'firmado' || asig.fechaFirma) return;
                // Sin archivo cargado todavía no es responsabilidad de la persona:
                // espera que el admin suba la plantilla.
                if (!doc.s3Key && !doc.archivoUrl) return;

                const urgencia = urgenciaDePlazo(asig.fechaLimite, hoy);
                const bloqueante = Boolean(doc.bloqueante);
                if (bloqueante) bloqueantesPend += 1;

                const plazo = textoDePlazo(asig.fechaLimite, hoy);
                const contexto = bloqueante
                    ? 'Requisito para ingresar a terreno'
                    : doc.tipoDescripcion || 'Documento pendiente de firma';

                lista.push({
                    id: `doc:${doc.documentId}`,
                    titulo: `Firmar ${doc.titulo}`,
                    meta: [contexto, plazo].filter(Boolean).join(' · '),
                    urgencia,
                    bloqueante,
                    marca: marcaDeUrgencia(urgencia),
                    icono: <FiEdit3 size={17} />,
                    to: '/my-signatures',
                });
            });

            // ── Encuestas asignadas y sin responder ───────────────────────────
            const encuestas = valor(encuestasRes)?.data?.surveys || [];
            // `miAsignacion` la calcula el backend: el listado no trae `recipients`.
            const misEncuestas = encuestas.filter((s) => s.miAsignacion?.estado === 'pendiente');
            misEncuestas.forEach((s) => {
                lista.push({
                    id: `enc:${s.surveyId}`,
                    titulo: `Responder ${s.titulo}`,
                    meta: s.descripcion || 'Encuesta interna',
                    urgencia: 'normal',
                    bloqueante: false,
                    marca: null,
                    icono: <FiClipboard size={17} />,
                    to: `/surveys/${s.surveyId}/responder`,
                });
            });

            // ── Actividades ───────────────────────────────────────────────────
            const actividades = valor(actividadesRes)?.data?.activities || [];
            const soyRequerido = (a: Activity) =>
                (a.asistentesRequeridos || []).includes(personaId || '') ||
                a.relatorId === personaId ||
                (a.responsables || []).includes(personaId || '');
            const asistio = (a: Activity) =>
                (a.asistentes || []).some((x) => x.personaId === personaId || x.workerId === personaId);

            // Solo las VENCIDAS entran a pendientes. Las de hoy ya viven en la
            // agenda: repetirlas en las dos listas es ruido, no urgencia.
            actividades
                .filter((a) => a.fecha < hoy && soyRequerido(a) && !asistio(a) && a.estado !== 'cancelada')
                .forEach((a) => {
                    lista.push({
                        id: `act:${a.activityId}`,
                        titulo: `Registrar asistencia: ${a.titulo}`,
                        meta: `${a.tipoDescripcion || 'Actividad'} · Fue el ${fechaCorta(a.fecha)}`,
                        urgencia: 'atrasado',
                        bloqueante: false,
                        marca: 'Atrasado',
                        icono: <FiCalendar size={17} />,
                        to: '/activities',
                    });
                });

            // Bloqueante y atrasado primero: es lo que impide trabajar.
            lista.sort((a, b) => {
                const porUrgencia = PESO_URGENCIA[a.urgencia] - PESO_URGENCIA[b.urgencia];
                if (porUrgencia !== 0) return porUrgencia;
                return Number(b.bloqueante) - Number(a.bloqueante);
            });

            // "Tu día" es MI día: las actividades en las que participo o que
            // relato, no la agenda completa de la faena.
            const miasHoy = actividades
                .filter((a) => a.fecha === hoy && a.estado !== 'cancelada' && soyRequerido(a))
                .sort((a, b) => (a.horaInicio || '').localeCompare(b.horaInicio || ''));

            const ahora = horaLocalHHMM();
            const iSiguiente = miasHoy.findIndex((a) => !asistio(a) && (a.horaInicio || '23:59') >= ahora);
            const items: AgendaItem[] = miasHoy.slice(0, MAX_AGENDA).map((a, i) => ({
                id: a.activityId,
                hora: a.horaInicio || '—',
                titulo: a.titulo,
                meta: [a.ubicacion, asistio(a) ? 'Asistencia registrada' : a.tipoDescripcion]
                    .filter(Boolean)
                    .join(' · '),
                estado: asistio(a) || a.estado === 'completada' ? 'hecha' : i === iSiguiente ? 'ahora' : 'proxima',
            }));

            // "Lo próximo" del estado vacío: la primera actividad futura que me toca.
            const futura = actividades
                .filter((a) => a.fecha > hoy && soyRequerido(a) && a.estado !== 'cancelada')
                .sort((a, b) => `${a.fecha}${a.horaInicio}`.localeCompare(`${b.fecha}${b.horaInicio}`))[0];

            if (!vivo) return;
            setPendientes(lista);
            setFirmasPendientes(lista.filter((p) => p.id.startsWith('doc:')).length);
            setEncuestasPendientes(misEncuestas.length);
            setBloqueantes(bloqueantesPend);
            setAgenda(items);
            setTotalActividadesHoy(miasHoy.length);
            setProxima(
                futura
                    ? {
                          titulo: futura.titulo,
                          cuando: `${fechaLarga(futura.fecha)} ${futura.horaInicio || ''}`.trim(),
                      }
                    : null,
            );
            setCargando(false);
        };

        cargar().catch((e) => {
            console.error('No se pudo cargar el inicio:', e);
            if (vivo) setCargando(false);
        });

        return () => {
            vivo = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, selectedObraId]);

    /** Siempre los mismos cuatro, siempre en el mismo orden. No aparecen ni
     *  desaparecen según los datos: solo cambia su línea de estado. */
    const accesos = useMemo(
        () => [
            {
                key: 'firmas',
                to: '/my-signatures',
                nombre: 'Mis firmas',
                estado: firmasPendientes > 0 ? `${firmasPendientes} por firmar` : 'Al día',
                activo: firmasPendientes > 0,
                alerta: false,
                icono: <FiEdit3 size={21} />,
            },
            {
                key: 'actividades',
                to: '/activities',
                nombre: 'Actividades',
                estado: totalActividadesHoy > 0 ? `${totalActividadesHoy} hoy` : 'Nada hoy',
                activo: totalActividadesHoy > 0,
                alerta: false,
                icono: <FiCalendar size={21} />,
            },
            {
                key: 'encuestas',
                to: '/surveys',
                nombre: 'Encuestas',
                estado: encuestasPendientes > 0 ? `${encuestasPendientes} sin responder` : 'Al día',
                activo: encuestasPendientes > 0,
                alerta: false,
                icono: <FiClipboard size={21} />,
            },
            // Acción, no contador: nunca lleva cifra. El rojo apagado del ícono
            // es identidad para encontrarlo rápido, no una alarma.
            {
                key: 'incidente',
                to: '/incidents',
                nombre: 'Reportar incidente',
                estado: 'Registro inmediato',
                activo: false,
                alerta: true,
                icono: <FiAlertTriangle size={21} />,
            },
        ],
        [firmasPendientes, totalActividadesHoy, encuestasPendientes],
    );

    const visibles = pendientes.slice(0, MAX_PENDIENTES);
    const restantes = pendientes.length - visibles.length;
    const atrasados = pendientes.filter((p) => p.urgencia === 'atrasado').length;
    const vencenHoy = pendientes.filter((p) => p.urgencia === 'hoy').length;

    const subtitulo = [fechaLarga(hoy), obraActual?.nombre].filter(Boolean).join(' · ');
    const chip = ROL_LABELS[user?.rol || ''] || '';

    return (
        <div className="page-content">
            <div className="inicio">
                <header className="inicio-hd">
                    <div className="inicio-hd-texto">
                        <h1 className="inicio-hd-saludo">Hola, {user?.nombre || ''}</h1>
                        <p className="inicio-hd-sub">{subtitulo}</p>
                    </div>
                    {chip && <span className="inicio-hd-chip">{chip}</span>}
                </header>

                {bloqueantes > 0 && !cargando && (
                    <Link to="/my-signatures" className="inicio-aviso">
                        <span className="inicio-aviso-icono">
                            <FiAlertTriangle size={18} />
                        </span>
                        <span className="inicio-aviso-cuerpo">
                            <span className="inicio-aviso-titulo">
                                {bloqueantes === 1
                                    ? 'Te falta 1 firma para quedar apto para ingresar a terreno'
                                    : `Te faltan ${bloqueantes} firmas para quedar apto para ingresar a terreno`}
                            </span>
                            <span className="inicio-aviso-nota">
                                Resuélvelas primero: el resto de tus pendientes puede esperar.
                            </span>
                        </span>
                        <span className="inicio-aviso-cta">Firmar ahora</span>
                    </Link>
                )}

                <section className="inicio-seccion">
                    <h2 className="inicio-rotulo">Accesos rápidos</h2>
                    <div className="inicio-accesos">
                        {accesos.map((a) => (
                            <Link key={a.key} to={a.to} className="inicio-acceso">
                                <span
                                    className={`inicio-acceso-icono${a.alerta ? ' inicio-acceso-icono--alerta' : ''}`}
                                >
                                    {a.icono}
                                </span>
                                <span className="inicio-acceso-texto">
                                    <span className="inicio-acceso-nombre">{a.nombre}</span>
                                    <span
                                        className={`inicio-acceso-estado${a.activo ? ' inicio-acceso-estado--activo' : ''}`}
                                    >
                                        {cargando ? '—' : a.estado}
                                    </span>
                                </span>
                            </Link>
                        ))}
                    </div>
                </section>

                <div className="inicio-cols">
                    {/* ── Pendientes ─────────────────────────────────────────── */}
                    <section className="inicio-panel">
                        <div className="inicio-panel-hd">
                            <h2 className="inicio-panel-titulo">Tus pendientes</h2>
                            {atrasados > 0 && (
                                <span className="inicio-marca-alerta">
                                    {atrasados} {atrasados === 1 ? 'atrasado' : 'atrasados'}
                                </span>
                            )}
                            <span className="inicio-panel-nota">
                                {cargando
                                    ? ''
                                    : pendientes.length === 0
                                      ? 'Ninguno'
                                      : vencenHoy > 0
                                        ? `${vencenHoy} ${vencenHoy === 1 ? 'vence' : 'vencen'} hoy`
                                        : `${pendientes.length} en total`}
                            </span>
                        </div>

                        {cargando ? (
                            <div className="inicio-cargando" />
                        ) : pendientes.length === 0 ? (
                            <>
                                <div className="inicio-vacio">
                                    <span className="inicio-vacio-sello">
                                        <FiCheckCircle size={26} />
                                    </span>
                                    <p className="inicio-vacio-titulo">Todo al día</p>
                                    <p className="inicio-vacio-texto">
                                        No tienes firmas, actividades ni encuestas esperando por ti en esta obra.
                                    </p>
                                </div>
                                {proxima && (
                                    <div className="inicio-proximo">
                                        <FiClock size={16} />
                                        <span>
                                            Lo próximo: <strong>{proxima.titulo}</strong> · {proxima.cuando}
                                        </span>
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <ul className="inicio-lista">
                                    {visibles.map((p) => (
                                        <li key={p.id}>
                                            <Link to={p.to} className="inicio-item">
                                                <span
                                                    className={`inicio-item-icono${p.urgencia === 'atrasado' ? ' inicio-item-icono--alerta' : ''}`}
                                                >
                                                    {p.icono}
                                                </span>
                                                <span className="inicio-item-cuerpo">
                                                    <span className="inicio-item-titulo">{p.titulo}</span>
                                                    <span className="inicio-item-meta">{p.meta}</span>
                                                </span>
                                                {p.marca && (
                                                    <span
                                                        className={`inicio-marca${p.urgencia === 'atrasado' ? ' inicio-marca--alerta' : ''}`}
                                                    >
                                                        {p.marca}
                                                    </span>
                                                )}
                                                <span className="inicio-item-chevron">
                                                    <FiChevronRight size={18} />
                                                </span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                                <Link to="/my-signatures" className="inicio-panel-pie">
                                    {restantes > 0
                                        ? `${restantes} ${restantes === 1 ? 'pendiente más' : 'pendientes más'}`
                                        : 'Ver todos tus pendientes'}
                                    <FiArrowRight size={16} />
                                </Link>
                            </>
                        )}
                    </section>

                    {/* ── Agenda del día ─────────────────────────────────────── */}
                    <section className="inicio-panel">
                        <div className="inicio-panel-hd">
                            <h2 className="inicio-panel-titulo">Tu día</h2>
                            <span className="inicio-panel-nota">
                                {cargando
                                    ? ''
                                    : totalActividadesHoy === 0
                                      ? 'Sin actividades'
                                      : `${totalActividadesHoy} ${totalActividadesHoy === 1 ? 'actividad' : 'actividades'}`}
                            </span>
                        </div>

                        {cargando ? (
                            <div className="inicio-cargando" />
                        ) : agenda.length === 0 ? (
                            <div className="inicio-vacio">
                                <span className="inicio-vacio-icono">
                                    <FiCalendar size={30} />
                                </span>
                                <p className="inicio-vacio-texto">
                                    No hay actividades programadas para hoy en esta obra.
                                </p>
                            </div>
                        ) : (
                            <ul className="inicio-agenda">
                                {agenda.map((a, i) => (
                                    <li key={a.id}>
                                        <span
                                            className={`inicio-agenda-hora${a.estado === 'ahora' ? ' inicio-agenda-hora--ahora' : ''}`}
                                        >
                                            {a.hora}
                                        </span>
                                        <span className="inicio-agenda-riel">
                                            <span
                                                className={`inicio-agenda-punto${a.estado === 'hecha' ? ' inicio-agenda-punto--hecha' : ''}${a.estado === 'ahora' ? ' inicio-agenda-punto--ahora' : ''}`}
                                            />
                                            {i < agenda.length - 1 && <span className="inicio-agenda-linea" />}
                                        </span>
                                        <span className="inicio-agenda-cuerpo">
                                            <span
                                                className={`inicio-agenda-titulo${a.estado === 'hecha' ? ' inicio-agenda-titulo--hecha' : ''}`}
                                            >
                                                {a.titulo}
                                            </span>
                                            {a.meta && <span className="inicio-agenda-meta">{a.meta}</span>}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {!cargando && (
                            <Link to="/activities" className="inicio-panel-pie">
                                {totalActividadesHoy > MAX_AGENDA
                                    ? `${totalActividadesHoy - MAX_AGENDA} actividades más hoy`
                                    : 'Ver calendario de la obra'}
                                <FiArrowRight size={16} />
                            </Link>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
