// Lo que se corrigió tras la prueba en terreno en modo avión (D-36).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cargarTs, FRONTEND } = require('./cargar-ts');

const leer = (...p) => fs.readFileSync(path.join(FRONTEND, 'src', ...p), 'utf8');

function almacen() {
    const d = new Map();
    return { getItem: (k) => (d.has(k) ? d.get(k) : null), setItem: (k, v) => d.set(k, String(v)), removeItem: (k) => d.delete(k), get length() { return d.size; }, key: (i) => [...d.keys()][i] ?? null };
}
function conAlmacen(a, fn) {
    const previo = global.localStorage;
    global.localStorage = a;
    try { return fn(); } finally { global.localStorage = previo; }
}

// ─── 1 y 3. Sin vales, el sobre; con PIN y red, vales nuevos ─────────────────

test('sin vales o con vales de otra obra se usa el sobre; un PIN malo con vales se avisa al momento', () => {
    const h = leer('hooks', 'useOfflineSignature.ts');
    const i = h.indexOf('const tomado = await tomarVale(');
    const rama = h.slice(i, h.indexOf('const sig: FirmaPendiente', i));
    assert.ok(rama.includes("credencial.vale = tomado.vale"));
    assert.ok(rama.includes("tomado.motivo === 'pin_incorrecto'"));
    assert.ok(rama.includes('await cifrarSobre(pin,'), 'lo demás va en sobre');
    assert.ok(rama.includes('idFirmaLocal: id, timestampLocal: timestamp'), 'el sobre amarra el mismo id y la misma hora que viajan');
    assert.match(h, /\.\.\.\(sig\.vale \? \{ vale: sig\.vale \} : \{ sobre: sig\.sobre, idSincronizacion \}\)/);
});

test('cada firma con PIN y red renueva los vales en silencio, propia o asistida', () => {
    for (const [archivo, marca] of [
        ['documents.api.ts', 'renovarValesEnSilencio((data as { personaId?: string }).personaId'],
        ['documents.api.ts', 'renovarValesEnSilencio(data.firmanteId, data.pin)'],
        ['activities.api.ts', 'workerIds?.[0]'],
        ['surveys.api.ts', 'renovarValesEnSilencio(workerId,'],
        ['signatures.api.ts', 'renovarValesEnSilencio(data.personaId, data.pin)'],
    ]) {
        assert.ok(leer('api', archivo).includes(marca), `${archivo}: ${marca}`);
    }
    const t = leer('utils', 'valesTurno.ts');
    assert.ok(t.includes("localStorage.getItem('obraScope') === 'obra' ? localStorage.getItem('selectedObraId')"), 'para la obra activa');
    assert.match(t, /catch \{\s*\/\* en silencio/, 'si falla, no se dice nada');
    assert.ok(!/toast|alert\(/.test(t));
});

// ─── 4. Sincronización automática ────────────────────────────────────────────

test('se sincroniza al volver la red, al volver a la app y cada 20 segundos, sin mirar navigator.onLine', () => {
    const s = leer('components', 'firmas', 'SincronizadorFirmas.tsx');
    assert.match(s, /const CADA_MS = 20 \* 1000;/);
    for (const ev of ["'online'", "'focus'", "'pageshow'", "'visibilitychange'"]) assert.ok(s.includes(ev), ev);
    assert.ok(!s.slice(s.indexOf('export default')).includes('navigator.onLine'), 'en Android puede estar atrasado');
    const h = leer('hooks', 'useOfflineSignature.ts');
    const f = h.slice(h.indexOf('const syncPendingSignatures = useCallback'), h.indexOf('const sincronizar = async'));
    assert.ok(!f.includes('if (!navigator.onLine)'));
    assert.ok(s.includes('Enviar ahora'), 'queda como respaldo');
    assert.ok(!/isOnline && \(\s*<button/.test(s));
});

test('al sincronizar: sin red se corta sin ruido; un rechazo se anota con nombre; lo pasajero sigue en la cola', () => {
    const h = leer('hooks', 'useOfflineSignature.ts');
    assert.match(h, /sinRed = true;\s*failed\+\+;\s*break;/);
    assert.ok(h.includes('!(response as { reintentable?: boolean }).reintentable'));
    const c = leer('api', 'client.ts');
    assert.match(c, /avisarSesionCaida\(\);\s*\/\/[^\n]*\n[^\n]*\n\s*return \{ success: false, reintentable: true/, 'una sesión caída no descarta firmas');
    assert.match(c, /response\.status === 423\) \{[\s\S]{0,200}reintentable: true/, 'un PIN bloqueado tampoco');
    const s = leer('components', 'firmas', 'SincronizadorFirmas.tsx');
    assert.ok(s.includes('La firma de {r.workerName} ({r.targetTitle}) no se validó: tiene que firmar de nuevo.'));
    assert.ok(!s.includes('toast.error'), 'reintentar cada 20 segundos no puede llenar de errores la pantalla');
});

test('las firmas las envía solo el sincronizador: las pantallas no se pisan con él', () => {
    for (const p of ['Activities.tsx', 'Surveys.tsx']) assert.ok(!leer('pages', p).includes('syncPendingSignatures()'), p);
});

// ─── 5. Nada técnico sin red ─────────────────────────────────────────────────

test('un fetch sin red nunca llega a la pantalla como "Failed to fetch"', () => {
    const c = leer('api', 'client.ts');
    assert.match(c, /return esErrorDeRed\(error\)\s*\? \{ success: false, sinRed: true, error: SIN_SENAL \}/);
    assert.ok(!c.includes('error instanceof Error ? error.message'));
    const infractores = [];
    const recorrer = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { if (e.name !== 'manual') recorrer(p); continue; }
            if (!/\.tsx?$/.test(e.name) || e.name === 'MedicionPin.tsx') continue;
            fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
                if (/\b(e|err|error)(\?)?\.message\b/.test(l) && !/console\.|messageId/.test(l) && !p.endsWith('client.ts')) infractores.push(`${path.relative(FRONTEND, p)}:${i + 1}`);
            });
        }
    };
    recorrer(path.join(FRONTEND, 'src'));
    assert.deepEqual(infractores, [], 'usa mensajeDeError');
});

