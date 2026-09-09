/**
 * Cumplimiento por fase del ciclo Deming, con las reglas del motor.
 *
 * Antes cada fase se contaba a mano dentro de ObraDetalle: PLAN como
 * `subidos/total`, HACER con su propio porcentaje, y VERIFICAR y ACTUAR como
 * booleanos. Tres formas distintas de contar lo mismo, y ninguna sabía excluir
 * del denominador lo que no aplica a la obra.
 *
 * Acá cada elemento de las fases se expresa como un requisito con los seis
 * estados de `completitud.ts`, de modo que:
 *   - lo que no aplica a la obra sale del denominador en vez de penalizar;
 *   - un documento cargado sin firmar cuenta medio, no cero ni uno;
 *   - el porcentaje que se muestra bajo "Fase X" mide efectivamente la fase X.
 *
 * NO reemplaza al motor del servidor: aquél evalúa los requisitos del FUF, que
 * necesitan el repositorio completo. Éste mide el avance operativo por fase con
 * los datos que la pantalla ya tiene. Ambos usan las MISMAS reglas de conteo.
 */

import {
    ESTADO_REQUISITO, estadoPorDocumento, resumirCompletitud,
    type EstadoRequisito, type ResumenCompletitud,
} from './completitud';
import {
    DS44_ACT_DOCS, DS44_CHECK_DOCS, DS44_DO_CAPACITACIONES, DS44_DO_PROCEDIMIENTOS,
    evalAplicabilidad, type Ds44DoContext, type Ds44DocDefinition,
} from './ds44';

export type FaseDeming = 'plan' | 'hacer' | 'verificar' | 'actuar';

export interface RequisitoFase {
    key: string;
    titulo: string;
    estado: EstadoRequisito;
    detalle: string;
}

export interface CompletitudFase {
    fase: FaseDeming;
    requisitos: RequisitoFase[];
    resumen: ResumenCompletitud;
    /** Etiqueta de la unidad contada, para que el subtítulo no mienta. */
    unidad: string;
}

const NO_APLICA = (titulo: string, motivo: string): RequisitoFase => ({
    key: titulo, titulo, estado: ESTADO_REQUISITO.NO_APLICA, detalle: motivo,
});

/**
 * PLAN: documentos base de la obra. Los corporativos (Política, Reglamento) se
 * gestionan a nivel empresa y la obra solo refleja su estado; igual cuentan,
 * porque sin ellos la obra no está en regla.
 */
function requisitosPlan(docsPlan: Array<Ds44DocDefinition & {
    archivoSubido?: boolean; document?: any; tenantLevel?: boolean; fromEmpresa?: boolean;
}>, ahora: Date): RequisitoFase[] {
    return docsPlan.map((d) => {
        if (d.tenantLevel) {
            return {
                key: d.key, titulo: d.titulo,
                estado: d.fromEmpresa ? ESTADO_REQUISITO.CUMPLIDO : ESTADO_REQUISITO.PENDIENTE,
                detalle: d.fromEmpresa
                    ? 'Documento de empresa cargado.'
                    : 'Se gestiona en Onboarding y aún no está cargado.',
            };
        }
        // El gating por firma solo aplica si el documento tiene firmantes: un
        // documento sin asignaciones está cargado, no "pendiente de firma".
        const r = estadoPorDocumento(d.document, { exigeFirma: true, ahora });
        return { key: d.key, titulo: d.titulo, estado: r.estado, detalle: r.detalle };
    });
}

/**
 * HACER: procedimientos aplicables + capacitaciones aplicables + el registro
 * maestro del Art. 72. Lo que la obra declara que no aplica (sin maquinaria, sin
 * agentes, sin faena compartida) sale del denominador con su motivo.
 */
function requisitosHacer(
    procedimientos: Array<{ el: any; aplicabilidad: string; estado: string }>,
    capacitaciones: Array<{ el: any; aplicabilidad: string; estado: string }>,
    registroMaestroGenerado: boolean,
    ctx: Ds44DoContext,
): RequisitoFase[] {
    const deElemento = (
        { el, aplicabilidad, estado }: { el: any; aplicabilidad: string; estado: string },
        unidad: 'procedimiento' | 'capacitación',
    ): RequisitoFase => {
        if (!el.cuenta) {
            return NO_APLICA(el.titulo, 'No incide en el cumplimiento de la obra.');
        }
        if (aplicabilidad === 'no_aplica') {
            return NO_APLICA(el.titulo, motivoNoAplica(el.condicion, ctx));
        }
        if (aplicabilidad === 'verificar') {
            return {
                key: el.key, titulo: el.titulo, estado: ESTADO_REQUISITO.PENDIENTE,
                detalle: 'Falta confirmar si aplica a esta obra.',
            };
        }
        const mapa: Record<string, EstadoRequisito> = {
            completo: ESTADO_REQUISITO.CUMPLIDO,
            pendiente_firma: ESTADO_REQUISITO.PARCIAL,
            faltante: ESTADO_REQUISITO.PENDIENTE,
        };
        return {
            key: el.key, titulo: el.titulo,
            estado: mapa[estado] || ESTADO_REQUISITO.PENDIENTE,
            detalle: estado === 'pendiente_firma'
                ? `El ${unidad} está registrado, faltan firmas.`
                : estado === 'completo' ? 'Completo.' : `Falta el ${unidad}.`,
        };
    };

    return [
        ...procedimientos.map((p) => deElemento(p, 'procedimiento')),
        ...capacitaciones.map((c) => deElemento(c, 'capacitación')),
        {
            key: 'REGISTRO_ACTIVIDAD',
            titulo: 'Registro de Actividad Preventiva (Art. 72)',
            estado: registroMaestroGenerado ? ESTADO_REQUISITO.CUMPLIDO : ESTADO_REQUISITO.PENDIENTE,
            detalle: registroMaestroGenerado ? 'Registro generado y firmado.' : 'Aún no se ha generado.',
        },
    ];
}

