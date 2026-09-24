/**
 * Onboarding DS 44 de una obra: estado de cada ítem del kit de cargo, por persona.
 *
 * Vivía dentro de ObraDetalle, pero el seguimiento del onboarding dejó de ser
 * una pestaña del detalle para pasar al equipo de la obra (Personas en ámbito
 * obra). Las dos pantallas necesitan exactamente el mismo read-model —el detalle
 * para el porcentaje que alimenta el resumen y la fase, el equipo para el
 * checklist accionable—, así que el cálculo es una función pura y cada pantalla
 * le pasa los datos que ya tiene cargados. Duplicarlo habría dejado dos
 * definiciones de "completo" que se desincronizan en silencio.
 */
import { resolveCargoKit, normalizeCargoCodigo, unionKits, getCargoLabel } from './ds44';

// Roles de gestión/staff que NO entran al onboarding de terreno (espejo del backend).
const ROLES_GESTION_ONBOARDING = new Set(['admin', 'jefe_obra', 'supervisor', 'prevencionista', 'relator']);

export const esRolGestion = (rol?: string): boolean => {
    const n = String(rol || '').toLowerCase().trim().replace(/\s+/g, '_');
    const canon = n === 'administrador' ? 'admin' : (n === 'jefe_de_obra' ? 'jefe_obra' : (n === 'colaborador' ? 'trabajador' : n));
    return ROLES_GESTION_ONBOARDING.has(canon);
};

export type OnboardingEstado = 'pendiente_asignar' | 'pendiente_firma' | 'completo';

export interface OnboardingItem {
    key: string;
    tipo: string;
    label: string;
    articulo: string;
    done: boolean;
    estado: OnboardingEstado;
    firmaRelatorPendiente: boolean;
    trabajadorFirmo: boolean;
    documentId: string | null;
    kind: 'document';
    /** Naturaleza del ítem: define el atajo (firmar doc, agendar capacitación, asignar encuesta). */
    accion: string;
    subtipo: string | null;
    bloqueante: boolean;
}

export interface OnboardingWorker {
    workerId: string;
    rut: string;
    nombre: string;
    cargo: string;
    fechaIngreso: string | null;
    completed: number;
    total: number;
    bloqueantesPendientes: number;
    aptoTerreno: boolean;
    itemDetail: OnboardingItem[];
}

export interface OnboardingSummary {
    completed: number;
    total: number;
    progress: number;
    byWorker: OnboardingWorker[];
}

export interface OnboardingInput {
    /** Personas asignadas a la obra (las inactivas se descartan aquí). */
    trabajadores: any[];
    /** Documentos que acreditan ítems del kit (clasificación 'diario' + 'empresa'). */
    documentosPrevencion: any[];
    obraSignatureRequests: any[];
    actividades: any[];
    encuestas: any[];
    obraId: string | null | undefined;
    cargoCatalog: any[];
    /** `obra.aplicabilidadKit`: ítems marcados 'no_aplica' por cargo según MIPER. */
    aplicabilidadKit?: Record<string, Record<string, string>>;
}

