// Sembrador de datos de ejemplo para dev (scripts/sembrar-demo-dev.js).
//
// Un sembrador no se prueba por el dato que deja: se prueba por lo que NO puede
// hacer. Dos cosas lo hacen peligroso y las dos se comprueban acá:
//
//   1. Que no pueda correr fuera de dev. Inventa empresas, obras y personas: en
//      producción eso es basura mezclada con datos reales de EBCO.
//   2. Que su marca y su archivo de pendientes sean distintos de los del e2e.
//      La purga de la prueba de punta a punta borra toda empresa de SU marca con
//      más de una hora; si compartieran marca, cada despliegue borraría estos
//      datos, y si compartieran archivo, la purga del e2e se encontraría con una
//      empresa que su propia comprobación le prohíbe borrar y quedaría colgada.
//
// Lo demás que se prueba es que el dato sembrado sirva para lo que se sembró:
// tipos y motivos que la API acepta de verdad, y un reparto de documentos y
// dotaciones que haga visible lo que el panel tiene que mostrar.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const sembrador = require('../scripts/sembrar-demo-dev');
const desechable = require('../scripts/e2e/empresa-desechable');

const {
    exigirDev, OBRAS, DOCUMENTOS, EQUIPO, ENTREGAS_EPP, ACTIVIDADES, ACCIDENTES, PRESCRIPCIONES, PERFIL,
} = sembrador;

/** Corre `exigirDev` atrapando el `process.exit` en vez de morirse. */
function intentarStage(stage) {
    const exitReal = process.exit;
    const errReal = console.error;
    let codigo = null;
    process.exit = (c) => { codigo = c; throw new Error('__salio__'); };
    console.error = () => {};
    try {
        exigirDev(stage);
        return { salio: false, codigo: null };
    } catch (err) {
        if (err.message !== '__salio__') throw err;
        return { salio: true, codigo };
    } finally {
        process.exit = exitReal;
        console.error = errReal;
    }
}

/** Claves de un objeto literal declarado en un archivo fuente del backend. */
function clavesDeCatalogo(archivo, nombre) {
    const fuente = fs.readFileSync(path.join(__dirname, '..', archivo), 'utf8');
    const i = fuente.indexOf(`const ${nombre} = {`);
    assert.notStrictEqual(i, -1, `No se encontró ${nombre} en ${archivo}`);
    // Hasta el primer cierre a la izquierda del margen: los literales del
    // backend se declaran en el nivel superior del módulo.
    const fin = fuente.indexOf('\n};', i);
    const cuerpo = fuente.slice(i, fin);
    return new Set([...cuerpo.matchAll(/^\s{4}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]));
}

// ─── La guarda de ambiente ───────────────────────────────────────────────────

test('solo siembra en dev: cualquier otro ambiente lo rechaza y sale con código 2', () => {
    for (const stage of ['prod', 'produccion', 'testeo', 'Dev', 'DEV', '', null, undefined]) {
        const r = intentarStage(stage);
        assert.ok(r.salio, `aceptó --stage ${JSON.stringify(stage)}, y no debe`);
        assert.strictEqual(r.codigo, 2, `salió con ${r.codigo} en vez de 2 para ${JSON.stringify(stage)}`);
    }
});

test('en dev no estorba: deja seguir', () => {
    const r = intentarStage('dev');
    assert.strictEqual(r.salio, false, 'se negó a correr en dev');
});

// ─── Separación del e2e ──────────────────────────────────────────────────────

test('la marca y el archivo de pendientes no se pisan con los del e2e', () => {
    const e2e = desechable.PERFILES.E2E;
    const demo = desechable.PERFILES.DEMO;

    assert.notStrictEqual(demo.marca, e2e.marca, 'comparten marca: la purga del e2e borraría los datos de ejemplo');
    assert.notStrictEqual(demo.clave, e2e.clave, 'comparten archivo de pendientes');
    assert.ok(!demo.marca.startsWith(e2e.marca), 'la marca DEMO empieza con la del e2e: su comprobación la aceptaría');
    assert.ok(!e2e.marca.startsWith(demo.marca), 'la marca del e2e empieza con la DEMO');
    assert.strictEqual(PERFIL, demo, 'el sembrador no está usando el perfil DEMO');
});

