// Direcciones del manual anterior a la Fase 4 (D-33), que estaba ordenado por
// módulo, y a dónde se fue cada una en la estructura por tarea. Hay enlaces
// viejos en la app, en correos y en marcadores: siguen funcionando.
//
// Generado por la migración del 7 de noviembre de 2026; no hay que agregar nada
// acá salvo que una página nueva se renombre. `tests/manual-estructura.test.mjs`
// exige que toda página vieja tenga destino y que todo destino exista.

/** Página vieja → página nueva ('' = portada del manual). */
export const PAGINAS_MOVIDAS: Readonly<Record<string, string>> = {
    'ds44': 'fuf',
    'ds44/capacitaciones': 'fuf/capacitaciones',
    'ds44/documentos-obligatorios': 'fuf/requisitos',
    'ds44/epp': 'obra/epp',
    'ds44/fases-obra': 'obra/cumplimiento',
    'ds44/firmas-digitales': 'fuf/firmas',
    'guia-inicio': 'empezar',
    'guia-inicio/instalacion': 'empezar/ingresar',
    'guia-inicio/onboarding': 'empresa/alta',
    'guia-inicio/primeros-pasos': 'empezar/elegir-obra',
    'modulos': '',
    'modulos/actividades': 'obra/actividades',
    'modulos/bandeja-entrada': 'terreno/avisos',
    'modulos/catalogos': 'empresa/cargos',
    'modulos/configuracion': 'empezar/mi-cuenta',
    'modulos/dashboard': 'empezar/elegir-obra',
    'modulos/datos-personales': 'empresa/datos-personales',
    'modulos/documentos': 'obra/documentos',
    'modulos/encuestas': 'terreno/encuestas',
    'modulos/estructura-preventiva': 'obra/estructura',
    'modulos/firmas': 'terreno/firmar',
    'modulos/incidentes': 'terreno/reportar',
    'modulos/obras': 'empresa/obras',
    'modulos/onboarding-cargos': 'empresa/cargos',
    'modulos/personas': 'empresa/personas',
    'modulos/prescripciones': 'obra/prescripciones',
    'modulos/tenants': 'empresa',
    'roles/admin': 'roles/administrador',
};

/**
 * Secciones que no siguieron a su página: `vieja#ancla` → página nueva. Por
 * ejemplo, "Firma asistida" estaba en Firmas y ahora está en Pedir firmas.
 */
export const ANCLAS_MOVIDAS: Readonly<Record<string, string>> = {
    'ds44/documentos-obligatorios#difusión-informar-no-es-solo-tenerlo': 'obra/documentos',
    'ds44/documentos-obligatorios#la-miper-y-el-programa-de-trabajo-van-juntos': 'obra/documentos',
    'guia-inicio/primeros-pasos#poner-una-obra-en-marcha': 'empresa/obras',
    'modulos/actividades#cerrar-la-actividad': 'obra/asistencia',
    'modulos/actividades#completar-el-registro-después-de-la-charla': 'obra/asistencia',
    'modulos/actividades#registrar-la-asistencia': 'obra/asistencia',
    'modulos/actividades#reporte-post-charla': 'obra/asistencia',
    'modulos/actividades#se-firma-durante-todo-el-día': 'obra/asistencia',
    'modulos/actividades#seguimiento-del-día-pendientes-ausencias-y-alertas': 'obra/asistencia',
    'modulos/encuestas#crear-una-encuesta-gestor': 'obra/encuestas',
    'modulos/encuestas#revisar-resultados': 'obra/encuestas',
    'modulos/firmas#firma-asistida': 'obra/pedir-firmas',
    'modulos/firmas#firma-del-relator': 'obra/pedir-firmas',
    'modulos/incidentes#el-listado': 'obra/incidentes',
    'modulos/incidentes#estadísticas': 'obra/incidentes',
    'modulos/incidentes#gestionar-un-evento': 'obra/incidentes',
    'modulos/incidentes#investigaciones': 'obra/incidentes',
    'modulos/obras#cargar-un-documento-y-pedir-las-firmas': 'obra/cumplimiento',
    'modulos/obras#cumplimiento-ds-44': 'obra/cumplimiento',
    'modulos/obras#la-ficha-de-la-obra': 'obra/cumplimiento',
    'modulos/obras#módulos-de-cada-fase': 'obra/cumplimiento',
    'modulos/obras#registrar-un-envío': 'obra/cumplimiento',
    'modulos/obras#resumen': 'obra/cumplimiento',
    'modulos/personas#el-equipo-de-una-obra': 'obra/equipo',
    'modulos/personas#registrar-una-entrega-de-epp': 'obra/epp',
    'modulos/tenants#cargos': 'empresa/cargos',
    'modulos/tenants#epp': 'empresa/cargos',
    'modulos/tenants#roles-y-permisos': 'empresa/roles',
    'roles#la-vista-de-empresa': 'empresa/roles',
    'roles#los-permisos-son-configurables': 'empresa/roles',
    'roles#rol-y-cargo-no-son-lo-mismo': 'empresa/roles',
};

/** Destino de una dirección vieja, con su ancla, o null si la dirección no es vieja. */
export function destinoDe(rel: string, ancla: string): string | null {
    const pagina = rel.replace(/^\/+|\/+$/g, '');
    if (!(pagina in PAGINAS_MOVIDAS)) return null;
    const destino = (ancla ? ANCLAS_MOVIDAS[`${pagina}#${ancla}`] : undefined) ?? PAGINAS_MOVIDAS[pagina];
    return `/manual${destino ? `/${destino}` : ''}${ancla ? `#${ancla}` : ''}`;
}
