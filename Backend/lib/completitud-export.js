/**
 * Export del cumplimiento del FUF.
 *
 * Lee EXACTAMENTE lo que produce el motor (`completitudAmbito`), que a su vez lee
 * las definiciones de `completitud-estructura.js`. Es la sección 10.4 del encargo:
 * un solo lugar vincula requisito con evidencia, así que el panel y este documento
 * no pueden discrepar. Si algún día divergen, es porque alguien reimplementó el
 * cálculo acá — no lo haga.
 *
 * QUÉ ES Y QUÉ NO ES: un reporte de ESTADO, no evidencia firmada. Dice qué hay y
 * qué falta al momento de generarlo; no acredita por sí mismo ningún requisito, y
 * por eso no se firma ni se persiste como documento del repositorio. El expediente
 * consolidado con integridad verificable es otra cosa y no es parte de este módulo.
 *
 * Reglas que el encargo pide sostener en el export:
 *   - Los NoAplica se DECLARAN con su justificación normativa. Un expediente que
 *     oculta lo que excluyó es peor que uno incompleto.
 *   - Los ítems fuera de alcance se marcan como tales, no se omiten (§12).
 *   - Un órgano constituido sin estar obligado se rotula VOLUNTARIO (§2).
 */

const { ESTADO_REQUISITO } = require('./completitud');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

const ETIQUETA_ESTADO = {
    [ESTADO_REQUISITO.CUMPLIDO]: 'Cumplido',
    [ESTADO_REQUISITO.PARCIAL]: 'Parcial',
    [ESTADO_REQUISITO.PENDIENTE]: 'Pendiente',
    [ESTADO_REQUISITO.VENCIDO]: 'Vencido',
    [ESTADO_REQUISITO.NO_APLICA]: 'No aplica',
    [ESTADO_REQUISITO.FUERA_DE_ALCANCE]: 'Fuera de alcance',
};

const COLOR_ESTADO = {
    [ESTADO_REQUISITO.CUMPLIDO]: '#0f766e',
    [ESTADO_REQUISITO.PARCIAL]: '#b45309',
    [ESTADO_REQUISITO.PENDIENTE]: '#1d4ed8',
    [ESTADO_REQUISITO.VENCIDO]: '#b91c1c',
    [ESTADO_REQUISITO.NO_APLICA]: '#6b7280',
    [ESTADO_REQUISITO.FUERA_DE_ALCANCE]: '#6b7280',
};

/**
 * Estructura del export, independiente del formato. El HTML se construye desde
 * acá, y cualquier otro formato (CSV, PDF) debe hacerlo también.
 */
function construirExport(completitud, { nombreEmpresa = null, nombreObra = null, generadoEn = new Date() } = {}) {
    const organos = completitud.organos || [];
    return {
        tipoDocumento: 'Cumplimiento del Formulario Único de Fiscalización',
        alcance: 'Requisitos de estructura organizacional preventiva (DS 44/2024)',
        ambito: completitud.ambito,
        nombreAmbito: completitud.ambito === 'obra' ? nombreObra : nombreEmpresa,
        obraId: completitud.obraId,
        generadoEn: generadoEn.toISOString(),
        dotacion: completitud.dotacion,
        resumen: completitud.resumen,
        bloques: completitud.bloques,
        // Rótulo de voluntariedad por órgano vigente.
        organos: organos.map((o) => ({
            tipo: o.tipo,
            origen: o.origen,
            estado: o.estado,
            voluntario: o.origen === 'Voluntario',
            fechaConstitucion: o.fechaConstitucion || o.fechaEleccionODesignacion || null,
            fechaTerminoMandato: o.fechaTerminoMandato || null,
        })),
        limiteRegistroDT: completitud.limiteRegistroDT || null,
    };
}

