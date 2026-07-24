import type { Activity, Worker, CatalogosActividad, PermisosTrabajoDef } from '../api/client';

// Etiquetas de respaldo de los permisos de trabajo, para que el acta impresa
// nunca muestre el código crudo si no se cargó la definición del backend.
const PERMISO_TIPO_LABEL: Record<string, string> = {
    ALTURA: 'Trabajo en altura',
    ESPACIO_CONFINADO: 'Espacio confinado',
    TRABAJO_CALIENTE: 'Trabajo en caliente',
};

export interface FilaAsistencia {
    personaId: string;
    nombre: string;
    cargo: string;
    asistio: boolean;
    hora: string | null;
    convocado: boolean;
}

/**
 * Cruza asistentesRequeridos × asistentes: cada requerido sale Sí/No; quien
 * firmó sin estar convocado aparece igual (asistió = sí, convocado = false).
 * Los asistentes guardan personaId (o workerId legacy).
 */
export function construirFilasAsistencia(activity: Activity, workers: Worker[]) {
    const firmadoPor = new Map<string, { hora: string | null; nombre: string; cargo: string }>();
    for (const a of activity.asistentes || []) {
        const id = (a as any).personaId || a.workerId;
        if (id) firmadoPor.set(id, { hora: a.firma?.horario || null, nombre: a.nombre, cargo: a.cargo || '' });
    }

    const filas: FilaAsistencia[] = [];
    const requeridosIds = activity.asistentesRequeridos || [];
    for (const id of requeridosIds) {
        const w = workers.find((x) => x.personaId === id);
        const firma = firmadoPor.get(id);
        filas.push({
            personaId: id,
            nombre: firma?.nombre || (w ? `${w.nombre} ${w.apellido || ''}`.trim() : id),
            cargo: firma?.cargo || w?.cargo || '',
            asistio: !!firma,
            hora: firma?.hora || null,
            convocado: true,
        });
    }
    for (const [id, firma] of firmadoPor) {
        if (requeridosIds.includes(id)) continue;
        filas.push({ personaId: id, nombre: firma.nombre, cargo: firma.cargo, asistio: true, hora: firma.hora, convocado: false });
    }

    const requeridos = requeridosIds.length;
    const asistieron = filas.filter((f) => f.asistio).length;
    const porcentaje = requeridos > 0
        ? Math.round((filas.filter((f) => f.convocado && f.asistio).length / requeridos) * 100)
        : (asistieron > 0 ? 100 : 0);
    return { filas, requeridos, asistieron, porcentaje };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const labelDe = (items: { codigo: string; label: string }[], codigo: string) =>
    items.find((i) => i.codigo === codigo)?.label || codigo;

const listaSeleccion = (sel: { codigos?: string[]; otro?: string | null } | null | undefined, items: { codigo: string; label: string }[]) => {
    const parts = (sel?.codigos || []).map((c) => labelDe(items, c));
    if (sel?.otro) parts.push(`Otro: ${sel.otro}`);
    return parts;
};

/**
 * Abre una ventana con el acta post-charla completa y lanza el diálogo de
 * impresión (el usuario la guarda como PDF desde el navegador).
 */
export function abrirReporteImpresion(
    activity: Activity,
    filas: ReturnType<typeof construirFilasAsistencia>,
    catalogos: CatalogosActividad | null,
    permisosDef: PermisosTrabajoDef,
) {
    const p = activity.planificacion;
    const seccionCatalogo = (titulo: string, valores: string[]) => valores.length
        ? `<h3>${esc(titulo)}</h3><ul>${valores.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : '';

    const clima: Record<string, string> = { despejado: 'Despejado', parcial: 'Parcialmente nublado', nublado: 'Nublado', lluvia: 'Lluvia' };

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Reporte — ${esc(activity.titulo)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 32px; color: #111; }
  h1 { font-size: 20px; margin-bottom: 2px; } h2 { font-size: 15px; margin: 18px 0 6px; }
  h3 { font-size: 13px; margin: 12px 0 4px; } .muted { color: #555; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; margin-top: 6px; font-size: 13px; }
  th, td { border: 1px solid #bbb; padding: 5px 8px; text-align: left; }
  th { background: #f0f0f0; } ul { margin: 4px 0; padding-left: 20px; font-size: 13px; }
  .si { color: #15803d; font-weight: 700; } .no { color: #b91c1c; font-weight: 700; }
  .pie { margin-top: 28px; font-size: 11px; color: #777; }
  @media print { body { margin: 12mm; } }
</style></head><body>
<h1>Reporte de actividad — ${esc(activity.titulo)}</h1>
<div class="muted">${esc(activity.tipoDescripcion || activity.tipo)} · ${esc(activity.fecha)} · ${esc(activity.horaInicio)}${activity.horaFin ? ' – ' + esc(activity.horaFin) : ''}${activity.ubicacion ? ' · ' + esc(activity.ubicacion) : ''}</div>

<h2>Asistencia</h2>
<div>Convocados: <b>${filas.requeridos}</b> · Participantes: <b>${filas.asistieron}</b> · Asistencia: <b>${filas.requeridos > 0 ? filas.porcentaje + '%' : '—'}</b></div>
<table><thead><tr><th>Nombre</th><th>Cargo</th><th>Asistió</th><th>Hora firma</th></tr></thead><tbody>
${filas.filas.map((f) => `<tr><td>${esc(f.nombre)}${f.convocado ? '' : ' <span class="muted">(no convocado)</span>'}</td><td>${esc(f.cargo)}</td><td class="${f.asistio ? 'si' : 'no'}">${f.asistio ? 'Sí' : 'No'}</td><td>${esc(f.hora || '—')}</td></tr>`).join('')}
</tbody></table>

${p ? `<h2>Planificación diaria</h2>
${p.tema?.codigo && catalogos ? `<div><b>Tema tratado:</b> ${esc(labelDe(catalogos.temas, p.tema.codigo))}</div>` : ''}
${p.tema?.otro ? `<div><b>Tema tratado:</b> ${esc(p.tema.otro)}</div>` : ''}
${catalogos ? seccionCatalogo('Recursos utilizados', listaSeleccion(p.recursos, catalogos.recursos)) : ''}
${catalogos ? seccionCatalogo('Riesgos identificados', listaSeleccion(p.riesgos, catalogos.riesgos)) : ''}
${catalogos ? seccionCatalogo('Medidas de prevención', listaSeleccion(p.medidas, catalogos.medidas)) : ''}
${p.tipoTrabajo ? `<div><b>Tipo de trabajo:</b> ${p.tipoTrabajo === 'exterior' ? 'Exterior' : 'Interior'}${p.condicionClimatica ? ' · ' + esc(clima[p.condicionClimatica] || p.condicionClimatica) : ''}</div>` : ''}
${p.tipoTrabajo === 'exterior' && p.protectorSolar != null ? `<div><b>Aplicación de protector solar:</b> ${p.protectorSolar ? 'Sí' : 'No'}</div>` : ''}
${p.observaciones ? `<h3>${activity.tipo === 'REUNION_COMITE' ? 'Participación y consulta' : 'Observaciones'}</h3><div style="white-space:pre-wrap;font-size:13px">${esc(p.observaciones)}</div>` : ''}` : ''}

${(activity.permisosTrabajo || []).map((permiso) => {
        const resp = (v: string) => (({ si: 'Sí', no: 'No', na: 'N/A' } as Record<string, string>)[v] || '—');
        const def = permisosDef[permiso.tipo];
        // Un permiso de trabajo es evidencia de cumplimiento: nunca se omite del
        // acta. Si por algún motivo no se cargó su definición (checklist con
        // labels), se imprime igual con el tipo y las respuestas crudas.
        const titulo = def?.label || PERMISO_TIPO_LABEL[permiso.tipo] || permiso.tipo;
        const filasChecklist = def
            ? def.checklist.map((i) => `<tr><td>${esc(i.label)}</td><td>${resp(permiso.checklist[i.key])}</td></tr>`).join('')
            : Object.entries(permiso.checklist || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${resp(v)}</td></tr>`).join('');
        return `<h2>Permiso de trabajo — ${esc(titulo)} ${permiso.completo ? '' : '(incompleto)'}</h2>
<div><b>Responsable:</b> ${esc(permiso.responsableNombre || permiso.responsableId)} · <b>Vigencia:</b> ${esc(permiso.horaInicio || '—')} – ${esc(permiso.horaFin || '—')}${permiso.ubicacion ? ' · ' + esc(permiso.ubicacion) : ''}</div>
<table><thead><tr><th>Verificación</th><th>Respuesta</th></tr></thead><tbody>
${filasChecklist}
</tbody></table>`;
    }).join('')}

<div class="pie">Generado por PrevencionApp · ${new Date().toLocaleString('es-CL')}</div>
<script>window.onload = () => window.print();</script>
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
}
