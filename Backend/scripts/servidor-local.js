#!/usr/bin/env node
/**
 * Servidor local contra los recursos REALES de dev.
 *
 * Varias personas comparten el ambiente `dev` y se pisan el backend al
 * desplegar. Este servidor ejecuta los handlers del código que tienes en el
 * árbol de trabajo, en http://localhost:3001, sin desplegar nada.
 *
 * Por qué no `serverless offline` (`npm run dev`): fuerza IS_OFFLINE=true, y con
 * eso `lib/clients/s3.js` apunta a LocalStack (que no usamos), y las variables
 * que en `serverless.yml` son `!Ref`/`!GetAtt` (llave KMS del cifrado de campo,
 * colas SQS, nombres de tablas) no se resuelven fuera de AWS.
 *
 * Cómo se resuelve cada cosa:
 *
 *   - Variables de entorno: se leen de las Lambdas YA desplegadas de dev
 *     (`aws lambda list-functions`, prefijo `BuildAndServe-dev-`), que traen
 *     tablas, buckets, id de la llave KMS y colas ya resueltos. Cada handler corre
 *     con las variables de SU función. IS_OFFLINE se fuerza a 'false' para que S3
 *     vaya al bucket real. Se leen una sola vez, al arrancar.
 *   - Rutas: salen de los eventos `httpApi` de `serverless.yml` de ESTE árbol (no
 *     de las rutas desplegadas: el código local puede ir adelantado). Se usa un
 *     lector mínimo de YAML propio, no `serverless print`: este necesita sesión
 *     de Serverless, acceso a AWS y resolver los `${cf:...}` (varios segundos), y
 *     el backend no trae parser de YAML. El lector solo entiende lo que usa
 *     `serverless.yml` en las secciones `custom`, `provider` y `functions`; si el
 *     archivo cambia de forma, falla con un mensaje claro en vez de adivinar.
 *   - Autorizador: se ejecuta el real (`handlers/auth/authorizer.js`).
 *   - CORS: métodos, cabeceras y max-age salen de `provider.httpApi.cors`; los
 *     orígenes, de `custom.corsOrigins.dev`, salvo los que dependen de un
 *     `${cf:...}` (el dominio de CloudFront de dev), que no se pueden resolver
 *     acá y no hacen falta para trabajar en local.
 *
 * Lo que NO hace: procesar las colas (SQS dispara la Lambda desplegada de dev,
 * con el código desplegado, no con este), ni los disparadores programados.
 *
 * Recarga: basta con reiniciar el servidor. Con `--recargar` además se vuelve a
 * cargar el código de `handlers/` y `lib/` en cada petición.
 *
 * Uso:  node scripts/servidor-local.js [--puerto 3001] [--stage dev] [--recargar]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PREFIJO_FUNCIONES = 'BuildAndServe';
const STAGE_PERMITIDO = 'dev';
const PUERTO_POR_DEFECTO = 3001;
const MAX_BODY = 10 * 1024 * 1024; // el tope de API Gateway para el cuerpo

// ---------------------------------------------------------------------------
// Ambiente
// ---------------------------------------------------------------------------

/**
 * Solo `dev`. Este servidor escribe en recursos reales con las credenciales de
 * quien lo corre: apuntarlo a prod por un descuido sería un incidente.
 */
function validarAmbiente(stage) {
    const s = stage === undefined || stage === null || stage === '' ? STAGE_PERMITIDO : String(stage);
    if (s !== STAGE_PERMITIDO) {
        throw new Error(`El servidor local solo trabaja contra "${STAGE_PERMITIDO}" (se pidió "${s}"). `
            + 'No se conecta a otros ambientes.');
    }
    return s;
}

function leerArgumentos(argv) {
    const op = { puerto: PUERTO_POR_DEFECTO, stage: undefined, recargar: false };
    for (let i = 0; i < argv.length; i++) {
        const [clave, valorEnLinea] = argv[i].split(/=(.*)/s);
        const siguiente = () => (valorEnLinea !== undefined ? valorEnLinea : argv[++i]);
        if (clave === '--stage') op.stage = siguiente();
        else if (clave === '--puerto' || clave === '--port') {
            const p = Number(siguiente());
            if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('--puerto debe ser un número entre 1 y 65535.');
            op.puerto = p;
        } else if (clave === '--recargar') op.recargar = true;
        else throw new Error(`Argumento desconocido: ${argv[i]}`);
    }
    return op;
}