/** Por qué un elemento no aplica, en los términos de la obra y no del código. */
function motivoNoAplica(condicion: string, ctx: Ds44DoContext): string {
    switch (condicion) {
        case 'tiene_maquinaria': return 'La obra declara que no hay máquinas ni herramientas motrices.';
        case 'agentes_fqb': return 'La obra declara que no se manipulan agentes físicos, químicos ni biológicos.';
        case 'faena_compartida': return 'La obra declara que no es faena compartida.';
        case 'cphs': return `No exigible con ${ctx.tamanoEntidad} persona(s) trabajadora(s).`;
        case 'delegado': return `No exigible con ${ctx.tamanoEntidad} persona(s) trabajadora(s).`;
        case 'encargado_oa': return `No exigible con ${ctx.tamanoEntidad} persona(s) trabajadora(s).`;
        case 'depto_prevencion': return `No exigible con ${ctx.tamanoEntidad} persona(s) trabajadora(s).`;
        default: return 'No exigible a esta obra.';
    }
}

/** VERIFICAR y ACTUAR: documentos con condicional por dotación. */
function requisitosDocsFase(
    definiciones: typeof DS44_CHECK_DOCS,
    obraDocs: any[],
    dotacion: number,
    ahora: Date,
): RequisitoFase[] {
    return definiciones.map((d) => {
        if (d.condicional === 'mas_100_trabajadores' && dotacion <= 100) {
            return NO_APLICA(d.titulo, `Solo exigible sobre 100 personas trabajadoras; la dotación es ${dotacion}.`);
        }
        if (!d.obligatorio) {
            const existe = obraDocs.some((od) => od.tipo === d.tipo);
            return existe
                ? { key: d.key, titulo: d.titulo, estado: ESTADO_REQUISITO.CUMPLIDO, detalle: 'Registrado.' }
                : NO_APLICA(d.titulo, 'Opcional: no incide en el cumplimiento.');
        }
        const doc = obraDocs.find((od) => od.tipo === d.tipo);
        const r = estadoPorDocumento(doc, { exigeFirma: false, ahora });
        return { key: d.key, titulo: d.titulo, estado: r.estado, detalle: r.detalle };
    });
}

export interface EntradaCompletitudObra {
    fase: FaseDeming;
    docsPlan: any[];
    procedimientos: Array<{ el: any; aplicabilidad: string; estado: string }>;
    capacitaciones: Array<{ el: any; aplicabilidad: string; estado: string }>;
    registroMaestroGenerado: boolean;
    obraDocs: any[];
    dotacion: number;
    ctx: Ds44DoContext;
    ahora?: Date;
}

/** Completitud de la fase seleccionada, con las reglas del motor. */
export function completitudDeFase(e: EntradaCompletitudObra): CompletitudFase {
    const ahora = e.ahora || new Date();
    let requisitos: RequisitoFase[];
    let unidad: string;

    switch (e.fase) {
        case 'hacer':
            requisitos = requisitosHacer(e.procedimientos, e.capacitaciones, e.registroMaestroGenerado, e.ctx);
            unidad = 'elementos';
            break;
        case 'verificar':
            requisitos = requisitosDocsFase(DS44_CHECK_DOCS, e.obraDocs, e.dotacion, ahora);
            unidad = 'documentos';
            break;
        case 'actuar':
            requisitos = requisitosDocsFase(DS44_ACT_DOCS, e.obraDocs, e.dotacion, ahora);
            unidad = 'documentos';
            break;
        case 'plan':
        default:
            requisitos = requisitosPlan(e.docsPlan, ahora);
            unidad = 'documentos';
            break;
    }

    return { fase: e.fase, requisitos, resumen: resumirCompletitud(requisitos), unidad };
}

/** Referencias exportadas para que el llamador no tenga que reimportar catálogos. */
export { DS44_DO_PROCEDIMIENTOS, DS44_DO_CAPACITACIONES, evalAplicabilidad };