export function computeOnboardingSummary(input: OnboardingInput): OnboardingSummary {
    const {
        trabajadores, documentosPrevencion, obraSignatureRequests,
        actividades, encuestas, obraId, cargoCatalog,
    } = input;

    const activeWorkers = trabajadores.filter((worker) => worker.estado !== 'inactivo');
    if (!activeWorkers.length) {
        return { completed: 0, total: 0, progress: 0, byWorker: [] };
    }

    // Flujo secuencial por (persona, tipo): sin archivo (pendiente_asignar => Subir)
    // -> con archivo sin firmar (pendiente_firma => Firma asistida) -> firmado (completo).
    // "Completo" SOLO con firma real del trabajador. Si el documento exige firma
    // cruzada (CAPACITACION_SST), tambien debe estar firmado por el relator.
    const docSigned = new Map<string, boolean>();
    const docHasFile = new Map<string, boolean>();
    const docRelatorPendiente = new Map<string, boolean>();
    const docIdPorKey = new Map<string, string>();
    documentosPrevencion.forEach((doc) => {
        const hasFile = Boolean(doc.s3Key || doc.archivoUrl);
        const relatorPendiente = Boolean(doc.requiereFirmaRelator) && doc.firmaRelator?.estado !== 'firmado';
        (doc.asignaciones || []).forEach((asig: any) => {
            const personaId = asig.personaId;
            if (!personaId || !doc.tipo) return;
            const key = `${personaId}:${doc.tipo}`;
            if (!docIdPorKey.has(key)) docIdPorKey.set(key, doc.documentId);
            if (hasFile) docHasFile.set(key, true);
            if (relatorPendiente) docRelatorPendiente.set(key, true);
            if (asig.estado === 'firmado' || asig.fechaFirma) docSigned.set(key, true);
        });
    });

    const requestSigned = new Map<string, boolean>();
    const requestAssigned = new Map<string, boolean>();
    obraSignatureRequests.forEach((request: any) => {
        (request.trabajadores || []).forEach((trabajador: any) => {
            const workerId = trabajador.workerId;
            if (!workerId || !request.tipo) return;
            const key = `${workerId}:${request.tipo}`;
            requestAssigned.set(key, true);
            if (trabajador.firmado) requestSigned.set(key, true);
        });
    });

    // TRAZABILIDAD: ítems de onboarding cumplidos vía actividad o encuesta VINCULADA
    // (kitItemKey). Asistir a la actividad / responder la encuesta cierra el ítem.
    const kitDoneByLink = new Map<string, boolean>(); // `${personaId}:${kitItemKey}`
    const kitAssignedByLink = new Map<string, boolean>();
    actividades.forEach((act: any) => {
        if (!act.kitItemKey) return;
        (act.asistentesRequeridos || []).forEach((pid: string) => kitAssignedByLink.set(`${pid}:${act.kitItemKey}`, true));
        (act.asistentes || []).forEach((a: any) => {
            const pid = a.personaId || a.workerId;
            if (pid) kitDoneByLink.set(`${pid}:${act.kitItemKey}`, true);
        });
    });
    encuestas.forEach((survey: any) => {
        if (!survey.kitItemKey) return;
        (survey.recipients || []).forEach((r: any) => {
            const pid = r.personaId || r.workerId;
            if (!pid) return;
            kitAssignedByLink.set(`${pid}:${survey.kitItemKey}`, true);
            if (r.estado === 'respondida') kitDoneByLink.set(`${pid}:${survey.kitItemKey}`, true);
        });
    });

    let total = 0;
    let completed = 0;

    // Kit por código de cargo: del catálogo del tenant (con plantillas) y, si no,
    // de la semilla. El onboarding se rige por el KIT del cargo, no por una lista
    // fija. Cada ítem se cierra con firma real (cruzada si aplica).
    const kitDeCargo = (codigo?: string): any[] => {
        if (!codigo) return [];
        const fromCatalog = cargoCatalog.find((c: any) => c.codigo === codigo)?.kit;
        return (fromCatalog && fromCatalog.length ? fromCatalog : resolveCargoKit(codigo)) as any[];
    };

    // Cargos que el trabajador ejecuta EN esta obra (asignación, multi-cargo).
    // Fallback al cargo legacy global por compatibilidad con personas sin migrar.
    const cargosEnObra = (worker: any): string[] => {
        const asig = (worker.asignaciones || []).find((a: any) => a.obraId === (obraId || ''));
        const raw = (asig && Array.isArray(asig.cargos) && asig.cargos.length)
            ? asig.cargos
            : (worker.cargo ? [worker.cargo] : []);
        // Normaliza a CÓDIGO de catálogo ("Carpintero" → CARPINTERO) para resolver el
        // kit real, igual que el backend. Dedup.
        return [...new Set(raw.map((c: string) => normalizeCargoCodigo(c)).filter(Boolean))] as string[];
    };
    const aplicabilidad = input.aplicabilidadKit || {};

    const byWorker = activeWorkers.map((worker) => {
        const workerId = worker.personaId;
        // Roles de gestión/staff no entran al onboarding de terreno (coherente con el
        // backend, que no genera sus documentos). Evita el ruido "admin 0/6".
        if (esRolGestion(worker.rol)) return null;
        const cargos = cargosEnObra(worker);
        // Unión de kits de todos los cargos de la persona en la obra (dedup + estricto).
        let kit: any[] = unionKits(cargos.map((c) => ({ cargo: c, kit: kitDeCargo(c) })));
        // Aplicabilidad MIPER (manual): excluir ítems marcados 'no_aplica' para TODOS
        // sus cargos de origen en esta obra (PR-PO excluidos según MIPER).
        kit = kit.filter((it: any) => !(it.cargosOrigen || []).every((cg: string) => aplicabilidad?.[cg]?.[it.key] === 'no_aplica'));
        // Sin cargo/kit (personal de oficina/gestión) → no entra al onboarding de terreno.
        if (!kit.length) return null;
        let workerTotal = 0;
        let workerCompleted = 0;
        const obraKey = obraId || '';
        const manualOverrides = obraKey ? (worker as any).onboardingDS44?.[obraKey]?.items || {} : {};

        const itemDetail: OnboardingItem[] = kit.map((item: any) => {
            const manualDone = Boolean(manualOverrides[item.tipo]);
            const key = `${workerId}:${item.tipo}`;
            const linkKey = `${workerId}:${item.key}`;
            // Señal unificada: documento del onboarding (incl. ENTREGA_EPP), solicitud de
            // firma del mismo tipo, o actividad/encuesta VINCULADA (kitItemKey) cumplida.
            const cumplidoPorLink = Boolean(kitDoneByLink.get(linkKey));
            const trabajadorFirmo = Boolean(docSigned.get(key)) || Boolean(requestSigned.get(key)) || cumplidoPorLink;
            const firmaRelatorPendiente = Boolean(docRelatorPendiente.get(key)) && !cumplidoPorLink;
            const tieneArchivoOAsignado = Boolean(docHasFile.get(key)) || Boolean(requestAssigned.get(key)) || Boolean(kitAssignedByLink.get(linkKey));

            let estado: OnboardingEstado = 'pendiente_asignar';
            if (trabajadorFirmo && !firmaRelatorPendiente) estado = 'completo';
            else if (trabajadorFirmo || tieneArchivoOAsignado) estado = 'pendiente_firma';
            if (manualDone) estado = 'completo';

            const done = estado === 'completo';
            workerTotal += 1;
            if (done) workerCompleted += 1;

            return {
                key: item.key, tipo: item.tipo, label: item.titulo, articulo: item.articulo || '',
                done, estado, firmaRelatorPendiente, trabajadorFirmo,
                documentId: docIdPorKey.get(key) || null,
                kind: 'document' as const,
                accion: item.accion || 'DIFUSION_FIRMA',
                subtipo: item.subtipo || null,
                bloqueante: Boolean(item.bloqueante),
            };
        });

        total += workerTotal;
        completed += workerCompleted;

        // "Apto para ingresar a terreno": todos los ítems bloqueantes completos.
        const bloqueantesPendientes = itemDetail.filter((i) => i.bloqueante && !i.done).length;

        return {
            workerId,
            rut: worker.rut,
            nombre: `${worker.nombre} ${worker.apellido || ''}`.trim(),
            cargo: cargos.length ? cargos.map((c) => getCargoLabel(c)).join(', ') : (worker.cargo || ''),
            fechaIngreso: (worker.obraIds || []).length > 0 ? (worker.createdAt || null) : null,
            completed: workerCompleted,
            total: workerTotal,
            bloqueantesPendientes,
            aptoTerreno: bloqueantesPendientes === 0,
            itemDetail,
        };
    }).filter(Boolean) as OnboardingWorker[];

    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, total, progress, byWorker };
}
