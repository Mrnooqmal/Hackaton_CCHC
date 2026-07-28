// Estado de cierre de un incidente/hallazgo.
//
// Un HALLAZGO (clasificacion 'hallazgo': condicion/accion subestándar) se cierra
// vía gobernanza (`gobernanza.estadoCierre = 'cerrado'`), flujo que NO modifica el
// campo `estado` (queda en 'reportado' de por vida).
//
// Un INCIDENTE (accidente/incidente peligroso) se cierra por su ciclo de vida de
// investigación (`estado = 'cerrado'`).
//
// Contar sólo por `estado` marcaba los hallazgos gestionados como abiertos en el
// Registro de Actividad Preventiva (Art. 72) y en el dashboard. Usar este helper
// en todos los contadores para mantener el criterio consistente.
export const incidenteCerrado = (inc: any): boolean =>
  inc?.clasificacion === 'hallazgo'
    ? inc?.gobernanza?.estadoCierre === 'cerrado' || inc?.estado === 'cerrado'
    : inc?.estado === 'cerrado';

export const incidenteAbierto = (inc: any): boolean => !incidenteCerrado(inc);
