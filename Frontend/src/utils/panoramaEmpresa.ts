/**
 * Agregación entre obras para el inicio de la gestión de empresa.
 *
 * Hasta acá el sistema sabía decir el estado de UNA obra, y el de la empresa
 * como entidad (sus obligaciones corporativas: el SGSST, el reglamento, el
 * comité de empresa). Lo que no sabía decir es lo que esta pantalla responde:
 * **en qué se parecen las obras entre sí**. Que a una obra le falte el plan de
 * emergencias es un pendiente de esa obra; que le falte a cinco de seis es un
 * problema del procedimiento de la empresa, y se arregla en otro lugar.
 *
 * ── Qué NO se calcula acá ────────────────────────────────────────────────────
 *
 * El cumplimiento del FUF no se recalcula: lo entrega el motor del servidor
 * (`GET /estructura/completitud/resumen`, lib/completitud.js). Es el único
 * lugar donde se decide si un requisito está cumplido, y tiene reglas finas
 * —lo que no aplica sale del denominador— que duplicadas acá divergirían.
 * Este módulo solo suma lo que el motor ya calculó, y lo cruza con el
 * repositorio.
 *
 * Tampoco se lee `obra.cumplimientoDS44`. Está en la base y nadie lo mantiene:
 * en dev reporta cero documentos subidos en obras que tienen diecinueve.
 */

import type { AvanceAmbito, Prescripcion } from '../api/estructura.api';
import type { IncidentStats } from '../api/incidents.api';
import { DS44_DO_PROCEDIMIENTOS, evalAplicabilidad, type Ds44DoContext } from './ds44';

/**
 * Desde cuántas obras una ausencia deja de ser de la obra y pasa a ser de la
 * empresa. Tres es un juicio, no una norma: con menos, dos obras distraídas
 * parecerían un procedimiento roto.
 */
export const UMBRAL_SISTEMICO = 3;

/** Lo mínimo que esta pantalla necesita de una obra. */
export interface ObraEntrada {
    obraId: string;
    nombre: string;
    estado?: string;
    comuna?: string | null;
    mandante?: string | null;
    faseDeming?: string | null;
    dotacionDeclarada?: number | null;
    /** Banderas que vuelven exigible un procedimiento del DS 44. `undefined`
     *  significa que nadie respondió la pregunta, y entonces no se acusa. */
    faenaCompartida?: boolean;
    tieneMaquinaria?: boolean;
    agentesFQB?: boolean;
}

/** Lo mínimo que esta pantalla necesita de un documento. */
export interface DocumentoEntrada {
    documentId: string;
    tipo: string;
    tipoDescripcion?: string;
    titulo?: string;
    obraId?: string | null;
    estado?: string;
    clasificacion?: string;
    archivoUrl?: string | null;
    s3Key?: string | null;
    fechaCaducidad?: string | null;
    firmas?: unknown[];
    asignaciones?: unknown[];
    esReposicion?: boolean;
    motivoReposicion?: string | null;
    itemsEntregados?: Array<{ descripcion?: string; cantidad?: number; talla?: string | null }>;
}

export interface ObraConAvance extends ObraEntrada {
    avance: AvanceAmbito | null;
}

/**
 * Qué tan firme es la afirmación de que algo falta.
 *
 *   exigible  el DS 44 lo exige a esa obra y no está. Sale de la condición del
 *             elemento (`DS44_DO_PROCEDIMIENTOS`) evaluada contra las banderas
 *             de la obra: faena compartida, maquinaria, agentes FQB. Lleva su
 *             artículo, así que se puede afirmar sin matices.
 *   comparada otras obras lo acreditan y esta no. No se sabe si le aplica, así
 *             que es una señal, no un incumplimiento.
 *
 * La distinción va en la pantalla: decirle a alguien que incumple el Art. 20
 * cuando en realidad su obra no comparte sitio destruye la confianza en todo el
 * panel.
 */
export type CertezaBrecha = 'exigible' | 'comparada';

export interface Brecha {
    tipo: string;
    etiqueta: string;
    certeza: CertezaBrecha;
    /** Solo en las exigibles: el artículo del DS 44 que la obliga. */
    articulo?: string;
    /** Obras que lo acreditan, y las que no, en el orden en que se muestran. */
    obrasConEl: string[];
    obrasSinEl: string[];
    faltaEn: number;
    deUnTotalDe: number;
    sistemica: boolean;
}