// ---------------------------------------------------------------------------
// Lector mínimo de YAML
// ---------------------------------------------------------------------------

/**
 * Convierte el texto en líneas con sangría. Los bloques `|` y `>` se pliegan en
 * una sola cadena (su contenido puede parecer YAML) y los comentarios se quitan
 * respetando las comillas.
 */
function prepararLineas(texto) {
    const crudas = texto.replace(/\r/g, '').split('\n');
    const lineas = [];
    for (let i = 0; i < crudas.length; i++) {
        const cruda = crudas[i];
        const sangria = cruda.length - cruda.trimStart().length;
        let contenido = quitarComentario(cruda.trim());
        if (!contenido) continue;
        if (/(^|\s)[|>][+-]?\d*$/.test(contenido)) {
            const cuerpo = [];
            while (i + 1 < crudas.length) {
                const sig = crudas[i + 1];
                if (sig.trim() === '' || sig.length - sig.trimStart().length > sangria) { cuerpo.push(sig.trim()); i++; } else break;
            }
            contenido = contenido.replace(/\s*[|>][+-]?\d*$/, '');
            const valor = cuerpo.join('\n');
            contenido = contenido === '-' || contenido.endsWith(':') ? `${contenido} ${JSON.stringify(valor)}` : contenido;
        }
        lineas.push({ sangria, contenido });
    }
    return lineas;
}

function quitarComentario(s) {
    let comilla = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (comilla) { if (c === comilla) comilla = null; continue; }
        if ((c === '"' || c === "'") && (i === 0 || /[\s:[{,-]/.test(s[i - 1]))) comilla = c;
        else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trim();
    }
    return s;
}

const RE_CLAVE = /^("[^"]*"|'[^']*'|.+?):(?:\s+(.*))?$/;

function escalar(s) {
    const t = s.trim();
    if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
        if (t[0] === '"') { try { return JSON.parse(t); } catch { return t.slice(1, -1); } }
        return t.slice(1, -1).replace(/''/g, "'");
    }
    return t;
}

function parsearBloque(lineas, desde, sangria) {
    const l = lineas[desde];
    if (/^-(\s|$)/.test(l.contenido)) return parsearSecuencia(lineas, desde, sangria);
    if (RE_CLAVE.test(l.contenido)) return parsearMapa(lineas, desde, sangria);
    return { valor: escalar(l.contenido), siguiente: desde + 1 };
}

function parsearMapa(lineas, desde, sangria) {
    const mapa = {};
    let i = desde;
    while (i < lineas.length && lineas[i].sangria === sangria && !/^-(\s|$)/.test(lineas[i].contenido)) {
        const m = RE_CLAVE.exec(lineas[i].contenido);
        if (!m) throw new Error(`No se entiende la línea de serverless.yml: "${lineas[i].contenido}"`);
        const clave = escalar(m[1]);
        const resto = m[2] === undefined ? '' : m[2].trim();
        i++;
        if (resto !== '') { mapa[clave] = escalar(resto); continue; }
        const sig = lineas[i];
        if (sig && (sig.sangria > sangria || (sig.sangria === sangria && /^-(\s|$)/.test(sig.contenido)))) {
            const r = parsearBloque(lineas, i, sig.sangria);
            mapa[clave] = r.valor;
            i = r.siguiente;
        } else mapa[clave] = null;
    }
    return { valor: mapa, siguiente: i };
}

