// La app real, con la API simulada por Playwright (sin backend ni AWS): el
// botón de ayuda está visible en el header a 360 px sin chocar con nada, el
// menú de ayuda cabe en la pantalla y abre el manual de la pantalla, y el
// progreso se lee una sola vez por sesión.

import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';
const USUARIO = {
    personaId: 'p-1', tenantId: 't-1', nombre: 'Ana', apellidoPaterno: 'Rojas', rol: 'trabajador',
    permisos: ['actividades.ver'], habilitado: true, passwordTemporal: false,
};

/**
 * Recorridos de prueba: reemplazan `src/ayuda/recorridos.ts` al servirlo Vite.
 * Así se ejercita el proveedor real sin publicar recorridos en el código.
 */
const RECORRIDOS_PRUEBA = [
    {
        id: 'inicio-obligatorio', tipo: 'obligatorio', pantalla: 'inicio', visibleSi: {}, ambito: 'cualquiera', version: 1,
        reiniciarAlPublicar: false, estado: 'publicado', titulo: { es: 'Conoce el inicio' },
        pasos: [
            { ancla: 'global.boton-ayuda', titulo: { es: 'Tu ayuda' }, descripcion: { es: 'Aquí encuentras ayuda.' } },
            { ancla: 'menu-ayuda.manual', accion: 'abrir_ayuda', titulo: { es: 'El manual' }, descripcion: { es: 'Y aquí el manual de cada pantalla.' } },
        ],
    },
    {
        id: 'inicio-opcional', tipo: 'opcional', pantalla: 'inicio', visibleSi: {}, ambito: 'cualquiera', version: 1,
        reiniciarAlPublicar: false, estado: 'publicado', titulo: { es: 'Accesos rápidos' },
        pasos: [{ ancla: 'global.boton-ayuda', titulo: { es: 'Opcional' }, descripcion: { es: 'Un recorrido opcional.' } }],
    },
    {
        id: 'novedad-bandeja', tipo: 'anuncio', pantalla: 'bandeja', visibleSi: {}, ambito: 'cualquiera', version: 1,
        reiniciarAlPublicar: false, estado: 'publicado', vigenciaHasta: '2099-12-31', titulo: { es: 'Novedad' },
        pasos: [{ titulo: { es: 'Bandeja nueva' }, descripcion: { es: 'Ahora los avisos llegan aquí.' } }],
    },
    {
        id: 'inicio-borrador', tipo: 'obligatorio', pantalla: 'inicio', visibleSi: {}, ambito: 'cualquiera', version: 1,
        reiniciarAlPublicar: false, estado: 'borrador', titulo: { es: 'Borrador' },
        pasos: [{ ancla: 'global.boton-ayuda', titulo: { es: 'Borrador' }, descripcion: { es: 'Solo en vista previa.' } }],
    },
];

async function prepararApp(page, { progreso = [], registrar = true, recorridos = null, estadoProgreso = 200, demoraProgreso = 0 } = {}) {
    const llamadas = { progreso: 0, put: [], sinRed: false };
    if (recorridos) {
        await page.route(/\/src\/ayuda\/recorridos\.ts(\?.*)?$/, (ruta) => ruta.fulfill({
            status: 200, contentType: 'application/javascript', body: `export const RECORRIDOS = ${JSON.stringify(recorridos)};`,
        }));
    }
    await page.addInitScript(() => {
        localStorage.setItem('auth_token', 'token-de-prueba');
        localStorage.setItem('session_id', 'sesion-de-prueba');
    });
    await page.route(`${API}/**`, async (ruta) => {
        const url = new URL(ruta.request().url());
        const metodo = ruta.request().method();
        const json = (data, status = 200) => ruta.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname === '/auth/me') {
            return json({ success: true, data: { user: USUARIO, session: { expiresAt: new Date(Date.now() + 3600e3).toISOString() } } });
        }
        if (url.pathname === '/ayuda/progreso' && metodo === 'GET') {
            llamadas.progreso += 1;
            if (demoraProgreso) await new Promise((r) => setTimeout(r, demoraProgreso));
            if (estadoProgreso !== 200) return json({ success: false, error: 'caído' }, estadoProgreso);
            return json({ success: true, data: { progreso, registrar } });
        }
        if (url.pathname.startsWith('/ayuda/progreso/') && metodo === 'PUT') {
            if (llamadas.sinRed) return ruta.abort('internetdisconnected');
            llamadas.put.push(JSON.parse(ruta.request().postData() || '{}'));
            return json({ success: true, data: {} });
        }
        return json({ success: true, data: [] });
    });
    return llamadas;
}