export interface ItemEpp {
    descripcion: string;
    entregas: number;
    reposiciones: number;
    /** Motivo de reposición → cuántas veces. */
    motivos: Record<string, number>;
    /** Obras donde se entregó. */
    obras: number;
}

export interface PorVencer {
    documentId: string;
    titulo: string;
    tipo: string;
    obraId: string | null;
    fecha: string;
    dias: number;
}

/** Una obra cerrada no se compara: no tiene por qué seguir acreditando nada. */
export const obraActiva = (o: ObraEntrada): boolean => o.estado !== 'cerrada' && o.estado !== 'inactiva';

/** Un documento anulado no acredita, y uno sin obra es corporativo. */
const cuentaParaLaObra = (d: DocumentoEntrada): boolean =>
    d.estado !== 'anulado' && Boolean(d.obraId);

/** Sin archivo no hay documento: es la misma regla que `tieneArchivo` del motor. */
export const tieneRespaldo = (d: DocumentoEntrada): boolean => Boolean(d.archivoUrl || d.s3Key);

/**
 * Cumplimiento consolidado: la SUMA de los ítems, no el promedio de los
 * porcentajes.
 *
 * Promediar porcentajes le da a una oficina de doce personas el mismo peso que
 * a una obra de ciento treinta y cuatro, y el número deja de significar nada.
 * Con la suma, el porcentaje responde la pregunta que de verdad se hace: de
 * todo lo que esta empresa tiene que acreditar, cuánto está acreditado.
 */
export function consolidar(avances: Array<AvanceAmbito | null>): AvanceAmbito {
    let cumplidos = 0;
    let exigibles = 0;
    let excluidos = 0;
    for (const a of avances) {
        if (!a) continue;
        cumplidos += a.cumplidos || 0;
        exigibles += a.exigibles || 0;
        excluidos += a.excluidos || 0;
    }
    return {
        cumplidos,
        exigibles,
        excluidos,
        progreso: exigibles > 0 ? Math.round((cumplidos / exigibles) * 100) : 0,
    };
}

/** El promedio de los porcentajes, solo para poder mostrar la diferencia. */
export function promediarPorcentajes(avances: Array<AvanceAmbito | null>): number {
    const con = avances.filter((a): a is AvanceAmbito => Boolean(a) && (a as AvanceAmbito).exigibles > 0);
    if (!con.length) return 0;
    return Math.round(con.reduce((s, a) => s + a.progreso, 0) / con.length);
}

/**
 * Tipos de documento que unas obras acreditan y otras no, ordenados por cuántas
 * obras les falta.
 *
 * **Límite honesto:** compara las obras entre sí, así que solo ve los tipos que
 * al menos una obra tiene. Un tipo que ninguna obra subió no aparece, porque
 * desde el repositorio no se distingue de uno que a esta empresa no le aplica.
 * Para eso está el panel de completitud del FUF, que sí conoce la lista de lo
 * exigible. La pantalla lo dice en una nota, en vez de insinuar que la lista
 * está completa.
 */
