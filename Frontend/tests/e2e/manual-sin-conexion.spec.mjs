// El manual se puede leer sin conexión (Fase 4), sobre el build real servido
// con `vite preview`: el service worker precachea el chunk del manual y la
// navegación cae en el index.html del precaché.

import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://localhost:5182' });

test('una vez abierto con señal, el manual se navega y se recarga sin conexión', async ({ page, context }) => {
    await page.goto('/manual/empezar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Qué es Build & Serve');
    // Esperar a que el service worker controle la página.
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    await context.setOffline(true);
    await page.getByRole('navigation', { name: 'Secciones del manual' }).getByRole('link', { name: 'Firmar lo que te asignaron' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Firmar lo que te asignaron');

    await page.goto('/manual/obra/actividades');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Programar charlas y capacitaciones');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Programar charlas y capacitaciones');
});
