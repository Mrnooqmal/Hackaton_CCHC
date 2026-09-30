// HTML armado con texto de personas: todo pasa por un solo escapado, y nada ejecuta lo que escribe un usuario.
//
// El 28 de septiembre de 2026 el Registro AT/EP y la impresión de incidentes
// del frontend interpolaban sin escapar la descripción de un hallazgo, el centro
// de trabajo y el nombre del trabajador, y abrían ese HTML con el origen de la
// aplicación. Cualquier sesión podía reportar un hallazgo con un `<script>` y
// robar el token de quien generara el informe. Había además cuatro escapados
// distintos en el backend (tres sin la comilla simple) y correos sin ninguno.
//
// Tres defensas:
//   1. Los sumideros de HTML (innerHTML, document.write, dangerouslySetInnerHTML,
//      Blob text/html…) solo pueden estar en una lista revisada. Uno nuevo en
//      otro archivo hace fallar esta prueba: hay que revisarlo y agregarlo acá.
//   2. Un solo escapado por lado (`Backend/lib/escaparHtml.js` y su gemelo del
//      frontend), que dan exactamente lo mismo, y ninguna otra copia.
//   3. Sabotaje real: cada plantilla se ejecuta con datos normales y con datos
//      maliciosos. El HTML resultante tiene que tener EXACTAMENTE la misma
//      secuencia de etiquetas (con sus atributos): si el texto de una persona no
//      crea ni una etiqueta ni un atributo, no hay nada que se pueda ejecutar.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const RAIZ = path.join(__dirname, '..', '..');
const FRONT = path.join(RAIZ, 'Frontend', 'src');
const BACK = path.join(RAIZ, 'Backend');

const { escaparHtml } = require('../lib/escaparHtml');

// ─── Recorrido de archivos ───────────────────────────────────────────────────

const archivos = (dir, exts) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return ['node_modules', '.serverless', 'dist', 'tests'].includes(d.name) ? [] : archivos(p, exts);
    return exts.some((x) => d.name.endsWith(x)) ? [p] : [];
});
const rel = (p) => path.relative(RAIZ, p);
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ─── 1. Sumideros solo en la lista revisada ─────────────────────────────────

const SUMIDEROS = /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML|\bsrcdoc\b|createContextualFragment|parseFromString|type:\s*['"]text\/html/;

/** Revisados uno por uno. Agregar acá solo después de revisar que lo que entra
 *  está escapado. */
const SUMIDEROS_REVISADOS = {
    // El único lugar del frontend que convierte una cadena en documento: lo usan
    // los informes de ese mismo archivo (escapados) y el export del FUF, que
    // escapa el backend.
    'Frontend/src/utils/informesHtml.ts': 1,
};

test('los sumideros de HTML solo aparecen en la lista revisada', () => {
    const encontrados = {};
    for (const f of [...archivos(FRONT, ['.ts', '.tsx', '.js', '.jsx']), ...archivos(path.join(BACK, 'lib'), ['.js']), ...archivos(path.join(BACK, 'handlers'), ['.js'])]) {
        const lineas = sinComentarios(fs.readFileSync(f, 'utf8')).split('\n').filter((l) => SUMIDEROS.test(l));
        if (lineas.length) encontrados[rel(f)] = lineas.length;
    }
    assert.deepEqual(encontrados, SUMIDEROS_REVISADOS,
        'Apareció (o desapareció) un sumidero de HTML. Revisa que todo lo que entra esté escapado con escaparHtml y actualiza SUMIDEROS_REVISADOS.');
});

// ─── 2. Un solo escapado ─────────────────────────────────────────────────────

test('no hay otros escapados de HTML aparte de los dos helpers', () => {
    const copias = [];
    const PATRON = /replace\(\s*\/\[[^\]]*&[^\]]*<[^\]]*\]\/g/;
    for (const f of [...archivos(FRONT, ['.ts', '.tsx']), ...archivos(path.join(BACK, 'lib'), ['.js']), ...archivos(path.join(BACK, 'handlers'), ['.js'])]) {
        const r = rel(f);
        if (r === 'Backend/lib/escaparHtml.js' || r === 'Frontend/src/utils/escaparHtml.ts') continue;
        if (PATRON.test(fs.readFileSync(f, 'utf8'))) copias.push(r);
    }
    assert.deepEqual(copias, [], 'Usa lib/escaparHtml.js (backend) o utils/escaparHtml.ts (frontend).');
});

// Carga de TypeScript del frontend, transpilado al vuelo (sin tipos, a CommonJS).
let ts;
try { ts = require(path.join(RAIZ, 'Frontend', 'node_modules', 'typescript')); } catch { ts = null; }
const cargarTs = (archivo) => {
    assert.ok(ts, 'Falta Frontend/node_modules/typescript: corre `npm ci` en Frontend. Esta prueba de seguridad no se salta.');
    const anterior = Module._extensions['.ts'];
    Module._extensions['.ts'] = (m, nombre) => {
        const { outputText } = ts.transpileModule(fs.readFileSync(nombre, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        });
        m._compile(outputText, nombre);
    };
    try { return require(archivo); } finally { Module._extensions['.ts'] = anterior; }
};