// ─── 6. Sin red nunca se cierra la sesión ────────────────────────────────────

test('sin red no se cierra la sesión: ni al recargar ni al cumplirse la hora', () => {
    const a = leer('context', 'AuthContext.tsx');
    const c = a.slice(a.indexOf('const checkAuth = useCallback'));
    assert.ok(c.indexOf('response.sinRed || response.reintentable') < c.indexOf("localStorage.removeItem('auth_token')"), 'antes de borrar el token');
    assert.ok(c.includes('leerSesionLocal<User>()'), 'sigue con la copia local');
    const t = a.slice(a.indexOf('const scheduleAutoLogout'), a.indexOf('const checkAuth'));
    assert.ok(t.indexOf('r.sinRed || r.reintentable') > 0);
    assert.ok(t.indexOf('r.sinRed || r.reintentable') < t.indexOf('setSessionExpired(true)'), 'pregunta antes de cerrar');
});

test('la copia de la sesión: lo necesario para firmar, sin RUT, correo ni salud', () => {
    const a = almacen();
    conAlmacen(a, () => {
        const s = cargarTs('sesionLocal.ts');
        s.guardarSesionLocal({ personaId: 'p', tenantId: 't', nombre: 'Rosa', rol: 'trabajador', permisos: ['x'], rut: '11.111.111-1', email: 'r@e.cl', telefono: '9', vigilanciaSalud: { a: 1 }, restriccionLaboral: 'z', llaveSobreFirma: 'k' });
        const c = s.leerSesionLocal();
        assert.deepEqual(Object.keys(c).sort(), ['nombre', 'permisos', 'personaId', 'rol', 'tenantId']);
        s.borrarSesionLocal();
        assert.equal(s.leerSesionLocal(), null);
    });
    const auth = leer('context', 'AuthContext.tsx');
    assert.match(auth, /localStorage\.removeItem\('persona_id'\);\s*borrarSesionLocal\(\);/, 'se va con la sesión');
});

test('el aviso de sesión vencida no lleva emoji', () => {
    const app = leer('App.tsx');
    const i = app.indexOf('function SessionExpiredModal');
    const modal = app.slice(i, app.indexOf('document.body', i));
    assert.ok(!/\p{Extended_Pictographic}/u.test(modal));
});

// ─── 7. Plurales ─────────────────────────────────────────────────────────────

test('plural: "1 firma enviada", "2 firmas enviadas"', () => {
    const { plural } = cargarTs('plural.ts');
    assert.equal(plural(1, 'firma enviada', 'firmas enviadas'), '1 firma enviada');
    assert.equal(plural(2, 'firma enviada', 'firmas enviadas'), '2 firmas enviadas');
    assert.equal(plural(0, 'firma enviada', 'firmas enviadas'), '0 firmas enviadas');
});

test('no queda "firma(s)" ni parecidos en lo que se ve', () => {
    const CAJA = /[a-záéíóúñ]\((s|es|n)\)[\s,.`'"<:;)]/i;
    const infractores = [];
    const recorrer = (dir, excluir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { if (!excluir.includes(e.name)) recorrer(p, excluir); continue; }
            if (!/\.(tsx?|js)$/.test(e.name)) continue;
            fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
                const t = l.trim();
                if (/^(\/\/|\*|\/\*|\{\/\*)/.test(t) || /console\./.test(l)) return;
                // Código, no texto: una llamada con s, n o es como argumento.
                const sinLlamadas = l.replace(/[\w$.]*\b\w+\((s|n|es)\)(?=\s*(=>|\)|\}|\.|,|;|&&|\|\||\?|\{|$|!==|===|:|\]))/g, '');
                if (CAJA.test(sinLlamadas)) infractores.push(`${path.relative(path.join(FRONTEND, '..'), p)}:${i + 1}  ${t.slice(0, 90)}`);
            });
        }
    };
    recorrer(path.join(FRONTEND, 'src'), ['manual', 'ayuda']);
    const BACK = path.join(__dirname, '..');
    recorrer(path.join(BACK, 'handlers'), []);
    recorrer(path.join(BACK, 'lib'), []);
    assert.deepEqual(infractores, []);
});