export function calcularBrechas(
    obras: ObraEntrada[],
    documentos: DocumentoEntrada[],
    tamanoEntidad = 0,
): Brecha[] {
    const activas = obras.filter(obraActiva);
    if (!activas.length) return [];
    const idsActivos = new Set(activas.map((o) => o.obraId));

    // Qué obras acreditan cada tipo, con archivo.
    const porTipo = new Map<string, { obras: Set<string>; etiqueta: string }>();
    for (const d of documentos) {
        if (!cuentaParaLaObra(d)) continue;
        if (!tieneRespaldo(d)) continue;
        if (!idsActivos.has(d.obraId as string)) continue;
        const entrada = porTipo.get(d.tipo) || { obras: new Set<string>(), etiqueta: d.tipoDescripcion || d.tipo };
        entrada.obras.add(d.obraId as string);
        porTipo.set(d.tipo, entrada);
    }

    const brechas: Brecha[] = [];
    const yaVisto = new Set<string>();

    // ── 1. Exigibles ────────────────────────────────────────────────────────
    //
    // Se evalúa la condición de cada procedimiento contra las banderas de CADA
    // obra, así que un tipo puede ser exigible en una y no en otra. Acá sí
    // aparece un tipo que NINGUNA obra tiene: saber que es exigible es lo que lo
    // vuelve informativo, y es justo lo que la comparación no podía ver.
    for (const elem of DS44_DO_PROCEDIMIENTOS) {
        if (elem.fuente !== 'documento') continue;
        const conEl = porTipo.get(elem.tipo)?.obras || new Set<string>();
        const sinEl: string[] = [];
        const leAplica: string[] = [];
        for (const o of activas) {
            const ctx: Ds44DoContext = {
                tamanoEntidad,
                faenaCompartida: o.faenaCompartida,
                tieneMaquinaria: o.tieneMaquinaria,
                agentesFQB: o.agentesFQB,
            };
            // 'verificar' (la bandera nunca se respondió) no se cuenta como
            // incumplimiento: no se acusa por un dato que nadie llenó.
            if (evalAplicabilidad(elem.condicion, ctx) !== 'aplica') continue;
            leAplica.push(o.obraId);
            if (!conEl.has(o.obraId)) sinEl.push(o.obraId);
        }
        yaVisto.add(elem.tipo);
        if (!sinEl.length) continue;
        brechas.push({
            tipo: elem.tipo,
            etiqueta: elem.titulo,
            certeza: 'exigible',
            articulo: elem.articulo,
            obrasConEl: leAplica.filter((id) => conEl.has(id)),
            obrasSinEl: sinEl,
            faltaEn: sinEl.length,
            deUnTotalDe: leAplica.length,
            sistemica: sinEl.length >= UMBRAL_SISTEMICO,
        });
    }

    // ── 2. Comparadas ───────────────────────────────────────────────────────
    //
    // El resto del repositorio, donde no hay condición que evaluar. Necesita al
    // menos dos obras: con una sola no hay con qué comparar.
    if (activas.length >= 2) {
        for (const [tipo, { obras: conEl, etiqueta }] of porTipo) {
            if (yaVisto.has(tipo)) continue;
            const sinEl = activas.filter((o) => !conEl.has(o.obraId)).map((o) => o.obraId);
            if (!sinEl.length) continue;
            brechas.push({
                tipo,
                etiqueta,
                certeza: 'comparada',
                obrasConEl: activas.filter((o) => conEl.has(o.obraId)).map((o) => o.obraId),
                obrasSinEl: sinEl,
                faltaEn: sinEl.length,
                deUnTotalDe: activas.length,
                sistemica: sinEl.length >= UMBRAL_SISTEMICO,
            });
        }
    }

    // Lo exigible primero, porque se puede afirmar; dentro de cada grupo, lo que
    // falta en más obras. A igual cantidad, por nombre, para que el orden no
    // baile entre cargas.
    const peso = (b: Brecha) => (b.certeza === 'exigible' ? 0 : 1);
    return brechas.sort((a, b) =>
        peso(a) - peso(b) || b.faltaEn - a.faltaEn || a.etiqueta.localeCompare(b.etiqueta, 'es'));
}

/**
 * Consumo de EPP por elemento. Lo que importa no es cuánto se entrega sino
 * cuánto se REPONE y por qué: un elemento que se repone por desgaste apunta al
 * proveedor o al uso, y eso se corrige comprando distinto.
 */
export function resumenEpp(documentos: DocumentoEntrada[]): ItemEpp[] {
    const porItem = new Map<string, ItemEpp & { obrasSet: Set<string> }>();
    for (const d of documentos) {
        if (d.tipo !== 'ENTREGA_EPP' || d.estado === 'anulado') continue;
        for (const item of d.itemsEntregados || []) {
            const descripcion = String(item?.descripcion || '').trim();
            // Una entrega sin descripción no dice qué se entregó: no se inventa
            // un nombre, se deja fuera del resumen.
            if (!descripcion) continue;
            const r = porItem.get(descripcion) || {
                descripcion, entregas: 0, reposiciones: 0, motivos: {}, obras: 0, obrasSet: new Set<string>(),
            };
            r.entregas += 1;
            if (d.esReposicion) {
                r.reposiciones += 1;
                const motivo = d.motivoReposicion || 'otro';
                r.motivos[motivo] = (r.motivos[motivo] || 0) + 1;
            }
            if (d.obraId) r.obrasSet.add(d.obraId);
            porItem.set(descripcion, r);
        }
    }
    return [...porItem.values()]
        .map(({ obrasSet, ...r }) => ({ ...r, obras: obrasSet.size }))
        .sort((a, b) => b.reposiciones - a.reposiciones || b.entregas - a.entregas);
}