const seCruzan = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe('a 360 px', () => {
    test.use({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });

    test('el botón de ayuda se ve en el header y no choca con la marca ni con las otras acciones', async ({ page }) => {
        await prepararApp(page);
        await page.goto('/');
        const ayuda = page.locator('[data-tour="global.boton-ayuda"]');
        await expect(ayuda).toBeVisible();
        await page.screenshot({ path: 'test-results/cabecera-360.png', clip: { x: 0, y: 0, width: 360, height: 140 } });
        const b = await ayuda.boundingBox();
        expect(b.x + b.width).toBeLessThanOrEqual(360);
        expect(b.width).toBeGreaterThanOrEqual(40);
        const otros = page.locator('.header-mainbar .header-brand, .header-mainbar .header-action:not(.header-action--help), .header-mainbar .header-hamburger');
        for (let i = 0; i < await otros.count(); i += 1) {
            const o = otros.nth(i);
            if (!(await o.isVisible())) continue;
            const c = await o.boundingBox();
            expect(seCruzan(b, c), `choca con ${await o.evaluate((el) => el.className)}`).toBe(false);
        }
        await page.screenshot({ path: 'test-results/cabecera-360.png' });
    });

    test('el menú de ayuda cabe en la pantalla, lleva al manual de la pantalla y se cierra con Escape', async ({ page }) => {
        await prepararApp(page);
        await page.goto('/');
        await page.locator('[data-tour="global.boton-ayuda"]').click();
        const panel = page.getByRole('region', { name: 'Ayuda' });
        await expect(panel).toBeVisible();
        const p = await panel.boundingBox();
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x + p.width).toBeLessThanOrEqual(360);
        expect(p.y + p.height).toBeLessThanOrEqual(640);
        await expect(panel.getByRole('link', { name: 'Abrir el manual de esta pantalla' })).toHaveAttribute('href', '/manual/empezar/elegir-obra');
        await expect(panel).toContainText('No hay recorridos para esta pantalla.');
        await page.screenshot({ path: 'test-results/menu-ayuda-360.png' });
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        await expect(page.locator('[data-tour="global.boton-ayuda"]')).toBeFocused();
    });
});

test('el progreso se lee una vez por sesión, aunque se cambie de pantalla', async ({ page }) => {
    const llamadas = await prepararApp(page);
    await page.goto('/');
    await expect(page.locator('[data-tour="global.boton-ayuda"]')).toBeVisible();
    await expect.poll(() => llamadas.progreso).toBe(1);
    await page.locator('[data-tour="global.boton-ayuda"]').click();
    await page.getByRole('region', { name: 'Ayuda' }).getByRole('link').click();
    await expect(page).toHaveURL(/\/manual\/empezar\/elegir-obra/);
    await page.goBack();
    await expect(page.locator('[data-tour="global.boton-ayuda"]')).toBeVisible();
    await page.waitForTimeout(500);
    expect(llamadas.progreso).toBe(1);
});

test('un pendiente que quedó en el equipo se envía al abrir la app, y uno de otra persona no', async ({ page }) => {
    const llamadas = await prepararApp(page);
    await page.addInitScript(() => {
        localStorage.setItem('recorridosPendientes', JSON.stringify({
            't-1|p-1': { intro: { version: 1, estado: 'completado', ultimoPaso: 2, cierres: 0 } },
            't-1|otra': { intro: { version: 1, estado: 'omitido', ultimoPaso: 0, cierres: 0 } },
        }));
    });
    await page.goto('/');
    await expect.poll(() => llamadas.put.length).toBe(1);
    expect(llamadas.put[0]).toEqual({ version: 1, estado: 'completado', ultimoPaso: 2, cierres: 0 });
    await expect.poll(() => page.evaluate(() => localStorage.getItem('recorridosPendientes'))).toBe('{}');
});

