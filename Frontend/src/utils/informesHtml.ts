/**
 * Informes imprimibles que se arman en el navegador: Registro AT/EP de la obra
 * e impresión del listado de incidentes.
 *
 * Se abren en una pestaña nueva que comparte el ORIGEN de la aplicación (una URL
 * `blob:` hereda el origen de quien la crea). Hasta el 28 de septiembre de 2026
 * las plantillas interpolaban sin escapar la descripción de un hallazgo, el
 * centro de trabajo y el nombre del trabajador: cualquier sesión podía reportar
 * un hallazgo con un `<script>` en la descripción, y ese script corría al
 * generar o imprimir el informe con la sesión de quien lo abría, y podía leer
 * su token.
 *
 * Reglas de este módulo:
 *   - todo texto que venga de datos pasa por `escaparHtml`, sin excepción, aunque
 *     "sea un número": el tipo en TypeScript no garantiza qué llega de la API;
 *   - las plantillas son funciones puras (datos → HTML), para poder probarlas;
 *   - `abrirHtmlEnPestana` es el ÚNICO lugar del frontend que convierte una
 *     cadena en documento HTML. La prueba `html-sin-escapar.test.js` falla si
 *     aparece otro sumidero (innerHTML, document.write, …) fuera de este archivo.
 */

import { escaparHtml as e } from './escaparHtml';
import { incidenteAbierto, incidenteCerrado } from './incidentes';

/**
 * Abre `html` en una pestaña. Si ya hay una pestaña abierta (se abre en el clic
 * para que el navegador no la bloquee), se usa esa.
 */
export function abrirHtmlEnPestana(html: string, ventana?: Window | null): boolean {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const destino = ventana && !ventana.closed ? ventana : window.open('', '_blank');
    if (!destino) { URL.revokeObjectURL(url); return false; }
    destino.location.href = url;
    // Se libera después, para no cortar la carga de la pestaña.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
}

const fechaCorta = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('es-CL') : '-');

export interface DatosRegistroATEP {
    obraNombre?: string | null;
    incidentes: any[];
    /** Nombre de quien firma como prevencionista; si falta, se deja el rótulo. */
    firmante?: string | null;
    ahora?: Date;
}

