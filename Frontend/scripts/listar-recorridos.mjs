// Listado de los recorridos guiados, con filtros (D-33). Es lo que en el
// sistema de referencia hacía la grilla del panel de administración: con los
// recorridos como código, el listado sale de las definiciones del repo.
//
//   npm run recorridos:listar
//   npm run recorridos:listar -- --pantalla inicio --tipo obligatorio
//   npm run recorridos:listar -- --estado borrador
//   npm run recorridos:listar -- --permiso obras.crear     # los que nombran ese permiso
//   npm run recorridos:listar -- --json
//
// Cada fila trae la ruta de la vista previa: abierta en dev, con la sesión de
// una empresa de prueba, muestra el recorrido tal como está y no guarda nada.

import { fileURLToPath } from 'node:url';

const FILTROS = ['pantalla', 'tipo', 'estado', 'permiso'];

/** Lee `--clave valor` y `--json` de la línea de comandos. */
export function leerArgumentos(argv) {
    const filtros = {};
    let json = false;
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--json') { json = true; continue; }
        const clave = a.startsWith('--') ? a.slice(2) : null;
        if (!clave || !FILTROS.includes(clave)) throw new Error(`Opción desconocida: ${a}. Usa --${FILTROS.join(', --')} o --json.`);
        const valor = argv[i + 1];
        if (!valor || valor.startsWith('--')) throw new Error(`Falta el valor de --${clave}.`);
        filtros[clave] = valor;
        i += 1;
    }
    return { filtros, json };
}

const permisosDe = (def) => {
    const v = def.visibleSi || {};
    return [...(v.todos || []), ...(v.alguno || []), ...(v.ninguno || [])];
};

/** Las definiciones que pasan todos los filtros, en el orden del archivo. */
export function filtrar(recorridos, filtros) {
    return recorridos.filter((d) => (!filtros.pantalla || d.pantalla === filtros.pantalla)
        && (!filtros.tipo || d.tipo === filtros.tipo)
        && (!filtros.estado || d.estado === filtros.estado)
        && (!filtros.permiso || permisosDe(d).includes(filtros.permiso)));
}

/** `visibleSi` en una línea: "todos: a, b · ninguno: c", o "todos" si no tiene condiciones. */
export function resumenVisibilidad(visibleSi = {}) {
    const partes = ['todos', 'alguno', 'ninguno'].filter((k) => visibleSi[k]?.length).map((k) => `${k}: ${visibleSi[k].join(', ')}`);
    return partes.length ? partes.join(' · ') : 'todos';
}

/** Ruta de la vista previa. Si la pantalla tiene parámetros (`:obraId`), quedan para reemplazar. */
export function rutaDeVistaPrevia(def, pantallas) {
    const ruta = pantallas[def.pantalla]?.ruta;
    return ruta ? `${ruta}?recorrido=${def.id}&previa=1` : null;
}

export function filas(recorridos, pantallas) {
    return recorridos.map((d) => ({
        id: d.id,
        tipo: d.tipo,
        estado: d.estado,
        version: d.version,
        reiniciarAlPublicar: d.reiniciarAlPublicar,
        pantalla: d.pantalla,
        vigencia: d.vigenciaDesde || d.vigenciaHasta ? `${d.vigenciaDesde || '…'} a ${d.vigenciaHasta || '…'}` : 'siempre',
        visibleSi: resumenVisibilidad(d.visibleSi),
        ambito: d.ambito,
        pasos: d.pasos.length,
        vistaPrevia: rutaDeVistaPrevia(d, pantallas),
    }));
}

async function principal() {
    let args;
    try { args = leerArgumentos(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
    const { RECORRIDOS } = await import('../src/ayuda/recorridos.ts');
    const { PANTALLAS } = await import('../src/ayuda/registro.ts');
    const lista = filas(filtrar(RECORRIDOS, args.filtros), PANTALLAS);
    if (args.json) { console.log(JSON.stringify(lista, null, 2)); return; }
    if (lista.length === 0) {
        console.log(RECORRIDOS.length === 0 ? 'Todavía no hay recorridos definidos (src/ayuda/recorridos.ts).' : 'Ningún recorrido coincide con los filtros.');
        return;
    }
    for (const f of lista) {
        console.log(`${f.id}  [${f.tipo}, ${f.estado}, v${f.version}${f.reiniciarAlPublicar ? ', se vuelve a mostrar' : ''}]`);
        console.log(`  pantalla: ${f.pantalla} · ámbito: ${f.ambito} · ${f.pasos} paso(s) · vigencia: ${f.vigencia}`);
        console.log(`  lo ven: ${f.visibleSi}`);
        if (f.vistaPrevia) console.log(`  vista previa: ${f.vistaPrevia}`);
    }
    console.log(`\n${lista.length} de ${RECORRIDOS.length} recorrido(s).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await principal();