// ─── Proveedor real con recorridos de prueba ────────────────────────────────

const globo = (page) => page.locator('.recorrido-globo');

test('un obligatorio pendiente se lanza solo; un paso abre la ayuda y resalta algo dentro; completar lo envía', async ({ page }) => {
    const llamadas = await prepararApp(page, { recorridos: RECORRIDOS_PRUEBA });
    await page.goto('/');
    await expect(globo(page)).toContainText('Tu ayuda', { timeout: 5000 });
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(globo(page)).toContainText('El manual');
    await expect(page.locator('[data-tour="menu-ayuda.manual"]')).toBeVisible();
    await page.getByRole('button', { name: 'Finalizar' }).click();
    await expect.poll(() => llamadas.put).toEqual([{ version: 1, estado: 'completado', ultimoPaso: 1, cierres: 0 }]);
    await expect(globo(page)).toHaveCount(0);
});

test('un solo recorrido automático por sesión: cerrarlo no hace que vuelva a salir en la misma sesión', async ({ page }) => {
    const llamadas = await prepararApp(page, { recorridos: RECORRIDOS_PRUEBA });
    await page.goto('/');
    await expect(globo(page)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect.poll(() => llamadas.put).toEqual([{ version: 1, estado: 'en_progreso', ultimoPaso: 0, cierres: 1 }]);
    await page.reload();
    await expect(page.locator('[data-tour="global.boton-ayuda"]')).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(globo(page)).toHaveCount(0);
});

test('no se lanza solo si ya se completó, si la persona está bloqueada o si no se pudo leer el progreso', async ({ page }) => {
    for (const opciones of [
        { progreso: [{ recorridoId: 'inicio-obligatorio', version: 1, estado: 'completado', ultimoPaso: 1, cierres: 0, actualizadoEn: '2026-11-01T00:00:00Z' }] },
        { registrar: false },
        { estadoProgreso: 500 },
    ]) {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await prepararApp(page, { recorridos: RECORRIDOS_PRUEBA, ...opciones });
        await page.goto('/');
        await expect(page.locator('[data-tour="global.boton-ayuda"]')).toBeVisible();
        await page.waitForTimeout(1500);
        await expect(globo(page), JSON.stringify(opciones)).toHaveCount(0);
    }
});

test('el menú de ayuda lista los recorridos de la pantalla (sin borradores) y los abre aunque estén completados', async ({ page }) => {
    const llamadas = await prepararApp(page, {
        recorridos: RECORRIDOS_PRUEBA,
        progreso: [{ recorridoId: 'inicio-obligatorio', version: 1, estado: 'completado', ultimoPaso: 1, cierres: 0, actualizadoEn: '2026-11-01T00:00:00Z' }],
    });
    await page.goto('/');
    await page.locator('[data-tour="global.boton-ayuda"]').click();
    const panel = page.getByRole('region', { name: 'Ayuda' });
    await expect(panel.locator('[data-tour="menu-ayuda.recorridos"]').getByRole('button')).toHaveText([/Conoce el inicio\s*Visto/, /Accesos rápidos/]);
    await expect(panel.locator('[data-tour="menu-ayuda.novedades"]').getByRole('button')).toHaveText(['Novedad']);
    await panel.getByRole('button', { name: /Accesos rápidos/ }).click();
    await expect(globo(page)).toContainText('Opcional');
    await page.getByRole('button', { name: 'Finalizar' }).click();
    await expect.poll(() => llamadas.put).toEqual([{ version: 1, estado: 'completado', ultimoPaso: 0, cierres: 0 }]);
});

test('salir de la pantalla a mitad de un recorrido cuenta como cerrar', async ({ page }) => {
    const llamadas = await prepararApp(page, { recorridos: RECORRIDOS_PRUEBA });
    await page.goto('/');
    await expect(globo(page)).toBeVisible({ timeout: 5000 });
    await page.evaluate(() => { history.pushState({}, '', '/inbox'); dispatchEvent(new PopStateEvent('popstate')); });
    await expect(globo(page)).toHaveCount(0);
    await expect.poll(() => llamadas.put).toEqual([{ version: 1, estado: 'en_progreso', ultimoPaso: 0, cierres: 1 }]);
});

test('vista previa: abre un borrador en la pantalla real y no escribe progreso (falla 13)', async ({ page }) => {
    const llamadas = await prepararApp(page, { recorridos: RECORRIDOS_PRUEBA });
    await page.goto('/?recorrido=inicio-borrador&previa=1');
    await expect(globo(page)).toContainText('Solo en vista previa.', { timeout: 5000 });
    await page.getByRole('button', { name: 'Finalizar' }).click();
    await page.waitForTimeout(800);
    expect(llamadas.put).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('recorridosPendientes'))).toBeNull();
});

