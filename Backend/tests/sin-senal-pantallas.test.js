// Prueba en terreno del 11 de noviembre de 2026 (dev), antes del paso a prod 2:
//   2. Sin señal, Encuestas mostraba "Todas · 0" y "Encuestas creadas 0".
//   3. "Enviar ahora" aparecía con señal mientras el envío automático enviaba.
//   4. Sin señal, Encuestas apilaba tres avisos (uno rojo) y ofrecía "Crear".
// (El 1, "48 de 0 en la obra", está en encuestas.test.js; el 5, el globo del
// recorrido, en Frontend/tests/ayuda-posicion.test.mjs y en el e2e a 360 px.)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cargarTs, FRONTEND } = require('./cargar-ts');

const leer = (...p) => fs.readFileSync(path.join(FRONTEND, 'src', ...p), 'utf8');
const MIN = 60 * 1000;

// ─── 3. "Enviar ahora" solo de respaldo ──────────────────────────────────────

test('con señal y el envío funcionando no se ofrece "Enviar ahora"; tras más de 2 minutos fallando, sí', () => {
    const { ENVIO_INICIAL, trasIntento, ofrecerEnviarAhora } = cargarTs('envioAutomatico.ts');
    const falla = { synced: 0, failed: 1, sinRed: false };
    let e = ENVIO_INICIAL;
    const t0 = 1_000_000;
    // Intentos cada 20 s que fallan con señal (servidor saturado, sesión vencida…).
    for (let t = t0; t <= t0 + 2 * MIN; t += 20_000) {
        e = trasIntento(e, falla, t);
        assert.equal(ofrecerEnviarAhora(e, true, t), false, `a los ${(t - t0) / 1000} s todavía no`);
    }
    e = trasIntento(e, falla, t0 + 2 * MIN + 20_000);
    assert.equal(ofrecerEnviarAhora(e, true, t0 + 2 * MIN + 20_000), true, 'pasados 2 minutos, sí');
    // Sin señal nunca: un toque no arregla nada.
    assert.equal(ofrecerEnviarAhora(e, false, t0 + 10 * MIN), false);
    // Basta que llegue una para volver a "Enviando…".
    e = trasIntento(e, { synced: 1, failed: 1, sinRed: false }, t0 + 3 * MIN);
    assert.equal(ofrecerEnviarAhora(e, true, t0 + 10 * MIN), false);
});

test('el tiempo sin señal no cuenta como envío fallando: al volver la señal no aparece el botón de inmediato', () => {
    const { ENVIO_INICIAL, trasIntento, ofrecerEnviarAhora } = cargarTs('envioAutomatico.ts');
    let e = ENVIO_INICIAL;
    for (let t = 0; t <= 30 * MIN; t += 20_000) e = trasIntento(e, { synced: 0, failed: 1, sinRed: true }, t);
    // Vuelve la señal y el primer intento falla (servidor): el plazo parte ahora.
    e = trasIntento(e, { synced: 0, failed: 1, sinRed: false }, 30 * MIN + 20_000);
    assert.equal(ofrecerEnviarAhora(e, true, 30 * MIN + 40_000), false);
});

test('la franja: con señal "N firmas por enviar · Enviando…" sin botón; sin señal un solo aviso, sin botón', () => {
    const { franjaDeEnvio } = cargarTs('envioAutomatico.ts');
    assert.equal(franjaDeEnvio({ hay: true, pendientes: 0, respaldo: false }), null, 'con señal y nada pendiente, nada');
    assert.deepEqual(franjaDeEnvio({ hay: true, pendientes: 2, respaldo: false }), { texto: '2 firmas por enviar', enviando: true, boton: false });
    assert.deepEqual(franjaDeEnvio({ hay: true, pendientes: 1, respaldo: true }), { texto: '1 firma por enviar: no se han podido enviar.', enviando: false, boton: true });
    const sinNada = franjaDeEnvio({ hay: false, pendientes: 0, respaldo: false });
    assert.ok(sinNada && sinNada.texto.startsWith('Sin señal.'), 'sin señal se avisa aunque no haya nada por enviar');
    assert.equal(sinNada.boton, false);
    const una = franjaDeEnvio({ hay: false, pendientes: 1, respaldo: true });
    assert.equal(una.boton, false, 'sin señal nunca hay botón');
    assert.match(una.texto, /1 firma por enviar: se envía sola/);
    assert.match(franjaDeEnvio({ hay: false, pendientes: 3, respaldo: false }).texto, /3 firmas por enviar: se envían solas/);
    for (const f of [sinNada, una]) assert.ok(!/error|falló|failed/i.test(f.texto));
});