/** El motivo de reposición que más pesa en un elemento, con su porcentaje. */
export function motivoDominante(item: ItemEpp): { motivo: string; porcentaje: number } | null {
    const entradas = Object.entries(item.motivos);
    if (!entradas.length || !item.reposiciones) return null;
    const [motivo, veces] = entradas.sort((a, b) => b[1] - a[1])[0];
    return { motivo, porcentaje: Math.round((veces / item.reposiciones) * 100) };
}

/** Documentos con caducidad dentro de los próximos `dias`, los vencidos primero. */
export function calcularPorVencer(
    documentos: DocumentoEntrada[],
    dias = 90,
    hoy: Date = new Date(),
): PorVencer[] {
    const limite = hoy.getTime() + dias * 86_400_000;
    const salida: PorVencer[] = [];
    for (const d of documentos) {
        if (d.estado === 'anulado' || !d.fechaCaducidad) continue;
        const t = Date.parse(d.fechaCaducidad);
        if (Number.isNaN(t) || t > limite) continue;
        salida.push({
            documentId: d.documentId,
            titulo: d.titulo || d.tipoDescripcion || d.tipo,
            tipo: d.tipo,
            obraId: d.obraId || null,
            fecha: d.fechaCaducidad,
            dias: Math.ceil((t - hoy.getTime()) / 86_400_000),
        });
    }
    return salida.sort((a, b) => a.dias - b.dias);
}

export interface TotalesRepositorio {
    documentos: number;
    sinRespaldo: number;
    firmasPendientes: number;
}

/**
 * Dos señales del repositorio que se leen de un vistazo:
 *
 *   sinRespaldo      el documento existe en el sistema pero no tiene archivo.
 *                    Ante un fiscalizador eso no acredita nada.
 *   firmasPendientes está asignado a personas y nadie firmó todavía.
 */
export function calcularTotales(documentos: DocumentoEntrada[]): TotalesRepositorio {
    let sinRespaldo = 0;
    let firmasPendientes = 0;
    let total = 0;
    for (const d of documentos) {
        if (d.estado === 'anulado') continue;
        total += 1;
        if (!tieneRespaldo(d)) sinRespaldo += 1;
        if ((d.asignaciones?.length || 0) > 0 && (d.firmas?.length || 0) === 0) firmasPendientes += 1;
    }
    return { documentos: total, sinRespaldo, firmasPendientes };
}

/** Obras bajo el umbral, para decir cuántas necesitan atención sin listarlas. */
export function obrasBajo(obras: ObraConAvance[], umbral = 50): number {
    return obras.filter((o) => o.avance && o.avance.exigibles > 0 && o.avance.progreso < umbral).length;
}

/* ─── Siniestralidad (Arts. 73-75) ───────────────────────────────────────────── */

/**
 * Consolida los indicadores de varias obras.
 *
 * **Las tasas no se suman ni se promedian: se recalculan sobre los totales.**
 * Es el mismo error que promediar porcentajes de cumplimiento, y acá se paga más
 * caro, porque la siniestralidad determina la cotización adicional del seguro de
 * la Ley 16.744: un número inflado o diluido tiene consecuencia en plata.
 *
 * Las fórmulas son las del servidor (`RegistroService.calcularIndicadores`), que
 * las documenta como estándar y con la periodicidad pendiente de confirmar con
 * la fiscalización:
 *
 *   tasa de frecuencia      = (accidentes / horas trabajadas) * 1.000.000
 *   tasa de accidentabilidad = (accidentes / masa laboral) * 100
 *   siniestralidad           = (días perdidos / masa laboral) * 100
 *   horas trabajadas         = masa laboral * 8 h * 22 días
 */
