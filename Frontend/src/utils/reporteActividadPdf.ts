import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Activity, CatalogosActividad, PermisosTrabajoDef } from '../api/client';
import { CLIMA_LABEL, labelDe, listaSeleccion, estadoEvaluacion } from './reporteActividad';
import type { construirFilasAsistencia } from './reporteActividad';

type Filas = ReturnType<typeof construirFilasAsistencia>;

// Etiquetas de respaldo: el acta nunca debe mostrar el código crudo aunque no
// se haya cargado la definición de permisos del backend.
const PERMISO_TIPO_LABEL: Record<string, string> = {
    ALTURA: 'Trabajo en altura',
    ESPACIO_CONFINADO: 'Espacio confinado',
    TRABAJO_CALIENTE: 'Trabajo en caliente',
};

const NAVY: [number, number, number] = [0, 40, 85];
const INK: [number, number, number] = [17, 17, 17];
const MUTED: [number, number, number] = [110, 110, 110];

const fechaLarga = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
};

/** Nombre de archivo estable y sin caracteres problemáticos. */
export function nombreArchivoReporte(activity: Activity): string {
    const slug = (activity.titulo || 'actividad')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'actividad';
    return `Reporte_${slug}_${activity.fecha}.pdf`;
}

/**
 * Construye el acta de la actividad como PDF real (mismo contenido que el acta
 * imprimible). Devuelve el documento para poder previsualizarlo en la página
 * (`output('bloburl')`) o descargarlo (`save`) sin regenerarlo dos veces.
 */