function parsearSecuencia(lineas, desde, sangria) {
    const lista = [];
    let i = desde;
    while (i < lineas.length && lineas[i].sangria === sangria && /^-(\s|$)/.test(lineas[i].contenido)) {
        const resto = lineas[i].contenido.replace(/^-\s*/, '');
        if (resto === '') {
            const sig = lineas[i + 1];
            if (sig && sig.sangria > sangria) {
                const r = parsearBloque(lineas, i + 1, sig.sangria);
                lista.push(r.valor);
                i = r.siguiente;
            } else { lista.push(null); i++; }
        } else if (RE_CLAVE.test(resto) && !/^["']/.test(resto)) {
            // `- clave: valor`: el resto de la línea es la primera clave de un mapa
            // cuya sangría es la del texto que sigue al guion.
            const sangriaMapa = sangria + (lineas[i].contenido.length - resto.length);
            const copia = lineas.slice();
            copia[i] = { sangria: sangriaMapa, contenido: resto };
            const r = parsearMapa(copia, i, sangriaMapa);
            lista.push(r.valor);
            i = r.siguiente;
        } else { lista.push(escalar(resto)); i++; }
    }
    return { valor: lista, siguiente: i };
}

/** Parsea un texto YAML de bloque (solo mapas, listas y escalares). */
function parsearYaml(texto) {
    const lineas = prepararLineas(texto);
    if (!lineas.length) return {};
    return parsearBloque(lineas, 0, lineas[0].sangria).valor;
}

/**
 * Extrae las secciones de primer nivel que se necesitan. El resto del archivo
 * (`resources`, con JSON en línea y bloques largos) no se toca.
 */
function seccionesDe(texto, nombres) {
    const lineas = texto.replace(/\r/g, '').split('\n');
    const salida = {};
    let actual = null;
    for (const linea of lineas) {
        const m = /^([A-Za-z][\w-]*):/.exec(linea);
        if (m) actual = nombres.includes(m[1]) ? m[1] : null;
        if (actual) (salida[actual] = salida[actual] || []).push(linea);
    }
    const resultado = {};
    for (const n of nombres) {
        const cuerpo = (salida[n] || []).slice(1).join('\n');
        resultado[n] = cuerpo ? parsearYaml(cuerpo) : {};
    }
    return resultado;
}

/**
 * Lee de `serverless.yml`: funciones, rutas, autorizadores y configuración CORS.
 */
function leerConfiguracion(rutaYml) {
    let texto;
    try { texto = fs.readFileSync(rutaYml, 'utf8'); } catch (err) {
        throw new Error(`No se pudo leer ${rutaYml}: ${err.message}`);
    }
    const { custom, provider, functions } = seccionesDe(texto, ['custom', 'provider', 'functions']);
    if (!functions || typeof functions !== 'object' || !Object.keys(functions).length) {
        throw new Error('No se encontró la sección `functions` en serverless.yml.');
    }
    const rutas = [];
    const funcionesCfg = {};
    for (const [nombre, def] of Object.entries(functions)) {
        if (!def || !def.handler) continue;
        funcionesCfg[nombre] = { handler: def.handler };
        for (const ev of Array.isArray(def.events) ? def.events : []) {
            if (!ev || ev.httpApi === undefined) continue;
            const h = ev.httpApi;
            let metodo; let ruta; let autorizador = null;
            if (typeof h === 'string') {
                const m = /^(\S+)\s+(\S+)$/.exec(h.trim());
                if (!m) throw new Error(`Evento httpApi no entendido en la función ${nombre}: "${h}"`);
                [, metodo, ruta] = m;
            } else {
                metodo = h.method; ruta = h.path;
                if (h.authorizer && h.authorizer.name) autorizador = h.authorizer.name;
            }
            if (!metodo || !ruta) throw new Error(`Evento httpApi sin path o method en la función ${nombre}.`);
            rutas.push(nuevaRuta(metodo, ruta, nombre, autorizador));
        }
    }
    if (!rutas.length) throw new Error('serverless.yml no declara ninguna ruta httpApi: no hay nada que servir.');

    const api = (provider && provider.httpApi) || {};
    const autorizadores = {};
    for (const [n, a] of Object.entries(api.authorizers || {})) if (a && a.functionName) autorizadores[n] = a.functionName;
    for (const r of rutas) {
        if (r.autorizador && !autorizadores[r.autorizador]) {
            throw new Error(`La ruta ${r.clave} usa el autorizador "${r.autorizador}", que no está en provider.httpApi.authorizers.`);
        }
        if (r.autorizador && !funcionesCfg[autorizadores[r.autorizador]]) {
            throw new Error(`El autorizador "${r.autorizador}" apunta a la función "${autorizadores[r.autorizador]}", que no existe.`);
        }
    }
    const cors = api.cors || {};
    const origenesDev = ((custom && custom.corsOrigins && custom.corsOrigins.dev) || []);
    return {
        rutas,
        funciones: funcionesCfg,
        autorizadores,
        cors: {
            // Los orígenes con `${...}` no se resuelven fuera de Serverless.
            origenes: (Array.isArray(origenesDev) ? origenesDev : []).filter((o) => typeof o === 'string' && !o.includes('${')),
            metodos: Array.isArray(cors.allowedMethods) ? cors.allowedMethods : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            cabeceras: Array.isArray(cors.allowedHeaders) ? cors.allowedHeaders : ['Content-Type', 'Authorization'],
            maxAge: cors.maxAge !== undefined ? Number(cors.maxAge) : 600,
        },
    };
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

function nuevaRuta(metodo, ruta, funcion, autorizador) {
    const m = String(metodo).toUpperCase();
    const p = ruta.startsWith('/') ? ruta : `/${ruta}`;
    const segmentos = p.split('/').filter(Boolean).map((s) => {
        const mm = /^\{(.+?)(\+?)\}$/.exec(s);
        if (!mm) return { tipo: 'literal', valor: s };
        return mm[2] ? { tipo: 'codicioso', nombre: mm[1] } : { tipo: 'parametro', nombre: mm[1] };
    });
    return { metodo: m, ruta: p, clave: `${m} ${p}`, segmentos, funcion, autorizador };
}

/** Devuelve los parámetros de ruta si `ruta` calza con `segs`, o `null`. */
function calzar(segmentosRuta, segmentosPeticion) {
    const params = {};
    for (let i = 0; i < segmentosRuta.length; i++) {
        const s = segmentosRuta[i];
        if (s.tipo === 'codicioso') {
            if (segmentosPeticion.length <= i) return null; // `{proxy+}` exige al menos un segmento
            params[s.nombre] = segmentosPeticion.slice(i).join('/');
            return params;
        }
        if (i >= segmentosPeticion.length) return null;
        if (s.tipo === 'literal') { if (s.valor !== segmentosPeticion[i]) return null; } else params[s.nombre] = segmentosPeticion[i];
    }
    return segmentosPeticion.length === segmentosRuta.length ? params : null;
}

const PESO = { literal: 2, parametro: 1, codicioso: 0 };

/** Positivo si `a` es más específica que `b` (el orden de API Gateway). */
function compararEspecificidad(a, b) {
    const n = Math.max(a.segmentos.length, b.segmentos.length);
    for (let i = 0; i < n; i++) {
        const pa = a.segmentos[i] ? PESO[a.segmentos[i].tipo] : -1;
        const pb = b.segmentos[i] ? PESO[b.segmentos[i].tipo] : -1;
        if (pa !== pb) return pa - pb;
    }
    // Mismo camino: el método explícito gana sobre ANY.
    return (a.metodo !== 'ANY' ? 1 : 0) - (b.metodo !== 'ANY' ? 1 : 0);
}

function buscarRuta(rutas, metodo, rutaPeticion) {
    let segmentos;
    try { segmentos = rutaPeticion.split('/').filter(Boolean).map(decodeURIComponent); } catch { return null; }
    let mejor = null;
    for (const r of rutas) {
        if (r.metodo !== 'ANY' && r.metodo !== String(metodo).toUpperCase()) continue;
        const params = calzar(r.segmentos, segmentos);
        if (!params) continue;
        if (!mejor || compararEspecificidad(r, mejor.ruta) > 0) mejor = { ruta: r, params };
    }
    return mejor;
}

// ---------------------------------------------------------------------------
// Evento de Lambda (HTTP API, payload 2.0) y respuesta
// ---------------------------------------------------------------------------

function esTexto(tipo) {
    if (!tipo) return true;
    return /^text\/|json|xml|javascript|x-www-form-urlencoded|^application\/graphql/i.test(tipo);
}

function armarEvento({ metodo, url, cabeceras, cuerpo, ip, ruta, parametros }) {
    const u = new URL(url, 'http://localhost');
    const headers = {};
    let cookies;
    for (const [k, v] of Object.entries(cabeceras)) {
        const valor = Array.isArray(v) ? v.join(',') : String(v);
        if (k.toLowerCase() === 'cookie') { cookies = valor.split(';').map((c) => c.trim()).filter(Boolean); continue; }
        headers[k.toLowerCase()] = valor;
    }
    const consulta = {};
    for (const [k, v] of u.searchParams) consulta[k] = k in consulta ? `${consulta[k]},${v}` : v;
    const hayCuerpo = cuerpo && cuerpo.length > 0;
    const binario = hayCuerpo && !esTexto(headers['content-type']);
    const ahora = new Date();
    const evento = {
        version: '2.0',
        routeKey: ruta ? ruta.clave : '$default',
        rawPath: u.pathname,
        rawQueryString: u.search.replace(/^\?/, ''),
        headers,
        requestContext: {
            accountId: 'local',
            apiId: 'local',
            domainName: headers.host || 'localhost',
            domainPrefix: 'local',
            http: {
                method: String(metodo).toUpperCase(),
                path: u.pathname,
                protocol: 'HTTP/1.1',
                sourceIp: ip || '127.0.0.1',
                userAgent: headers['user-agent'] || '',
            },
            requestId: `local-${ahora.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            routeKey: ruta ? ruta.clave : '$default',
            stage: '$default',
            time: ahora.toUTCString(),
            timeEpoch: ahora.getTime(),
        },
        isBase64Encoded: Boolean(binario),
    };
    if (cookies) evento.cookies = cookies;
    if (Object.keys(consulta).length) evento.queryStringParameters = consulta;
    if (parametros && Object.keys(parametros).length) evento.pathParameters = parametros;
    if (hayCuerpo) evento.body = binario ? cuerpo.toString('base64') : cuerpo.toString('utf8');
    return evento;
}

/**
 * Traduce lo que devuelve un handler a una respuesta HTTP. Igual que API
 * Gateway con payload 2.0: un string es el cuerpo; un objeto sin `statusCode`
 * se serializa como JSON con 200.
 */
function traducirRespuesta(resp) {
    const base = { estado: 200, cabeceras: {}, cookies: [], cuerpo: Buffer.alloc(0) };
    if (resp === undefined || resp === null) return { ...base, estado: 502, cuerpo: Buffer.from('{"message":"Internal Server Error"}'), cabeceras: { 'content-type': 'application/json' } };
    if (typeof resp === 'string') return { ...base, cuerpo: Buffer.from(resp), cabeceras: { 'content-type': 'application/json' } };
    if (typeof resp !== 'object') return { ...base, cuerpo: Buffer.from(JSON.stringify(resp)), cabeceras: { 'content-type': 'application/json' } };
    if (resp.statusCode === undefined) return { ...base, cuerpo: Buffer.from(JSON.stringify(resp)), cabeceras: { 'content-type': 'application/json' } };
    const cabeceras = {};
    for (const [k, v] of Object.entries(resp.headers || {})) if (v !== undefined && v !== null) cabeceras[k.toLowerCase()] = String(v);
    let cuerpo = Buffer.alloc(0);
    if (resp.body !== undefined && resp.body !== null) {
        cuerpo = resp.isBase64Encoded
            ? Buffer.from(String(resp.body), 'base64')
            : Buffer.from(typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body));
    }
    return { estado: Number(resp.statusCode) || 200, cabeceras, cookies: Array.isArray(resp.cookies) ? resp.cookies.map(String) : [], cuerpo };
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

/** Las cabeceras de una respuesta sin las `access-control-*` que haya puesto el handler. */
function sinCabecerasCors(cabeceras) {
    return Object.fromEntries(Object.entries(cabeceras).filter(([k]) => !k.toLowerCase().startsWith('access-control-')));
}

/** Cabeceras CORS de una respuesta; vacío si el origen no está permitido. */
function cabecerasCors(cors, origen, preflight) {
    if (!origen || !cors.origenes.includes(origen)) return {};
    const h = { 'access-control-allow-origin': origen, vary: 'Origin' };
    if (preflight) {
        h['access-control-allow-methods'] = cors.metodos.join(',');
        h['access-control-allow-headers'] = cors.cabeceras.join(',');
        h['access-control-max-age'] = String(cors.maxAge);
    }
    return h;
}

// ---------------------------------------------------------------------------
// Entorno real de dev
// ---------------------------------------------------------------------------

function ejecutarAws(args) {
    const opciones = { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
    try {
        return execFileSync('aws', args, opciones);
    } catch (err) {
        // En Windows `aws` puede ser un .cmd/.bat, que `execFileSync` sin shell no
        // encuentra. Los argumentos son fijos y sin comillas, así que es seguro.
        if (err.code === 'ENOENT' && process.platform === 'win32') return execFileSync('aws', args, { ...opciones, shell: true });
        throw err;
    }
}

/** Interpreta la salida de `aws lambda list-functions` y la deja por función. */
function entornosDeFunciones(salidaJson, stage) {
    const prefijo = `${PREFIJO_FUNCIONES}-${stage}-`;
    const funciones = {};
    for (const f of JSON.parse(salidaJson).Functions || []) {
        if (!f.FunctionName || !f.FunctionName.startsWith(prefijo)) continue;
        const entorno = {};
        for (const [k, v] of Object.entries((f.Environment && f.Environment.Variables) || {})) {
            // Las credenciales y la región son de quien corre el servidor, no de la Lambda.
            if (!k.startsWith('AWS_')) entorno[k] = v;
        }
        entorno.IS_OFFLINE = 'false';
        funciones[f.FunctionName.slice(prefijo.length)] = { entorno, timeout: Number(f.Timeout) || 6 };
    }
    return funciones;
}

function cargarEntornos(stage, region) {
    if (!/^[a-z0-9-]+$/.test(region)) throw new Error(`Región no válida: "${region}"`);
    let salida;
    try {
        salida = ejecutarAws(['lambda', 'list-functions', '--region', region, '--output', 'json', '--no-cli-pager']);
    } catch (err) {
        const detalle = (err.stderr ? String(err.stderr) : err.message).trim().split('\n').slice(-3).join(' | ');
        throw new Error(`No se pudo leer la configuración de las Lambdas de ${stage} con el AWS CLI `
            + `(¿AWS_PROFILE correcto y sesión iniciada?): ${detalle}`);
    }
    const funciones = entornosDeFunciones(salida, stage);
    if (!Object.keys(funciones).length) {
        throw new Error(`No hay Lambdas "${PREFIJO_FUNCIONES}-${stage}-*" en ${region} con este perfil de AWS.`);
    }
    return funciones;
}

// ---------------------------------------------------------------------------
// Ejecución de handlers
// ---------------------------------------------------------------------------

function limpiarCacheDeCodigo() {
    const carpetas = [path.join(RAIZ, 'handlers') + path.sep, path.join(RAIZ, 'lib') + path.sep];
    for (const k of Object.keys(require.cache)) if (carpetas.some((c) => k.startsWith(c))) delete require.cache[k];
}

/**
 * Carga handlers con el entorno de su función. Los módulos de `lib/` leen el
 * entorno al cargarse (nombres de tablas, buckets), así que antes de cargar cada
 * función se aplica su entorno y se descarta el caché de `handlers/` y `lib/`:
 * cada función tiene su propia copia de esos módulos, como en AWS. Limitación:
 * `process.env` es uno solo, de modo que si dos funciones con valores distintos
 * para una misma variable se ejecutan a la vez, una variable que se lea en
 * tiempo de ejecución (no al cargar) puede tomar el valor de la otra.
 */
function crearEjecutor({ funciones, entornos, recargar, region }) {
    const cargados = new Map();
    // Funciones nuevas en esta rama que aún no están desplegadas en dev: se les
    // da la unión de los entornos de dev (los nombres de recursos son los mismos).
    const unionEntornos = {};
    for (const f of Object.values(entornos)) Object.assign(unionEntornos, f.entorno);
    const avisadas = new Set();

    function cargar(nombre) {
        if (!recargar && cargados.has(nombre)) return cargados.get(nombre);
        const def = funciones[nombre];
        if (!def) throw new Error(`La función "${nombre}" no está en serverless.yml.`);
        const cfg = entornos[nombre];
        if (!cfg && !avisadas.has(nombre)) {
            avisadas.add(nombre);
            console.warn(`  Aviso: "${nombre}" no está desplegada en dev; se usa la unión de variables de las demás funciones.`);
        }
        const entorno = cfg ? cfg.entorno : { ...unionEntornos, IS_OFFLINE: 'false' };
        aplicarEntorno(entorno, region);
        limpiarCacheDeCodigo();
        const punto = def.handler.lastIndexOf('.');
        const modulo = require(path.join(RAIZ, def.handler.slice(0, punto)));
        const fn = modulo[def.handler.slice(punto + 1)];
        if (typeof fn !== 'function') throw new Error(`El handler ${def.handler} no es una función.`);
        const cargado = { fn, entorno, timeout: cfg ? cfg.timeout : 29 };
        cargados.set(nombre, cargado);
        return cargado;
    }

    return async function ejecutar(nombre, evento) {
        const h = cargar(nombre);
        aplicarEntorno(h.entorno, region);
        const limite = Math.min(h.timeout, 30) * 1000;
        const inicio = Date.now();
        const contexto = {
            functionName: `${PREFIJO_FUNCIONES}-${STAGE_PERMITIDO}-${nombre}`,
            awsRequestId: evento.requestContext.requestId,
            getRemainingTimeInMillis: () => Math.max(0, limite - (Date.now() - inicio)),
        };
        let temporizador;
        const agotado = new Promise((_, rechazar) => {
            temporizador = setTimeout(() => rechazar(Object.assign(new Error('timeout'), { esTimeout: true })), limite);
        });
        try {
            return await Promise.race([Promise.resolve(h.fn(evento, contexto)), agotado]);
        } finally {
            clearTimeout(temporizador);
        }
    };
}

function aplicarEntorno(entorno, region) {
    for (const [k, v] of Object.entries(entorno)) process.env[k] = v;
    process.env.IS_OFFLINE = 'false';
    process.env.AWS_REGION = process.env.AWS_REGION || region;
    process.env.AWS_DEFAULT_REGION = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION;
}

// ---------------------------------------------------------------------------
// Servidor HTTP
// ---------------------------------------------------------------------------

function leerCuerpo(req) {
    return new Promise((resolver, rechazar) => {
        const partes = [];
        let total = 0;
        // Pasado el tope se sigue LEYENDO (y descartando) hasta el final: cerrar la
        // conexión de golpe (`req.destroy()`) le cortaba al cliente la subida antes de
        // poder leer el 413, y veía un error de red en vez de la respuesta.
        let demasiado = false;
        req.on('data', (c) => {
            total += c.length;
            if (total > MAX_BODY) { demasiado = true; partes.length = 0; return; }
            partes.push(c);
        });
        req.on('end', () => (demasiado
            ? rechazar(Object.assign(new Error('cuerpo demasiado grande'), { demasiado: true }))
            : resolver(Buffer.concat(partes))));
        req.on('error', rechazar);
    });
}

const HOSTS_LOCALES = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function crearServidor({ config, ejecutar, registrar = console.log }) {
    function responder(res, estado, cabeceras, cuerpo, cookies = []) {
        const h = { ...cabeceras };
        if (cookies.length) h['set-cookie'] = cookies;
        h['content-length'] = String(cuerpo.length);
        res.writeHead(estado, h);
        res.end(cuerpo);
    }
    const json = (res, estado, objeto, cors) => responder(res, estado, { 'content-type': 'application/json', ...cors }, Buffer.from(JSON.stringify(objeto)));

    return http.createServer(async (req, res) => {
        const inicio = Date.now();
        const metodo = req.method;
        let etiqueta = '(sin ruta)';
        let estado = 500;
        const origen = req.headers.origin;
        const corsRespuesta = cabecerasCors(config.cors, origen, false);
        const fin = () => registrar(`${metodo} ${etiqueta} -> ${estado} ${Date.now() - inicio}ms`);
        try {
            // Un sitio cualquiera podría apuntar un nombre de dominio suyo a 127.0.0.1
            // y hablarle a este servidor desde el navegador: solo se atiende por un
            // nombre local.
            if (!HOSTS_LOCALES.test(req.headers.host || '')) { estado = 403; json(res, 403, { message: 'Forbidden' }, {}); return fin(); }

            const url = new URL(req.url, 'http://localhost');
            if (metodo === 'OPTIONS' && req.headers['access-control-request-method']) {
                // El preflight lo responde API Gateway sin invocar la Lambda.
                estado = 204;
                etiqueta = '(preflight)';
                responder(res, 204, cabecerasCors(config.cors, origen, true), Buffer.alloc(0));
                return fin();
            }

            const encontrada = buscarRuta(config.rutas, metodo, url.pathname);
            if (!encontrada) { estado = 404; json(res, 404, { message: 'Not Found' }, corsRespuesta); return fin(); }
            const { ruta, params } = encontrada;
            etiqueta = ruta.clave; // la plantilla de la ruta, no la URL: no registra identificadores

            let cuerpo;
            try { cuerpo = await leerCuerpo(req); } catch (err) {
                estado = err.demasiado ? 413 : 400;
                json(res, estado, { message: err.demasiado ? 'Request Entity Too Large' : 'Bad Request' }, corsRespuesta);
                return fin();
            }

            const evento = armarEvento({
                metodo, url: req.url, cabeceras: req.headers, cuerpo,
                ip: req.socket.remoteAddress && req.socket.remoteAddress.replace(/^::ffff:/, ''),
                ruta, parametros: params,
            });

            if (ruta.autorizador) {
                // Sin la cabecera de identidad API Gateway ni invoca al autorizador.
                if (!req.headers.authorization) { estado = 401; json(res, 401, { message: 'Unauthorized' }, corsRespuesta); return fin(); }
                let decision;
                try { decision = await ejecutar(config.autorizadores[ruta.autorizador], evento); } catch (err) {
                    console.error(`Error en el autorizador: ${err.message}`);
                    decision = null;
                }
                if (!decision || decision.isAuthorized !== true) { estado = 401; json(res, 401, { message: 'Unauthorized' }, corsRespuesta); return fin(); }
                evento.requestContext.authorizer = { lambda: decision.context || {} };
            }

            let resp;
            try { resp = await ejecutar(ruta.funcion, evento); } catch (err) {
                if (err.esTimeout) { estado = 504; json(res, 504, { message: 'Gateway Timeout' }, corsRespuesta); return fin(); }
                // Solo el mensaje del error: la traza puede traer datos de la petición.
                console.error(`Error no controlado en ${ruta.funcion}: ${err.message}`);
                estado = 500; json(res, 500, { message: 'Internal Server Error' }, corsRespuesta); return fin();
            }
            const t = traducirRespuesta(resp);
            estado = t.estado;
            // El CORS lo decide la configuración (como API Gateway), no el handler: sus
            // cabeceras `access-control-*` (por ejemplo un `*`) no pasan, y con un origen
            // no permitido la respuesta sale sin ellas.
            responder(res, t.estado, { ...sinCabecerasCors(t.cabeceras), ...corsRespuesta }, t.cuerpo, t.cookies);
            fin();
        } catch (err) {
            console.error(`Error del servidor local: ${err.message}`);
            if (!res.headersSent) { estado = 500; json(res, 500, { message: 'Internal Server Error' }, corsRespuesta); }
            fin();
        }
    });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function commitActual() {
    try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return 'desconocido'; }
}

function main(argv) {
    const opciones = leerArgumentos(argv);
    const stage = validarAmbiente(opciones.stage);
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

    const config = leerConfiguracion(path.join(RAIZ, 'serverless.yml'));
    console.log(`Leyendo la configuración de las Lambdas de ${stage} (perfil: ${process.env.AWS_PROFILE || 'predeterminado'}, región ${region})...`);
    const entornos = cargarEntornos(stage, region);

    const ejecutar = crearEjecutor({ funciones: config.funciones, entornos, recargar: opciones.recargar, region });
    const servidor = crearServidor({ config, ejecutar });
    servidor.on('error', (err) => {
        console.error(err.code === 'EADDRINUSE' ? `El puerto ${opciones.puerto} ya está en uso.` : `Error del servidor: ${err.message}`);
        process.exit(1);
    });
    // Solo el bucle local: nunca todas las interfaces.
    servidor.listen(opciones.puerto, '127.0.0.1', () => {
        console.log('');
        console.log('==================================================================');
        console.log(' ATENCION: usa las tablas, buckets y colas REALES de dev: lo que');
        console.log(' crees queda en dev y lo ven los demás. Los trabajos en segundo');
        console.log(' plano (colas) los procesa la Lambda desplegada en dev, no este código.');
        console.log('==================================================================');
        console.log(` Rutas cargadas: ${config.rutas.length} (${Object.keys(config.funciones).length} funciones)`);
        console.log(` Commit: ${commitActual()}`);
        console.log(` Recarga por petición: ${opciones.recargar ? 'sí' : 'no (reinicia el servidor al cambiar código)'}`);
        console.log(` Escuchando en http://localhost:${opciones.puerto} (solo 127.0.0.1)`);
        console.log('');
    });
    return servidor;
}

module.exports = {
    validarAmbiente,
    leerArgumentos,
    parsearYaml,
    leerConfiguracion,
    nuevaRuta,
    buscarRuta,
    armarEvento,
    traducirRespuesta,
    cabecerasCors,
    sinCabecerasCors,
    entornosDeFunciones,
    crearServidor,
    crearEjecutor,
};

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}