export function consolidarSiniestralidad(porObra: Array<IncidentStats | null>): IncidentStats {
    let masaLaboral = 0;
    let numeroAccidentes = 0;
    let diasPerdidos = 0;
    const porTipo = { accidentes: 0, incidentes: 0, condicionesSubestandar: 0 };
    const porGravedad = { leve: 0, grave: 0, fatal: 0 };
    let totalIncidentes = 0;

    for (const s of porObra) {
        if (!s) continue;
        masaLaboral += s.masaLaboral || 0;
        numeroAccidentes += s.numeroAccidentes || 0;
        diasPerdidos += s.diasPerdidos || 0;
        porTipo.accidentes += s.porTipo?.accidentes || 0;
        porTipo.incidentes += s.porTipo?.incidentes || 0;
        porTipo.condicionesSubestandar += s.porTipo?.condicionesSubestandar || 0;
        porGravedad.leve += s.porGravedad?.leve || 0;
        porGravedad.grave += s.porGravedad?.grave || 0;
        porGravedad.fatal += s.porGravedad?.fatal || 0;
        totalIncidentes += s.totalIncidentes || 0;
    }

    const horasTrabajadas = masaLaboral * 8 * 22;
    const dos = (n: number) => Math.round(n * 100) / 100;

    return {
        mes: porObra.find((s) => s?.mes)?.mes || '',
        masaLaboral,
        numeroAccidentes,
        diasPerdidos,
        tasaFrecuencia: horasTrabajadas > 0 ? dos((numeroAccidentes / horasTrabajadas) * 1_000_000) : 0,
        tasaAccidentabilidad: masaLaboral > 0 ? dos((numeroAccidentes / masaLaboral) * 100) : 0,
        siniestralidad: masaLaboral > 0 ? dos((diasPerdidos / masaLaboral) * 100) : 0,
        porTipo,
        porGravedad,
        totalIncidentes,
    };
}

export interface ObraEnRiesgo {
    obraId: string;
    nombre: string;
    progreso: number | null;
    accidentes: number;
    diasPerdidos: number;
    fatales: number;
}

/**
 * Obras donde el papeleo no está evitando accidentes.
 *
 * Es el cruce que no pide el ticket y que creo que vale más que los dos datos
 * por separado: una obra con 95% de cumplimiento y tres accidentes es más
 * urgente que una con 60% y ninguno. Si una obra tiene todo firmado y sigue
 * lesionando gente, el problema no es documental, y el panel tiene que poder
 * decirlo en vez de premiarla por su carpeta.
 *
 * Solo entran las obras CON accidentes: sin ellos no hay nada que contrastar.
 * Se ordenan por gravedad —fatales, después días perdidos— y a igualdad, por
 * cumplimiento más alto, que es el caso más llamativo.
 */
export function obrasEnRiesgo(
    obras: ObraConAvance[],
    statsPorObra: Record<string, IncidentStats>,
): ObraEnRiesgo[] {
    return obras
        .map((o) => {
            const s = statsPorObra[o.obraId];
            return {
                obraId: o.obraId,
                nombre: o.nombre,
                progreso: o.avance?.progreso ?? null,
                accidentes: s?.numeroAccidentes || 0,
                diasPerdidos: s?.diasPerdidos || 0,
                fatales: s?.porGravedad?.fatal || 0,
            };
        })
        .filter((o) => o.accidentes > 0)
        .sort((a, b) =>
            b.fatales - a.fatales
            || b.diasPerdidos - a.diasPerdidos
            || (b.progreso ?? 0) - (a.progreso ?? 0));
}

/* ─── Prescripciones (Art. 70) ───────────────────────────────────────────────── */

export interface ResumenPrescripciones {
    total: number;
    vencidas: Prescripcion[];
    pendientes: number;
    implementadas: number;
    /** Obras con al menos una vencida. */
    obrasAfectadas: number;
}

/**
 * Medidas prescritas y su cumplimiento.
 *
 * El `estado` lo deriva el servidor del plazo, así que acá no se recalcula: una
 * `Vencida` es una medida con plazo cumplido y sin implementar. De todo lo que
 * muestra el panel, esto es lo de consecuencia más inmediata — una medida
 * prescrita por un fiscalizador y no implementada es exposición directa a
 * sanción, no una brecha documental.
 */
export function resumenPrescripciones(prescripciones: Prescripcion[]): ResumenPrescripciones {
    const vencidas = prescripciones.filter((p) => p.estado === 'Vencida');
    const obras = new Set(vencidas.map((p) => p.obraId).filter(Boolean) as string[]);
    return {
        total: prescripciones.length,
        vencidas: [...vencidas].sort((a, b) =>
            String(a.plazoImplementacion || '').localeCompare(String(b.plazoImplementacion || ''))),
        pendientes: prescripciones.filter((p) => p.estado === 'Pendiente').length,
        implementadas: prescripciones.filter((p) => p.estado === 'Implementada').length,
        obrasAfectadas: obras.size,
    };
}

/** Días desde que se cumplió el plazo. Negativo si todavía no vence. */
export function diasDeAtraso(p: Prescripcion, hoy: Date = new Date()): number | null {
    if (!p.plazoImplementacion) return null;
    const t = Date.parse(p.plazoImplementacion);
    if (Number.isNaN(t)) return null;
    return Math.floor((hoy.getTime() - t) / 86_400_000);
}
