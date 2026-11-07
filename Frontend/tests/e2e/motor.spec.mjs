// Motor de recorridos en un navegador real (Chromium), sobre el arnés
// tests/e2e/arnes.html. Cubre los criterios de aceptación que necesitan diseño
// real: scroll hasta el ancla, ancla que llega tarde, globo legible que no tapa
// el elemento a 360 px, teclado y foco, y texto que no se ejecuta.

import { test, expect } from '@playwright/test';

const abrir = (page, caso, extra = '') => page.goto(`/tests/e2e/arnes.html?caso=${caso}${extra}`);
const globo = (page) => page.getByRole('dialog');
const eventos = (page) => page.evaluate(() => window.__eventos);
const caja = async (loc) => loc.boundingBox();
const seCruzan = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const HALO = 6;
const conHalo = (b) => ({ x: b.x - HALO, y: b.y - HALO, width: b.width + 2 * HALO, height: b.height + 2 * HALO });

test('un ancla bajo el scroll se muestra: la página se desplaza hasta ella', async ({ page }) => {
    await abrir(page, 'scroll');
    await expect(globo(page)).toContainText('Botón de ayuda');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(globo(page)).toContainText('Elemento lejano');
    const lejos = page.locator('[data-tour="global.menu-lateral"]');
    await expect(lejos).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    // El desplazamiento puede ser animado (scroll-behavior: smooth en la app) y
    // el resalte lo sigue: al asentarse, rodea al elemento, bajo la cabecera.
    await expect.poll(async () => {
        const b = await caja(lejos);
        const r = await caja(page.locator('.recorrido-resalte'));
        return Math.max(Math.abs(r.x - (b.x - HALO)), Math.abs(r.y - (b.y - HALO)));
    }).toBeLessThan(2);
    expect((await caja(lejos)).y).toBeGreaterThanOrEqual(64);
});

test('un ancla que se renderiza tarde se muestra dentro del plazo', async ({ page }) => {
    await abrir(page, 'tarde', '&tarde=1500&espera=4000');
    await expect(globo(page)).toHaveCount(0);
    await expect(globo(page)).toContainText('Elemento que llega tarde', { timeout: 4000 });
});

test('con un plazo menor que la demora, el paso se salta y nada se registra', async ({ page }) => {
    const avisos = [];
    page.on('console', (m) => { if (m.type() === 'warning') avisos.push(m.text()); });
    await abrir(page, 'tarde', '&tarde=3000&espera=500');
    await expect.poll(() => page.evaluate(() => window.__terminado)).toBe(true);
    expect(await eventos(page)).toEqual([]);
    expect(avisos.join('\n')).toMatch(/ningún paso se pudo mostrar/);
});

test('un paso cuyo ancla no existe se salta y queda en la consola; el último visible pasa a ser el final', async ({ page }) => {
    const avisos = [];
    page.on('console', (m) => { if (m.type() === 'warning') avisos.push(m.text()); });
    await abrir(page, 'faltante', '&espera=300');
    await expect(globo(page)).toContainText('Botón de ayuda');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByRole('button', { name: 'Finalizar' })).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: 'Finalizar' }).click();
    expect(await eventos(page)).toEqual([{ tipo: 'completar', ultimoPaso: 1 }]);
    expect(avisos.filter((a) => a.includes('ancla no encontrada')).length).toBe(2);
});

test('cerrar con la X en el primer paso registra un cierre, no un completado (fallas 3 y 4)', async ({ page }) => {
    await abrir(page, 'scroll');
    await page.getByRole('button', { name: 'Cerrar recorrido' }).click();
    expect(await eventos(page)).toEqual([{ tipo: 'cerrar', ultimoPaso: 0 }]);
});

test('cerrar con la X en el último paso tampoco completa; solo el botón final lo hace', async ({ page }) => {
    await abrir(page, 'scroll');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByRole('button', { name: 'Finalizar' })).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar recorrido' }).click();
    expect(await eventos(page)).toEqual([{ tipo: 'cerrar', ultimoPaso: 1 }]);
});

test('Escape cierra; Omitir registra omitido', async ({ page }) => {
    await abrir(page, 'scroll');
    await expect(globo(page)).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await eventos(page)).toEqual([{ tipo: 'cerrar', ultimoPaso: 0 }]);
    await abrir(page, 'scroll');
    await page.getByRole('button', { name: 'Omitir recorrido' }).click();
    expect(await eventos(page)).toEqual([{ tipo: 'omitir', ultimoPaso: 0 }]);
});

test('teclado: el foco entra al globo, las flechas avanzan y retroceden, y Tab no sale del globo', async ({ page }) => {
    await abrir(page, 'scroll');
    await expect(page.getByRole('button', { name: 'Siguiente' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(globo(page)).toContainText('Elemento lejano');
    await page.keyboard.press('ArrowLeft');
    await expect(globo(page)).toContainText('Botón de ayuda');
    for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    }
    await expect(globo(page)).toHaveAttribute('aria-modal', 'true');
});

test('título y descripción con HTML se muestran como texto y no se ejecutan (falla 8)', async ({ page }) => {
    await abrir(page, 'xss');
    await expect(globo(page)).toContainText('<script>window.__xss=2</script>Título');
    await expect(globo(page)).toContainText('<img src=x onerror="window.__xss=1">Texto');
    await expect(globo(page).locator('img, script')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('un anuncio va centrado, sin resaltar nada, y se completa con Entendido', async ({ page }) => {
    await abrir(page, 'anuncio');
    await expect(globo(page)).toHaveAttribute('data-colocacion', 'centrado');
    await expect(page.locator('.recorrido-resalte')).toHaveCount(0);
    await page.getByRole('button', { name: 'Entendido' }).click();
    expect(await eventos(page)).toEqual([{ tipo: 'completar', ultimoPaso: 0 }]);
});

test.describe('a 360 px', () => {
    test.use({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });

    test('el globo es legible, cabe en la pantalla y no tapa el elemento resaltado, en cada paso', async ({ page }) => {
        await abrir(page, 'scroll');
        for (const [titulo, ancla] of [['Botón de ayuda', 'global.boton-ayuda'], ['Elemento lejano', 'global.menu-lateral']]) {
            await expect(globo(page)).toContainText(titulo);
            await expect(globo(page)).toHaveAttribute('data-colocacion', /anclado-/);
            // Lo que se mide es la posición final: después de cualquier cambio de alto del globo.
            await page.waitForTimeout(300);
            const g = await caja(globo(page));
            const objetivo = await caja(page.locator(`[data-tour="${ancla}"]`));
            expect(g.x).toBeGreaterThanOrEqual(0);
            expect(g.y).toBeGreaterThanOrEqual(0);
            expect(g.x + g.width).toBeLessThanOrEqual(360);
            expect(g.y + g.height).toBeLessThanOrEqual(640);
            expect(seCruzan(g, conHalo(objetivo)), `${titulo}: el globo tapa el elemento`).toBe(false);
            const letra = await globo(page).locator('.recorrido-globo__texto').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
            expect(letra).toBeGreaterThanOrEqual(14);
            const alto = await page.getByRole('button', { name: /Siguiente|Finalizar/ }).evaluate((el) => el.getBoundingClientRect().height);
            expect(alto).toBeGreaterThanOrEqual(44);
            if (titulo === 'Botón de ayuda') await page.getByRole('button', { name: 'Siguiente' }).click();
        }
    });
});