test('sin red, completar queda en la cola y se envía al volver la conexión, una sola vez', async ({ page }) => {
    const llamadas = await prepararApp(page, { recorridos: RECORRIDOS_PRUEBA });
    await page.goto('/');
    await expect(globo(page)).toBeVisible({ timeout: 5000 });
    // setOffline no corta las rutas interceptadas: la caída se simula abortándolas.
    llamadas.sinRed = true;
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByRole('button', { name: 'Finalizar' }).click();
    await page.waitForTimeout(500);
    expect(llamadas.put).toEqual([]);
    const cola = JSON.parse(await page.evaluate(() => localStorage.getItem('recorridosPendientes')));
    expect(cola['t-1|p-1']['inicio-obligatorio'].estado).toBe('completado');
    llamadas.sinRed = false;
    await page.evaluate(() => dispatchEvent(new Event('online')));
    await expect.poll(() => llamadas.put).toEqual([{ version: 1, estado: 'completado', ultimoPaso: 1, cierres: 0 }]);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('recorridosPendientes'))).toBe('{}');
    await page.evaluate(() => dispatchEvent(new Event('online')));
    await page.waitForTimeout(500);
    expect(llamadas.put.length).toBe(1);
});

test('con una confirmación abierta no se lanza solo; al cerrarla, sí (decisión 8)', async ({ page }) => {
    // El progreso tarda en llegar, para alcanzar a abrir la confirmación antes.
    await prepararApp(page, { recorridos: RECORRIDOS_PRUEBA, demoraProgreso: 1500 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Más opciones' }).click();
    await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
    const confirmacion = page.getByRole('alertdialog', { name: 'Cerrar sesión' });
    await expect(confirmacion).toBeVisible();
    await page.waitForTimeout(3000);
    await expect(globo(page)).toHaveCount(0);
    await confirmacion.getByRole('button', { name: 'Cancelar' }).click();
    await expect(globo(page)).toContainText('Tu ayuda', { timeout: 3000 });
});

test('un anuncio cerrado con la X queda como visto y no vuelve a aparecer', async ({ page }) => {
    const llamadas = await prepararApp(page, { recorridos: RECORRIDOS_PRUEBA });
    await page.goto('/inbox');
    await expect(globo(page)).toContainText('Bandeja nueva', { timeout: 5000 });
    await page.getByRole('button', { name: 'Cerrar recorrido' }).click();
    await expect.poll(() => llamadas.put).toEqual([{ version: 1, estado: 'completado', ultimoPaso: 0, cierres: 0 }]);

    // Sesión nueva, con lo que el servidor guardó: no vuelve.
    await page.evaluate(() => sessionStorage.clear());
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await prepararApp(page, {
        recorridos: RECORRIDOS_PRUEBA,
        progreso: [{ recorridoId: 'novedad-bandeja', version: 1, estado: 'completado', ultimoPaso: 0, cierres: 0, actualizadoEn: '2026-11-06T00:00:00Z' }],
    });
    await page.goto('/inbox');
    await expect(page.locator('[data-tour="global.boton-ayuda"]')).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(globo(page)).toHaveCount(0);
});

// ─── Manual (Fase 4) ─────────────────────────────────────────────────────────

test('una dirección del manual anterior lleva a su página nueva, con la sección', async ({ page }) => {
    await page.goto('/manual/modulos/firmas#firma-asistida');
    await expect(page).toHaveURL(/\/manual\/obra\/pedir-firmas#firma-asistida$/);
    await expect(page.getByRole('heading', { name: 'Firma asistida', exact: true })).toBeVisible();
    await page.goto('/manual/ds44');
    await expect(page).toHaveURL(/\/manual\/fuf$/);
    await page.goto('/manual/guia-inicio/instalacion');
    await expect(page).toHaveURL(/\/manual\/empezar\/ingresar$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cómo ingresar a la plataforma');
});

test('?recorrido=<id> abre el recorrido y guarda su progreso; un borrador no se abre por esa vía', async ({ page }) => {
    const llamadas = await prepararApp(page, { recorridos: RECORRIDOS_PRUEBA, progreso: [{ recorridoId: 'inicio-obligatorio', version: 1, estado: 'completado', ultimoPaso: 1, cierres: 0, actualizadoEn: '2026-11-01T00:00:00Z' }] });
    await page.goto('/?recorrido=inicio-opcional');
    await expect(globo(page)).toContainText('Opcional', { timeout: 5000 });
    await page.getByRole('button', { name: 'Finalizar' }).click();
    await expect.poll(() => llamadas.put).toEqual([{ version: 1, estado: 'completado', ultimoPaso: 0, cierres: 0 }]);

    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/?recorrido=inicio-borrador');
    await expect(page.locator('[data-tour="global.boton-ayuda"]')).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(globo(page)).toHaveCount(0);
});

/** Reemplaza el contenido de una página del manual al servirla Vite. */
const paginaDelManual = (page, archivo, md) => page.route(new RegExp(`/src/manual/content/${archivo.replace(/[/.]/g, '\\$&')}(\\?.*)?$`), (ruta) =>
    ruta.fulfill({ status: 200, contentType: 'application/javascript', body: `export default ${JSON.stringify(md)};` }));

const CON_RECORRIDO = '# Firmar lo que te asignaron\n\nTexto.\n\n[Ver recorrido](recorrido:inicio-opcional)\n\n[Ver el borrador](recorrido:inicio-borrador)\n';

test('"Ver recorrido" en el manual: con sesión lleva a la pantalla y abre el recorrido', async ({ page }) => {
    await prepararApp(page, { recorridos: RECORRIDOS_PRUEBA, progreso: [{ recorridoId: 'inicio-obligatorio', version: 1, estado: 'completado', ultimoPaso: 1, cierres: 0, actualizadoEn: '2026-11-01T00:00:00Z' }] });
    await paginaDelManual(page, 'terreno/firmar.md', CON_RECORRIDO);
    await page.goto('/');
    await expect(page.locator('[data-tour="global.boton-ayuda"]')).toBeVisible();
    await page.goto('/manual/terreno/firmar');
    const enlace = page.getByRole('link', { name: 'Ver recorrido' });
    await expect(enlace).toHaveAttribute('href', '/?recorrido=inicio-opcional');
    await expect(page.getByRole('link', { name: 'Ver el borrador' })).toHaveCount(0);
    await enlace.click();
    await expect(globo(page)).toContainText('Opcional', { timeout: 5000 });
});

test('"Ver recorrido" en el manual: sin sesión no aparece', async ({ page }) => {
    await page.route(/\/src\/ayuda\/recorridos\.ts(\?.*)?$/, (ruta) => ruta.fulfill({ status: 200, contentType: 'application/javascript', body: `export const RECORRIDOS = ${JSON.stringify(RECORRIDOS_PRUEBA)};` }));
    await paginaDelManual(page, 'terreno/firmar.md', CON_RECORRIDO);
    await page.goto('/manual/terreno/firmar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Firmar lo que te asignaron');
    await expect(page.getByRole('link', { name: 'Ver recorrido' })).toHaveCount(0);
});