/** Render imprimible. Sin dependencias: se abre en cualquier navegador. */
function renderHtml(exp) {
    const filas = (bloque) => bloque.requisitos.map((r) => `
        <tr>
          <td class="item">${r.item ?? '—'}</td>
          <td>${esc(r.titulo)}</td>
          <td><span class="estado" style="color:${COLOR_ESTADO[r.estado]}">${ETIQUETA_ESTADO[r.estado] || esc(r.estado)}</span></td>
          <td class="detalle">${esc(r.justificacion || r.detalle || '')}</td>
        </tr>`).join('');

    const bloques = (exp.bloques || []).map((b) => `
      <h2>${esc(b.bloque)} <span class="pct">${b.resumen.cumplidos}/${b.resumen.exigibles} · ${b.resumen.progreso}%</span></h2>
      <table>
        <tr><th style="width:52px">FUF</th><th>Requisito</th><th style="width:110px">Estado</th><th>Detalle</th></tr>
        ${filas(b)}
      </table>`).join('');

    const voluntarios = (exp.organos || []).filter((o) => o.voluntario);
    const notaVoluntarios = voluntarios.length === 0 ? '' : `
      <div class="nota">
        <strong>Órganos constituidos de forma voluntaria:</strong>
        ${voluntarios.map((o) => esc(o.tipo)).join(', ')}.
        No eran exigibles según la dotación del ámbito al momento de constituirlos,
        de modo que su ausencia previa no constituyó incumplimiento.
      </div>`;

    const d = exp.dotacion || {};
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>${esc(exp.tipoDocumento)}</title>
<style>
 body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:13px}
 h1{font-size:19px;margin-bottom:4px}
 h2{font-size:14px;margin-top:26px;border-bottom:1px solid #ccc;padding-bottom:4px}
 .pct{float:right;font-weight:400;color:#555;font-size:12px}
 .muted{color:#666;font-size:12px}
 table{border-collapse:collapse;width:100%;margin-top:8px}
 th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:12px;vertical-align:top}
 th{background:#f3f4f6}
 .item{text-align:center;font-weight:600}
 .estado{font-weight:600;white-space:nowrap}
 .detalle{color:#444}
 .nota{margin-top:20px;padding:10px 12px;border:1px solid #999;border-radius:6px;background:#f7f7f7;font-size:12px}
 .aviso{margin-top:24px;padding:10px 12px;border-left:3px solid #b45309;background:#fffbeb;font-size:12px}
</style></head><body>
<h1>${esc(exp.tipoDocumento)}</h1>
<div class="muted">${esc(exp.alcance)}</div>
<div class="muted">
  Ámbito: ${esc(exp.nombreAmbito || (exp.ambito === 'obra' ? 'Obra' : 'Entidad empleadora'))}
  · Dotación: ${esc(d.dotacion)} persona(s)${d.origen === 'declarada' ? ' (declarada)' : ' (calculada del sistema)'}
  · Generado: ${esc(String(exp.generadoEn).slice(0, 19).replace('T', ' '))}
</div>

<h2>Resumen <span class="pct">${exp.resumen.cumplidos}/${exp.resumen.exigibles} · ${exp.resumen.progreso}%</span></h2>
<div class="muted">
  ${exp.resumen.exigibles} requisito(s) exigible(s) a este ámbito.
  ${exp.resumen.excluidos > 0
        ? `${exp.resumen.excluidos} no aplican o están fuera de alcance y no penalizan; se detallan igualmente más abajo con su justificación.`
        : ''}
</div>

${bloques}
${notaVoluntarios}
${exp.limiteRegistroDT ? `
<div class="nota">
  Plazo estimado para registrar el acta de constitución en la Dirección del Trabajo:
  ${esc(String(exp.limiteRegistroDT).slice(0, 10))}. <strong>Es referencial</strong>: el cálculo
  excluye sábados y domingos pero no los feriados legales, de modo que la fecha real puede ser posterior.
</div>` : ''}

<div class="aviso">
  Este documento es un <strong>reporte de estado</strong> generado el
  ${esc(String(exp.generadoEn).slice(0, 10))}. Refleja la evidencia registrada en el
  sistema a esa fecha y no acredita por sí mismo el cumplimiento de ningún requisito:
  la acreditación la dan los documentos y registros que aquí se referencian.
</div>
</body></html>`;
}

module.exports = { construirExport, renderHtml, ETIQUETA_ESTADO };