test('SincronizadorFirmas pinta la franja tal cual: el botón solo con franja.boton, y neutro sin señal', () => {
    const s = leer('components', 'firmas', 'SincronizadorFirmas.tsx');
    const vista = s.slice(s.indexOf('const franja = franjaDeEnvio('));
    assert.ok(vista.includes('{franja.boton && ('), 'el botón depende de la franja');
    assert.equal((vista.match(/Enviar ahora/g) || []).length, 1);
    assert.ok(vista.includes("sincronizador-firmas--sin-senal"));
    assert.ok(!vista.includes('--rechazadas\'}') && !/sin-senal[^\n]*danger/.test(vista), 'el de sin señal no es rojo');
    assert.ok(s.includes('respaldo: respaldo && hay'));
    const css = fs.readFileSync(path.join(FRONTEND, 'src', 'css', 'firmas.css'), 'utf8');
    const regla = css.slice(css.indexOf('.sincronizador-firmas--sin-senal'), css.indexOf('\n', css.indexOf('.sincronizador-firmas--sin-senal')));
    assert.ok(!/danger|warning|error/.test(regla), regla);
});

// ─── Un solo estado de señal ─────────────────────────────────────────────────

test('el estado de señal es uno solo: lo marca cualquier respuesta y lo quita una petición sin respuesta', () => {
    global.navigator = { onLine: true };
    try {
        const c = cargarTs('conexion.ts');
        let avisos = 0;
        const quitar = c.suscribirSenal(() => { avisos += 1; });
        assert.equal(c.haySenal(), true);
        c.marcarSenal(false);
        c.marcarSenal(false);
        assert.equal(c.haySenal(), false);
        assert.equal(avisos, 1, 'avisa solo cuando cambia');
        c.marcarSenal(true);
        assert.equal(c.haySenal(), true);
        assert.equal(avisos, 2);
        quitar();
        c.marcarSenal(false);
        assert.equal(avisos, 2);
    } finally {
        delete global.navigator;
    }
    const cliente = leer('api', 'client.ts');
    const i = cliente.indexOf('const response = await fetch(`${API_BASE_URL}${finalEndpoint}`');
    assert.ok(i > 0 && cliente.indexOf('marcarSenal(true);', i) > i, 'cualquier respuesta = hay señal');
    assert.match(cliente, /if \(esErrorDeRed\(error\)\) marcarSenal\(false\);/);
    const hook = leer('hooks', 'useOfflineSignature.ts');
    assert.ok(hook.includes('const isOnline = useHaySenal();'), 'useOfflineSignature lee el mismo estado');
    assert.ok(!hook.includes('setIsOnline'), 'y no tiene uno propio');
});

// ─── 2 y 4. Sin señal: ni ceros, ni avisos propios, ni acciones con conexión ──

const PANTALLAS = ['Surveys.tsx', 'Activities.tsx', 'MySignatures.tsx', 'SignatureRequests.tsx', 'Dashboard.tsx', 'Inbox.tsx', 'Incidents.tsx', 'DocumentsRepository.tsx', 'ObraDetalle.tsx'];

test('ninguna pantalla pone su propio aviso de "sin señal": el único es el del layout', () => {
    for (const p of PANTALLAS) {
        const s = leer('pages', p);
        assert.ok(!/Sin señal[:.]/.test(s), `${p} todavía dice "Sin señal" por su cuenta`);
        assert.ok(!s.includes('survey-offline-banner'), p);
        assert.ok(!/'Sin conexión'/.test(s), p);
    }
});

