// En el build de prod, las páginas del manual pendientes de revisión normativa
// (hoy, FUF y DS 44) no se publican y nada lleva a ellas por un enlace roto
// (vite-manual-pendiente.ts y src/manual/publicacion.ts). Corre sobre el build
// real de prod servido con `vite preview` (puerto 5182).

import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://localhost:5182' });

const menu = (page) => page.getByRole('navigation', { name: 'Secciones del manual' });

test('prod: la sección FUF no está en el menú y su página no existe', async ({ page }) => {
    await page.goto('/manual/empezar');
    await expect(menu(page).getByRole('link', { name: 'Firmar lo que te asignaron' })).toBeVisible();
    await expect(menu(page).getByText('FUF y DS 44')).toHaveCount(0);
    await expect(menu(page).locator('a[href^="/manual/fuf"]')).toHaveCount(0);
    await page.goto('/manual/fuf/firmas');
    await expect(page.getByText('La página que buscas no existe en el manual.')).toBeVisible();
});

test('prod: las frases que enlazan a FUF se leen bien como texto, y la fila de la portada no está', async ({ page }) => {
    for (const [ruta, frase, sobra] of [
        ['/manual/terreno/firmar', 'hasta tener la respuesta oficial.', 'Firmas digitales y DS 44'],
        ['/manual/roles/trabajador', 'La validez del PIN como firma electrónica está en consulta.', 'qué falta resolver'],
        ['/manual/obra/pedir-firmas', 'certifica que la capacitación se realizó.', 'Ver Capacitaciones'],
    ]) {
        await page.goto(ruta);
        const contenido = page.locator('main.manual-content');
        await expect(contenido).toContainText(frase);
        await expect(contenido).not.toContainText(sobra);
        await expect(page.locator('a[href^="/manual/fuf"]'), ruta).toHaveCount(0);
    }
    await page.goto('/manual/empezar');
    await expect(page.locator('main.manual-content table').filter({ hasText: 'Qué encontrarás' })).toContainText('En terreno');
    await expect(page.locator('main.manual-content')).not.toContainText('FUF y DS 44');
    await page.goto('/manual');
    await expect(page.locator('a[href^="/manual/fuf"]')).toHaveCount(0);
});

test('prod: una dirección vieja de DS 44 lleva a la portada del manual, no a una página que no existe', async ({ page }) => {
    await page.goto('/manual/ds44/firmas-digitales');
    await expect(page).toHaveURL(/\/manual$/);
    await page.goto('/manual/ds44/epp');
    await expect(page).toHaveURL(/\/manual\/obra\/epp$/);
});
