import { estaCerrado, type CasoParaPasos } from './casos';

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
//
// Es `estaCerrado` de `utils/casos` (espejo de lib/casos.js): una sola regla para el
// servidor, el detalle del caso y los contadores. Antes esta función comparaba
// `clasificacion === 'hallazgo'` y un incidente anterior a la clasificación (sin ese campo)
// se contaba como incidente aunque su tipo fuera de hallazgo.
export const incidenteCerrado = (inc: CasoParaPasos | null | undefined): boolean => estaCerrado(inc);

export const incidenteAbierto = (inc: CasoParaPasos | null | undefined): boolean => !incidenteCerrado(inc);

// Etapas constructivas del catálogo de incidentes. Compartida entre el
// listado/estadísticas (pages/Incidents.tsx) y el formulario de reporte
// (pages/IncidentReportar.tsx).
export const ETAPAS_CONSTRUCTIVAS = [
  'Excavaciones',
  'Fundaciones',
  'Obra Gruesa',
  'Instalaciones Sanitarias',
  'Instalaciones Eléctricas',
  'Terminaciones',
  'Obras Exteriores',
  'Otro',
];