test('el perfil del e2e queda como estaba, incluido el nombre de su archivo', () => {
    // Si esto cambia, una corrida anterior del e2e deja pendientes que la
    // siguiente ya no encuentra, y la empresa desechable queda viva en dev.
    assert.strictEqual(desechable.PERFILES.E2E.marca, 'E2E desechable');
    assert.strictEqual(desechable.PERFILES.E2E.clave, 'e2e');
    assert.strictEqual(desechable.MARCA, 'E2E desechable', 'MARCA dejó de ser la del e2e');
});

// ─── Que la API acepte lo que se siembra ─────────────────────────────────────

test('todos los tipos de documento existen en el catálogo del handler', () => {
    const validos = clavesDeCatalogo('handlers/documents/handler.js', 'DOCUMENT_TYPES');
    assert.ok(validos.size > 20, `se leyeron solo ${validos.size} tipos: el catálogo no se parseó bien`);
    for (const d of DOCUMENTOS) {
        assert.ok(validos.has(d.tipo), `el tipo de documento "${d.tipo}" no existe: la API lo rechazaría`);
    }
});

test('todos los tipos de actividad existen en el catálogo del handler', () => {
    const validos = clavesDeCatalogo('handlers/activities/handler.js', 'ACTIVITY_TYPES');
    assert.ok(validos.size >= 5, `se leyeron solo ${validos.size} tipos de actividad`);
    for (const a of ACTIVIDADES) {
        assert.ok(validos.has(a.tipo), `el tipo de actividad "${a.tipo}" no existe`);
    }
});

test('las actividades que exigen tema tratado lo llevan', () => {
    // CHARLA_5MIN y ART no se crean sin planificación con tema: la API devuelve
    // 400 y la siembra muere con la empresa a medio hacer.
    const fuente = fs.readFileSync(path.join(__dirname, '..', 'lib/catalogos-actividad.js'), 'utf8');
    const m = fuente.match(/const TIPOS_CON_PLANIFICACION = \[([^\]]+)\]/);
    assert.ok(m, 'no se encontró TIPOS_CON_PLANIFICACION');
    const exigen = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    assert.ok(exigen.size > 0, 'se leyó una lista vacía de tipos que exigen tema');

    for (const a of ACTIVIDADES) {
        if (!exigen.has(a.tipo)) continue;
        const tema = a.planificacion?.tema;
        assert.ok(tema && (tema.codigo || tema.otro),
            `la actividad "${a.titulo}" es ${a.tipo} y no lleva tema tratado: la API la rechaza`);
    }
});