export function construirReporteActividadPdf(
    activity: Activity,
    filas: Filas,
    catalogos: CatalogosActividad | null,
    permisosDef: PermisosTrabajoDef,
): jsPDF {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const M = 16;                       // margen lateral
    const maxY = doc.internal.pageSize.height - 18;
    let y = 0;

    // ── Cabecera ──
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageWidth, 32, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    // El título se encoge hasta caber en una línea antes de recortarse, para que
    // un nombre largo no se pierda sin aviso en la cabecera.
    const anchoTitulo = pageWidth - M * 2 - 42;
    const tituloTexto = activity.titulo || 'Actividad';
    let tamTitulo = 15;
    doc.setFontSize(tamTitulo);
    while (tamTitulo > 10 && doc.getTextWidth(tituloTexto) > anchoTitulo) {
        tamTitulo -= 0.5;
        doc.setFontSize(tamTitulo);
    }
    // Si ni al tamaño mínimo cabe, se recorta con puntos suspensivos: el corte
    // debe verse, no parecer que el título terminaba ahí.
    let tituloFinal = tituloTexto;
    if (doc.getTextWidth(tituloFinal) > anchoTitulo) {
        while (tituloFinal.length > 1 && doc.getTextWidth(`${tituloFinal}…`) > anchoTitulo) {
            tituloFinal = tituloFinal.slice(0, -1);
        }
        tituloFinal = `${tituloFinal.trimEnd()}…`;
    }
    doc.text(tituloFinal, M, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const sub = [
        activity.tipoDescripcion || activity.tipo,
        fechaLarga(activity.fecha),
        `${activity.horaInicio || ''}${activity.horaFin ? ` – ${activity.horaFin}` : ''}`.trim(),
        activity.ubicacion || '',
    ].filter(Boolean).join('  ·  ');
    doc.text(sub, M, 23);
    doc.setFontSize(8);
    doc.text('Acta de actividad', pageWidth - M, 14, { align: 'right' });
    y = 42;

    // Salto de página cuando ya no cabe el bloque que viene.
    const asegurarEspacio = (alto: number) => {
        if (y + alto > maxY) { doc.addPage(); y = 20; }
    };

    const titulo = (texto: string) => {
        asegurarEspacio(14);
        doc.setTextColor(...NAVY);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11.5);
        doc.text(texto, M, y);
        y += 2;
        doc.setDrawColor(220, 226, 233);
        doc.line(M, y, pageWidth - M, y);
        y += 6;
    };

    const parrafo = (texto: string, opts: { bold?: boolean; muted?: boolean } = {}) => {
        doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(...(opts.muted ? MUTED : INK));
        for (const linea of doc.splitTextToSize(texto, pageWidth - M * 2) as string[]) {
            asegurarEspacio(6);
            doc.text(linea, M, y);
            y += 5;
        }
    };

    const vinetas = (label: string, valores: string[]) => {
        if (valores.length === 0) return;
        parrafo(label, { bold: true });
        for (const v of valores) {
            for (const linea of doc.splitTextToSize(`•  ${v}`, pageWidth - M * 2 - 4) as string[]) {
                asegurarEspacio(6);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9.5);
                doc.setTextColor(...INK);
                doc.text(linea, M + 3, y);
                y += 5;
            }
        }
        y += 2;
    };

    const trasTabla = () => {
        y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 9;
    };

    // ── Asistencia ──
    titulo('Asistencia');
    parrafo(
        `Convocados: ${filas.requeridos}    Participantes: ${filas.asistieron}    ` +
        `Asistencia: ${filas.requeridos > 0 ? `${filas.porcentaje}%` : '—'}`,
        { bold: true },
    );
    y += 3;

    if (filas.filas.length === 0) {
        parrafo('Sin convocados ni asistencias registradas.', { muted: true });
        y += 4;
    } else {
        autoTable(doc, {
            startY: y,
            margin: { left: M, right: M },
            head: [['Nombre', 'Cargo', 'Asistió', 'Hora de firma']],
            body: filas.filas.map((f) => [
                f.nombre + (f.convocado ? '' : ' (no convocado)'),
                f.cargo || '—',
                f.asistio ? 'Sí' : 'No',
                (f.hora || '—') + (f.atraso ? ` (atraso ${f.minutosAtraso} min)` : ''),
            ]),
            theme: 'grid',
            styles: { fontSize: 8.5, cellPadding: 2.5, textColor: INK, lineColor: [214, 222, 231] },
            headStyles: { fillColor: [240, 244, 249], textColor: NAVY, fontStyle: 'bold' },
            columnStyles: { 2: { halign: 'center', cellWidth: 20 }, 3: { cellWidth: 42 } },
            // El "No" en rojo: es el dato que se audita.
            didParseCell: (data) => {
                if (data.section === 'body' && data.column.index === 2) {
                    const ok = data.cell.raw === 'Sí';
                    data.cell.styles.textColor = ok ? [21, 128, 61] : [185, 28, 28];
                    data.cell.styles.fontStyle = 'bold';
                }
            },
        });
        trasTabla();
    }

    // ── Evaluación de aprendizaje ──
    // El acta no lleva notas: la evaluación se rinde y se corrige fuera del
    // sistema y vive en un documento aparte. Acá se deja constancia de la
    // exigencia y de si ese respaldo está cargado, que es lo único que la
    // plataforma puede afirmar sin abrir el archivo.
    const evaluacion = estadoEvaluacion(activity);
    if (evaluacion) {
        titulo('Evaluación de aprendizaje');
        parrafo(`Nota mínima exigida: ${evaluacion.notaMinima}%`, { bold: true });
        if (evaluacion.tieneRespaldo) {
            parrafo(`Respaldo: ${evaluacion.nombreArchivo || 'documento adjunto'}.`);
            parrafo('Las evaluaciones corregidas constan en ese documento, adjunto a esta actividad.', { muted: true });
        } else {
            parrafo('Sin respaldo cargado: falta adjuntar el documento con las evaluaciones.', { muted: true });
        }
        y += 4;
    }

    // ── Planificación diaria ──
    const p = activity.planificacion;
    if (p) {
        const tema = p.tema?.otro || (p.tema?.codigo && catalogos ? labelDe(catalogos.temas, p.tema.codigo) : '');
        const recursos = catalogos ? listaSeleccion(p.recursos, catalogos.recursos) : [];
        const riesgos = catalogos ? listaSeleccion(p.riesgos, catalogos.riesgos) : [];
        const medidas = catalogos ? listaSeleccion(p.medidas, catalogos.medidas) : [];
        const hayPlan = tema || recursos.length || riesgos.length || medidas.length || p.tipoTrabajo || p.observaciones;

        if (hayPlan) {
            titulo('Planificación diaria');
            if (tema) parrafo(`Tema tratado: ${tema}`);
            vinetas('Recursos utilizados', recursos);
            vinetas('Riesgos identificados', riesgos);
            vinetas('Medidas de prevención', medidas);
            if (p.tipoTrabajo) {
                parrafo(
                    `Tipo de trabajo: ${p.tipoTrabajo === 'exterior' ? 'Exterior' : 'Interior'}` +
                    (p.condicionClimatica ? ` · ${CLIMA_LABEL[p.condicionClimatica] || p.condicionClimatica}` : ''),
                );
            }
            if (p.tipoTrabajo === 'exterior' && p.protectorSolar != null) {
                parrafo(`Aplicación de protector solar: ${p.protectorSolar ? 'Sí' : 'No'}`);
            }
            if (p.observaciones) {
                y += 2;
                parrafo(activity.tipo === 'REUNION_COMITE' ? 'Participación y consulta' : 'Observaciones', { bold: true });
                parrafo(p.observaciones);
            }
            y += 4;
        }
    }

    // ── Permisos de trabajo ──
    const resp = (v: string) => (({ si: 'Sí', no: 'No', na: 'N/A' } as Record<string, string>)[v] || '—');
    for (const permiso of activity.permisosTrabajo || []) {
        const def = permisosDef[permiso.tipo];
        const nombre = def?.label || PERMISO_TIPO_LABEL[permiso.tipo] || permiso.tipo;
        titulo(`Permiso de trabajo — ${nombre}${permiso.completo ? '' : ' (incompleto)'}`);
        parrafo(
            `Responsable: ${permiso.responsableNombre || permiso.responsableId || '—'}   ·   ` +
            `Vigencia: ${permiso.horaInicio || '—'} – ${permiso.horaFin || '—'}` +
            (permiso.ubicacion ? `   ·   ${permiso.ubicacion}` : ''),
            { muted: true },
        );
        y += 3;
        const body = def
            ? def.checklist.map((i) => [i.label, resp(permiso.checklist[i.key])])
            : Object.entries(permiso.checklist || {}).map(([k, v]) => [k, resp(v)]);
        autoTable(doc, {
            startY: y,
            margin: { left: M, right: M },
            head: [['Verificación', 'Respuesta']],
            body,
            theme: 'grid',
            styles: { fontSize: 8.5, cellPadding: 2.5, textColor: INK, lineColor: [214, 222, 231] },
            headStyles: { fillColor: [240, 244, 249], textColor: NAVY, fontStyle: 'bold' },
            columnStyles: { 1: { halign: 'center', cellWidth: 28 } },
        });
        trasTabla();
    }

    // ── Pie con folio de página en todas las hojas ──
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text(`Generado por Build & Serve · ${new Date().toLocaleString('es-CL')}`, M, maxY + 10);
        doc.text(`Página ${i} de ${total}`, pageWidth - M, maxY + 10, { align: 'right' });
    }

    return doc;
}