/** Registro de AT, EP e incidentes peligrosos de una obra (Arts. 72 y 73). */
export function htmlRegistroATEP({ obraNombre, incidentes, firmante, ahora = new Date() }: DatosRegistroATEP): string {
    const fecha = ahora.toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
    const abiertos = incidentes.filter(incidenteAbierto);
    const cerrados = incidentes.filter(incidenteCerrado);
    const obra = e(obraNombre || '-');
    const rows = incidentes.map((inc: any) => {
        const cerrado = incidenteCerrado(inc);
        return `
      <tr>
        <td>${e(fechaCorta(inc.fecha))}</td>
        <td>${e(inc.tipo || '-')}</td>
        <td>${e(inc.descripcion || inc.titulo || '-')}</td>
        <td>${e(inc.trabajadorAfectado || inc.personaAfectada || '-')}</td>
        <td><span class="badge-${cerrado ? 'ok' : 'warn'}">${e(cerrado ? 'cerrado' : (inc.estado || '-'))}</span></td>
        <td>${e(inc.responsable || inc.creadoPor || '-')}</td>
      </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Registro AT/EP/Incidentes Peligrosos — ${obra}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; font-size: 12px; padding: 32px; }
    .header { text-align: center; border-bottom: 3px solid #1a1a2e; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { font-size: 15px; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
    .header .subtitle { font-size: 11px; color: #555; margin-bottom: 2px; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 20px; }
    .meta-card { border: 1px solid #ddd; padding: 10px 12px; border-radius: 6px; }
    .meta-label { font-size: 9px; text-transform: uppercase; color: #888; letter-spacing: 0.06em; margin-bottom: 2px; }
    .meta-value { font-size: 16px; font-weight: 700; color: #1a1a2e; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #555; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #eee; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #1a1a2e; color: #fff; padding: 8px 10px; text-align: left; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 7px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    .badge-ok { background: #d1fae5; color: #065f46; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; }
    .badge-warn { background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; }
    .empty { text-align: center; color: #aaa; padding: 24px; font-style: italic; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 48px; }
    .sign-box { border-top: 1px solid #333; padding-top: 8px; text-align: center; }
    .sign-name { font-weight: 600; font-size: 12px; }
    .sign-role { font-size: 10px; color: #888; }
    .legal-note { margin-top: 24px; font-size: 9px; color: #aaa; border-top: 1px solid #eee; padding-top: 8px; text-align: center; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Registro de Accidentes del Trabajo, Enfermedades Profesionales e Incidentes Peligrosos</h1>
    <p class="subtitle">Arts. 72 y 73 — Decreto Supremo N°44/2024 — Ministerio de Salud</p>
    <p class="subtitle">Generado: ${e(fecha)}</p>
  </div>

  <div class="meta-grid">
    <div class="meta-card"><div class="meta-label">Obra</div><div class="meta-value" style="font-size:13px">${obra}</div></div>
    <div class="meta-card"><div class="meta-label">Total incidentes</div><div class="meta-value">${e(incidentes.length)}</div></div>
    <div class="meta-card"><div class="meta-label">Abiertos</div><div class="meta-value" style="color:#d97706">${e(abiertos.length)}</div></div>
    <div class="meta-card"><div class="meta-label">Cerrados</div><div class="meta-value" style="color:#059669">${e(cerrados.length)}</div></div>
  </div>

  <div class="section-title">Detalle de incidentes registrados</div>
  ${incidentes.length === 0
        ? '<p class="empty">No se han registrado incidentes para esta obra.</p>'
        : `<table>
        <thead><tr>
          <th>Fecha</th><th>Tipo</th><th>Descripci&oacute;n</th><th>Afectado</th><th>Estado</th><th>Responsable</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`}

  <div class="signatures">
    <div class="sign-box">
      <div style="height:48px"></div>
      <div class="sign-name">${e(firmante || 'Prevencionista')}</div>
      <div class="sign-role">Prevencionista / Responsable SST</div>
    </div>
    <div class="sign-box">
      <div style="height:48px"></div>
      <div class="sign-name">Jefe de Obra</div>
      <div class="sign-role">Revisado y validado</div>
    </div>
  </div>

  <p class="legal-note">Documento generado por PrevencionApp &bull; ${obra} &bull; Cumplimiento DS44 Arts. 72-73</p>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;
}

export interface DatosImpresionIncidentes {
    incidents: any[];
    stats?: any;
    tipoLabel: (tipo: string) => string;
    ahora?: Date;
}

const decimal = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '0');

/** Listado de incidentes para imprimir (Incidentes › Exportar › PDF). */
export function htmlImpresionIncidentes({ incidents, stats, tipoLabel, ahora = new Date() }: DatosImpresionIncidentes): string {
    const filas = incidents.map((inc: any) => `
                <tr>
                    <td>${e(inc.fecha)}</td>
                    <td>${e(tipoLabel(inc.tipo))}</td>
                    <td>${e(inc.centroTrabajo)}</td>
                    <td>${e(inc.trabajadorNombre || inc.trabajador?.nombre || '')}</td>
                    <td>${e(inc.gravedad)}</td>
                    <td>${e(String(inc.estado || '').replace('_', ' '))}</td>
                </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Reporte de Incidentes</title>
    <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
    .stats { display: flex; gap: 20px; margin: 20px 0; }
    .stat-box { padding: 15px; background: #f5f5f5; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #333; }
    .stat-label { font-size: 12px; color: #666; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #4CAF50; color: white; }
    tr:nth-child(even) { background: #f9f9f9; }
    .footer { margin-top: 30px; text-align: center; color: #666; font-size: 12px; }
    
    </style>
</head>
<body>
    <h1>Reporte de Incidentes y Accidentes</h1>
    <p>Generado el ${e(ahora.toLocaleString('es-CL'))}</p>

    <div class="stats">
        <div class="stat-box"><div class="stat-value">${e(stats?.numeroAccidentes || 0)}</div><div class="stat-label">Accidentes</div></div>
        <div class="stat-box"><div class="stat-value">${e(decimal(stats?.tasaAccidentabilidad))}%</div><div class="stat-label">Tasa Accidentabilidad</div></div>
        <div class="stat-box"><div class="stat-value">${e(stats?.diasPerdidos || 0)}</div><div class="stat-label">Días Perdidos</div></div>
        <div class="stat-box"><div class="stat-value">${e(decimal(stats?.siniestralidad))}%</div><div class="stat-label">Siniestralidad</div></div>
    </div>

    <table>
        <thead>
            <tr><th>Fecha</th><th>Tipo</th><th>Centro de Trabajo</th><th>Trabajador</th><th>Gravedad</th><th>Estado</th></tr>
        </thead>
        <tbody>${filas}
        </tbody>
    </table>

    <div class="footer">
        Sistema de Gestión de Seguridad Laboral | Masa Laboral: ${e(stats?.masaLaboral || 100)}
    </div>
    <script>window.onload = () => window.print();</script>
</body>
</html>`;
}