test('los motivos de reposición de EPP son los que acepta EppService', () => {
    const fuente = fs.readFileSync(path.join(__dirname, '..', 'lib/services/EppService.js'), 'utf8');
    const linea = fuente.match(/const MOTIVOS_REPOSICION = \[([^\]]+)\]/);
    assert.ok(linea, 'no se encontró MOTIVOS_REPOSICION');
    const validos = new Set([...linea[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

    for (const e of ENTREGAS_EPP) {
        if (!e.reposicion) {
            assert.strictEqual(e.motivo, null, 'una entrega que no es reposición no lleva motivo');
            continue;
        }
        assert.ok(validos.has(e.motivo), `el motivo "${e.motivo}" no es válido: ${[...validos].join(', ')}`);
    }
});

test('cada ítem de EPP lleva descripción, que es el único campo que se guarda', () => {
    // EppService.crearEntrega hace `String(item.descripcion || '').trim()`: una
    // cadena suelta se guarda con descripción VACÍA y sin error, y la entrega
    // queda inservible como evidencia del Art. 13.
    const fuente = fs.readFileSync(path.join(__dirname, '..', 'lib/services/EppService.js'), 'utf8');
    assert.ok(fuente.includes('descripcion: String(item.descripcion'),
        'EppService dejó de leer item.descripcion: revisar qué campo guarda ahora');

    for (const e of ENTREGAS_EPP) {
        assert.ok(Array.isArray(e.items) && e.items.length > 0, 'una entrega no tiene ítems');
        for (const it of e.items) {
            assert.strictEqual(typeof it, 'object', `el ítem ${JSON.stringify(it)} es una cadena: se guardaría sin descripción`);
            assert.ok(it.descripcion && String(it.descripcion).trim(), `un ítem no tiene descripción: ${JSON.stringify(it)}`);
        }
    }
});

test('los roles del equipo existen en el modelo de persona', () => {
    const { ROLES } = require('../lib/models/Persona');
    for (const m of EQUIPO) {
        assert.ok(ROLES[m.rol], `el rol "${m.rol}" no existe en el modelo`);
    }
});

// ─── Que el dato sirva para lo que se sembró ─────────────────────────────────

test('el reparto de documentos distingue práctica de empresa de gestión de obra', () => {
    const faltantes = DOCUMENTOS.map((d) => OBRAS.length - d.en.length);

    // El caso estrella del ticket: un documento que tiene UNA sola obra. Es el
    // extremo que hace evidente la lectura "esto no es de la obra, es de la
    // empresa", y sigue siendo comparable porque hay una obra que sí lo tiene.
    assert.strictEqual(Math.max(...faltantes), OBRAS.length - 1,
        `el documento más ausente falta en ${Math.max(...faltantes)} de ${OBRAS.length} obras, y tiene que faltar en ${OBRAS.length - 1}: una sola obra lo acredita`);

    // El panel ORDENA las brechas por cuántas obras las tienen. Con un solo
    // nivel sistémico no hay nada que ordenar y el orden no se puede probar.
    const sistemicos = new Set(faltantes.filter((f) => f >= 3));
    assert.ok(sistemicos.size >= 2,
        `todas las brechas sistémicas faltan en la misma cantidad de obras (${[...sistemicos]}): no hay ranking que probar`);

    // Y el contraste: si todo fuera sistémico, el umbral no se podría probar.
    assert.ok(faltantes.some((f) => f >= 3), 'ningún documento llega al umbral de práctica de empresa');
    assert.ok(faltantes.some((f) => f === 1 || f === 2), 'ningún documento queda como gestión de obra');
    assert.ok(faltantes.some((f) => f === 0), 'ningún documento está acreditado en todas las obras');

    for (const d of DOCUMENTOS) {
        assert.ok(d.en.length > 0, `${d.tipo} no se siembra en ninguna obra`);
        const claves = new Set(OBRAS.map((o) => o.clave));
        for (const c of d.en) assert.ok(claves.has(c), `${d.tipo} apunta a la obra "${c}", que no existe`);
        assert.strictEqual(new Set(d.en).size, d.en.length, `${d.tipo} repite una obra`);
    }
});

test('las dotaciones cruzan el umbral que cambia qué ítems son exigibles', () => {
    // El comité paritario se exige sobre 25 personas. Si todas las obras
    // estuvieran del mismo lado, el panel no podría mostrar que el porcentaje
    // se calcula sobre lo exigible a cada una.
    const dotaciones = OBRAS.map((o) => o.dotacion);
    assert.ok(dotaciones.some((d) => d < 25), 'ninguna obra queda bajo las 25 personas');
    assert.ok(dotaciones.some((d) => d > 25), 'ninguna obra pasa las 25 personas');
    for (const o of OBRAS) {
        assert.strictEqual(typeof o.dotacion, 'number', `la dotación de ${o.nombre} no es un número`);
        assert.ok(o.dotacion > 0, `la dotación de ${o.nombre} no es positiva`);
    }
});

test('las obras no repiten código ni nombre', () => {
    const codigos = OBRAS.map((o) => o.codigo);
    const nombres = OBRAS.map((o) => o.nombre);
    assert.strictEqual(new Set(codigos).size, codigos.length, 'hay códigos de obra repetidos: el alta los rechaza');
    assert.strictEqual(new Set(nombres).size, nombres.length, 'hay nombres de obra repetidos');
});

test('el supervisor y el prevencionista van antes que los trabajadores', () => {
    // La API se niega a asignar a una persona trabajadora a una obra que ya tiene
    // supervisores sin decir de qué cuadrilla es. Si el orden se invirtiera, el
    // supervisor todavía no existiría al armar la cuadrilla y la siembra fallaría
    // a la mitad, con la empresa a medio crear.
    const posicion = (rol) => EQUIPO.findIndex((m) => m.rol === rol);
    const primerTrabajador = posicion('trabajador');
    assert.notStrictEqual(primerTrabajador, -1, 'no hay trabajadores en el equipo');
    assert.ok(posicion('supervisor') !== -1 && posicion('supervisor') < primerTrabajador,
        'el supervisor no se crea antes del primer trabajador: la cuadrilla quedaría sin jefe');
    assert.ok(posicion('prevencionista') !== -1 && posicion('prevencionista') < primerTrabajador,
        'el prevencionista no se crea antes del primer trabajador');
});

test('hay quien pueda relatar una actividad y quien pueda recibir EPP', () => {
    assert.ok(EQUIPO.some((m) => m.rol === 'prevencionista' || m.rol === 'jefe_obra'),
        'sin prevencionista ni jefe de obra no hay relator para las actividades');
    assert.ok(EQUIPO.some((m) => m.rol === 'trabajador'),
        'sin trabajadores no hay a quién entregarle EPP');
});

// ─── El PDF que se adjunta ───────────────────────────────────────────────────

test('el PDF sembrado es un PDF válido, con su xref apuntando bien', () => {
    // Un adjunto roto se confunde con un error del visor, y el documento se abre
    // desde la aplicación. La tabla xref es lo que un lector estricto necesita:
    // si un desplazamiento no cae sobre su objeto, el archivo no se abre.
    const { pdfDeUnaPagina } = require('../scripts/e2e/pdf-minimo');
    const pdf = pdfDeUnaPagina('Plan de gestión ante emergencias', ['Obra: Edificio Las Condes 1420']);

    assert.ok(pdf.length > 300, `el PDF pesa ${pdf.length} bytes: quedó vacío`);
    assert.ok(pdf.subarray(0, 8).toString('latin1') === '%PDF-1.4', 'no empieza con la cabecera de PDF');
    assert.ok(pdf.toString('latin1').trimEnd().endsWith('%%EOF'), 'no termina con %%EOF');

    const texto = pdf.toString('latin1');
    const inicio = Number(texto.match(/startxref\s+(\d+)/)[1]);
    assert.strictEqual(texto.slice(inicio, inicio + 4), 'xref', 'startxref no apunta a la tabla');

    const filas = texto.slice(inicio).split('\n');
    const cuantos = Number(filas[1].split(/\s+/)[1]);
    assert.ok(cuantos >= 6, `la xref declara ${cuantos} objetos`);
    for (let i = 1; i < cuantos; i++) {
        const desplazamiento = Number(filas[1 + i + 1].split(/\s+/)[0]);
        assert.strictEqual(
            texto.slice(desplazamiento, desplazamiento + `${i} 0 obj`.length), `${i} 0 obj`,
            `el objeto ${i} no está donde dice la xref (${desplazamiento})`,
        );
    }
});

test('los acentos no salen como basura en la página', () => {
    // Las fuentes base de PDF usan Latin-1: un acento en UTF-8 crudo se ve como
    // dos caracteres raros. Se escriben como octales de un byte.
    const { pdfDeUnaPagina } = require('../scripts/e2e/pdf-minimo');
    const texto = pdfDeUnaPagina('Ampliación Clínica Maipú').toString('latin1');
    assert.ok(texto.includes('\\') && /Ampliaci\\\d{3}n/.test(texto),
        'la ó no quedó escapada como octal');
    assert.ok(!texto.includes('Ampliación'), 'el acento quedó en UTF-8 crudo dentro del PDF');
});

test('los documentos se siembran con archivo', () => {
    // "Sin archivo no hay documento" es la regla del motor (`tieneArchivo`). La
    // primera corrida sembró 79 documentos sin adjunto y el panel quedó sin una
    // sola brecha que mostrar, porque ninguno acreditaba nada.
    const fuente = fs.readFileSync(path.join(__dirname, '..', 'scripts/sembrar-demo-dev.js'), 'utf8');
    assert.ok(fuente.includes('subirPdf('), 'el sembrador dejó de subir archivos');
    assert.ok(/s3Key: adjunto\.s3Key/.test(fuente), 'el documento no se crea con su s3Key');
    assert.ok(fuente.includes("'x-amz-checksum-sha256'"),
        'falta la huella en el PUT: el bucket con Object Lock la exige');
});

// ─── Accidentes y medidas prescritas ────────────────────────────────────────

test('los accidentes usan gravedades que el backend reconoce', () => {
    const fuente = fs.readFileSync(path.join(__dirname, '..', 'lib/services/RegistroService.js'), 'utf8');
    for (const g of ['leve', 'grave', 'fatal']) {
        assert.ok(fuente.includes(`gravedad === '${g}'`), `RegistroService ya no cuenta la gravedad "${g}"`);
    }
    const validas = new Set(['leve', 'grave', 'fatal']);
    for (const a of ACCIDENTES) {
        assert.ok(validas.has(a.gravedad), `gravedad "${a.gravedad}" no se cuenta en los indicadores`);
        assert.ok(Number.isInteger(a.diasPerdidos) && a.diasPerdidos >= 0, `días perdidos inválidos en "${a.descripcion}"`);
        assert.ok(OBRAS.some((o) => o.clave === a.obra), `el accidente apunta a la obra "${a.obra}", que no existe`);
    }
});

test('la obra con mejor documentación también tiene accidentes', () => {
    // Es el caso que el cruce "cumple y accidenta" viene a mostrar: una carpeta
    // impecable no es lo mismo que una obra segura. Si los accidentes cayeran
    // solo en las obras atrasadas, el panel no tendría nada que contrastar y la
    // conclusión que invita a sacar seria la equivocada.
    const masDocumentada = DOCUMENTOS
        .flatMap((d) => d.en)
        .reduce((cuenta, clave) => cuenta.set(clave, (cuenta.get(clave) || 0) + 1), new Map());
    const mejor = [...masDocumentada.entries()].sort((a, b) => b[1] - a[1])[0][0];
    assert.ok(ACCIDENTES.some((a) => a.obra === mejor),
        `la obra mejor documentada (${mejor}) no registra accidentes: el cruce queda sin su caso interesante`);
});

test('hay medidas prescritas vencidas y en plazo', () => {
    // El estado lo deriva el servidor del plazo. Sin plazos pasados no hay
    // ninguna `Vencida` y el panel de medidas queda vacío; sin plazos futuros no
    // se puede comprobar que no marca vencido lo que todavía corre.
    const origenes = new Set(['OrganismoFiscalizador', 'OrganismoAdministrador',
        'DepartamentoPrevencion', 'ComiteParitario']);
    assert.ok(PRESCRIPCIONES.some((p) => p.diasPlazo < 0), 'ninguna medida tiene el plazo cumplido');
    assert.ok(PRESCRIPCIONES.some((p) => p.diasPlazo > 0), 'ninguna medida está todavía en plazo');
    for (const p of PRESCRIPCIONES) {
        assert.ok(origenes.has(p.origen), `origen "${p.origen}" no es uno de los cuatro del Art. 70`);
        assert.ok(OBRAS.some((o) => o.clave === p.obra), `la medida apunta a la obra "${p.obra}", que no existe`);
    }
});

test('las medidas vencidas se reparten en más de una obra', () => {
    // "Obras afectadas" es el contador que muestra el panel: con todas las
    // vencidas en la misma obra siempre diría uno y no se vería que agrega.
    const obrasVencidas = new Set(PRESCRIPCIONES.filter((p) => p.diasPlazo < 0).map((p) => p.obra));
    assert.ok(obrasVencidas.size >= 2,
        `las medidas vencidas están todas en ${[...obrasVencidas]}: el contador de obras afectadas no se ejercita`);
});