test('cada pantalla con contadores dice "No disponible sin conexión" en lugar de ceros, y se recarga sola', () => {
    for (const p of PANTALLAS) {
        const s = leer('pages', p);
        assert.ok(s.includes("import SinConexion from '../components/SinConexion';"), `${p}: SinConexion`);
        assert.ok(/useAlVolverLaSenal\(/.test(s), `${p}: se recarga cuando vuelve la señal`);
        assert.ok(/\.sinRed/.test(s), `${p}: distingue la falta de señal de un error`);
    }
    const { NO_DISPONIBLE_SIN_CONEXION } = cargarTs('conexion.ts');
    assert.equal(NO_DISPONIBLE_SIN_CONEXION, 'No disponible sin conexión');
    assert.ok(leer('components', 'SinConexion.tsx').includes('{NO_DISPONIBLE_SIN_CONEXION}'));
    assert.ok(!/<button/.test(leer('components', 'SinConexion.tsx')), 'sin botón de reintentar');
});

test('Encuestas: sin datos no hay "Todas · 0" ni badges, ni error rojo por falta de señal', () => {
    const s = leer('pages', 'Surveys.tsx');
    assert.ok(s.includes("{pestana === 'created' && !noDisponible && ("), 'el selector con cuentas se oculta');
    assert.ok(s.includes('badge: !noDisponible && surveys.length > 0'));
    assert.ok(s.includes('badge: !noDisponible && pendientesTotal > 0'));
    const carga = s.slice(s.indexOf('const loadData = async'), s.indexOf('const precargarPendientes'));
    const iSinRed = carga.indexOf('} else if (res.sinRed) {');
    assert.ok(iSinRed > 0 && carga.indexOf('setSinDatos(true)', iSinRed) > iSinRed);
    assert.ok(carga.indexOf('setError(', iSinRed) > carga.indexOf('} else {', iSinRed), 'el error rojo es solo para lo que no es falta de señal');
    assert.ok(!s.includes('workersApi'), 'el total ya no sale de otra lista');
    assert.ok(s.includes('de ${alcance.totalPersonas} en la empresa'));
});

test('sin señal no se ofrece crear ni nada que necesite conexión', () => {
    const casos = [
        ['Surveys.tsx', 'actions={canManageSurveys && hay ? ('],
        ['Surveys.tsx', "{!searchQuery.trim() && hay && ("],
        ['Activities.tsx', 'const puedeCrear = canCrearActividad && isOnline;'],
        ['Activities.tsx', 'const puedePlanificar = canPlanificar && isOnline;'],
        ['Activities.tsx', 'isOnline && a.estado === \'borrador\''],
        ['SignatureRequests.tsx', 'actions={canCrearSolicitud && isOnline ? ('],
        ['Inbox.tsx', 'actions={hay ? ('],
        ['Incidents.tsx', 'actions={hay ? ('],
        ['DocumentsRepository.tsx', 'canUpload && selectedObraId && hay ? ('],
        ['Dashboard.tsx', "estado: hay ? 'Registro inmediato' : NO_DISPONIBLE_SIN_CONEXION"],
    ];
    for (const [p, marca] of casos) assert.ok(leer('pages', p).includes(marca), `${p}: ${marca}`);
    // En Actividades los botones de crear y planificar usan esas banderas, no el permiso a secas.
    const a = leer('pages', 'Activities.tsx');
    const vista = a.slice(a.indexOf('return (\n        <>'));
    assert.ok(!/\{canCrearActividad && \(/.test(vista) && !/\{canPlanificar && \(/.test(vista), 'Actividades ofrece crear sin mirar la señal');
    // Solicitudes de firma ya no tiene su propio "Enviar ahora".
    assert.ok(!leer('pages', 'SignatureRequests.tsx').includes('Enviar ahora'));
});