const MUESTRAS = [
    '', 'texto normal', 'Pérez & Hijos', '<script>alert(1)</script>', `"'><img src=x onerror=alert(1)>`,
    'a < b > c', "O'Higgins", '&amp; ya escapado', null, undefined, 0, 42, true,
];

test('el escapado del frontend y el del backend dan exactamente lo mismo', () => {
    const { escaparHtml: delFrontend } = cargarTs(path.join(FRONT, 'utils', 'escaparHtml.ts'));
    for (const m of MUESTRAS) assert.equal(delFrontend(m), escaparHtml(m), `difieren en ${JSON.stringify(m)}`);
});

test('el escapado cubre los cinco caracteres, comillas incluidas', () => {
    assert.equal(escaparHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    assert.equal(escaparHtml(null), '');
    assert.equal(escaparHtml(0), '0');
});

// ─── 3. Sabotaje: el texto de una persona no crea etiquetas ─────────────────

const ATAQUE = `</td></tr></table><script>window.__pwned=1</script><img src=x onerror="window.__pwned=1">"'`;
const NORMAL = 'Caída desde andamio en sector norte';

/** Todas las etiquetas del HTML, con sus atributos, en orden. */
const etiquetas = (html) => (html.match(/<[a-zA-Z!\/][^>]*>/g) || []);

/** Etiquetas con el dato de usuario (ya escapado) reemplazado por un marcador:
 *  un atributo puede llevar el dato legítimamente (un enlace), escapado. */
const esqueleto = (html, t) => etiquetas(html.split(escaparHtml(t)).join('§DATO§'));

/** Verifica que la plantilla no cambie de estructura con texto malicioso. */
const sinInyeccion = (nombre, render) => {
    const normal = render(NORMAL);
    const atacado = render(ATAQUE);
    assert.deepEqual(esqueleto(atacado, ATAQUE), esqueleto(normal, NORMAL), `${nombre}: el texto de usuario creó etiquetas o atributos`);
    assert.ok(!atacado.includes('<script>window.__pwned'), `${nombre}: el script llegó sin escapar`);
    assert.ok(!/<img[^>]*onerror/i.test(atacado), `${nombre}: el img con onerror llegó sin escapar`);
    assert.ok(atacado.includes('&lt;script&gt;window.__pwned=1&lt;/script&gt;'), `${nombre}: el texto se tiene que ver, escapado`);
};

test('sabotaje: un hallazgo con un script en la descripción no crea nada en el Registro AT/EP (al generar)', () => {
    const { htmlRegistroATEP } = cargarTs(path.join(FRONT, 'utils', 'informesHtml.ts'));
    const ahora = new Date('2026-09-28T12:00:00Z');
    sinInyeccion('Registro AT/EP', (t) => htmlRegistroATEP({
        obraNombre: t, firmante: t, ahora,
        incidentes: [
            { clasificacion: 'hallazgo', tipo: t, descripcion: t, trabajadorAfectado: t, estado: t, responsable: t, fecha: '2026-09-01' },
            { clasificacion: 'incidente', tipo: 'accidente', titulo: t, personaAfectada: t, estado: 'cerrado', creadoPor: t },
        ],
    }));
});

test('sabotaje: el mismo hallazgo no crea nada en la impresión de incidentes (al imprimir)', () => {
    const { htmlImpresionIncidentes } = cargarTs(path.join(FRONT, 'utils', 'informesHtml.ts'));
    const ahora = new Date('2026-09-28T12:00:00Z');
    sinInyeccion('Impresión de incidentes', (t) => htmlImpresionIncidentes({
        ahora, tipoLabel: (x) => x,
        stats: { numeroAccidentes: t, tasaAccidentabilidad: 1.5, diasPerdidos: t, siniestralidad: t, masaLaboral: t },
        incidents: [{ fecha: t, tipo: t, centroTrabajo: t, trabajadorNombre: t, gravedad: t, estado: t }],
    }));
});

// Backend: los informes que se guardan en S3 como evidencia y el export del FUF.

/** Objeto donde TODO campo de texto vale `t`: para no depender de adivinar qué
 *  campo usa cada plantilla. Los arreglos traen un elemento. */
const ARREGLOS = /^(incidentes|actividadesPreventivas|documentos|entregasEpp|listaHechos|causasRaiz|entrevistados|medidasCorrectivas|personas|firmantes|requisitos|bloques|items|Items|asistentes|evidencias|organos|protocolos)$/;
const relleno = (t, profundidad = 0) => new Proxy({}, {
    get: (_, p) => {
        if (p === Symbol.toPrimitive || p === 'toString' || p === 'toJSON') return () => t;
        if (typeof p === 'symbol') return undefined;
        if (profundidad < 3 && ARREGLOS.test(p)) return [relleno(t, profundidad + 1)];
        if (profundidad < 3 && /^(indicadores|totales|miper|vigilanciaSalud|afectado|accidente|resumen|empresa|obra|periodo)$/.test(p)) return relleno(t, profundidad + 1);
        return t;
    },
});

test('sabotaje: los informes que se guardan en S3 no ejecutan texto de usuario', () => {
    const { RegistroService } = require('../lib/services/RegistroService');
    const firma = (t) => ({ token: t, fecha: t, horario: t, nombre: t, rut: t });
    sinInyeccion('Registro AT/EP (S3)', (t) => RegistroService.renderHtml(relleno(t), firma(t)));
    sinInyeccion('Informe de investigación (S3)', (t) => RegistroService.renderInvestigacionHtml(relleno(t), firma(t)));
    sinInyeccion('Expediente', (t) => RegistroService.renderExpedienteHtml(relleno(t)));
});

test('sabotaje: el export del FUF no ejecuta texto de usuario', () => {
    const { renderHtml } = require('../lib/completitud-export');
    sinInyeccion('Export FUF', (t) => renderHtml({
        nombreEmpresa: t, nombreObra: t, generadoEn: '2026-09-28T12:00:00Z',
        resumen: { cumplidos: 1, exigibles: 2, progreso: 50 },
        bloques: [{ titulo: t, resumen: { cumplidos: 1, exigibles: 2, progreso: 50 },
            requisitos: [{ item: t, titulo: t, estado: 'cumple', justificacion: t, detalle: t }] }],
    }));
});

// Correos de SES: no se ejecutan en un navegador de la app, pero HTML inyectado
// en un correo sirve para phishing con el nombre de la plataforma.
test('sabotaje: los correos de SES escapan nombres, empresas y mensajes', async () => {
    const { SESClient } = require('@aws-sdk/client-ses');
    const original = SESClient.prototype.send;
    const enviados = [];
    SESClient.prototype.send = async (cmd) => { enviados.push(cmd.input.Message.Body.Html.Data); return {}; };
    // Antes de enviar se consulta la lista de suprimidas (lib/correo.js): vacía.
    const { docClient } = require('../lib/clients/dynamodb');
    const enviarDynamo = docClient.send;
    docClient.send = async (cmd) => {
        if (cmd.input?.TableName === process.env.CORREOS_SUPRIMIDOS_TABLE) return {};
        return enviarDynamo.call(docClient, cmd);
    };
    const hmacAntes = process.env.CAMPO_HMAC_KEY;
    process.env.CORREOS_SUPRIMIDOS_TABLE = process.env.CORREOS_SUPRIMIDOS_TABLE || 'CORREOS_SUPRIMIDOS_TABLE';
    process.env.CAMPO_HMAC_KEY = hmacAntes || 'clave-de-prueba-hmac';
    try {
        const n = require('../handlers/notifications/handler');
        const correos = async (t) => {
            enviados.length = 0;
            await n.sendWelcomeEmail('a@ejemplo.cl', t, t, t);
            await n.sendPasswordResetEmail('a@ejemplo.cl', t, `https://x/?t=${t}`, 30);
            await n.sendOnboardingLicenseEmail('a@ejemplo.cl', `https://x/?t=${t}`, 7, t);
            await n.sendPinRestablecidoEmail('a@ejemplo.cl', t, { porNombre: t, fecha: t, horario: t, motivo: t });
            return enviados.join('\n<hr>\n');
        };
        const normal = await correos(NORMAL);
        const atacado = await correos(ATAQUE);
        assert.equal(enviados.length, 4);

        // El correo de sugerencias lleva el mensaje libre de cualquier usuario.
        const { docClient } = require('../lib/clients/dynamodb');
        const originalDynamo = docClient.send;
        docClient.send = async () => ({});
        try {
            const sugerencias = require('../handlers/suggestions/handler');
            const sugerencia = async (t) => {
                enviados.length = 0;
                await sugerencias.create({
                    requestContext: { http: { method: 'POST' }, authorizer: { lambda: { sessionId: 's', personaId: 'p', tenantId: 't', rol: 'trabajador', permisos: '' } } },
                    body: JSON.stringify({ userName: t, message: `${t}\n${t}`, source: t }),
                });
                return enviados.join('');
            };
            const sn = await sugerencia(NORMAL);
            const sa = await sugerencia(ATAQUE);
            assert.ok(sn.length > 0, 'se envió el correo de sugerencias');
            assert.deepEqual(esqueleto(sa, ATAQUE), esqueleto(sn, NORMAL), 'el correo de sugerencias creó etiquetas con texto de usuario');
        } finally {
            docClient.send = originalDynamo;
        }
        assert.deepEqual(esqueleto(atacado, ATAQUE), esqueleto(normal, NORMAL), 'un correo creó etiquetas con texto de usuario');
        assert.ok(!atacado.includes('<script>window.__pwned'));
    } finally {
        SESClient.prototype.send = original;
        docClient.send = enviarDynamo;
        if (hmacAntes === undefined) delete process.env.CAMPO_HMAC_KEY; else process.env.CAMPO_HMAC_KEY = hmacAntes;
    }
});
