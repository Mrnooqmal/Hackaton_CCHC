// Genera las imágenes de tests/capturas/catalogo.mjs. Ver playwright.capturas.config.mjs.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CAPTURAS } from './catalogo.mjs';
import { prepararPagina } from './api-simulada.mjs';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const DESTINO = process.env.CAPTURAS_PUBLICAR ? join(RAIZ, 'public', 'manual-img') : join(RAIZ, 'test-results', 'capturas');

for (const c of CAPTURAS) {
    test(c.archivo, async ({ page }, info) => {
        test.skip(Boolean(c.requiere) && !existsSync(join(RAIZ, c.requiere)), `espera ${c.requiere}`);
        const errores = [];
        page.on('pageerror', (e) => errores.push(e.message));
        const sinDatos = await prepararPagina(page, c);
        await page.goto(c.ruta);
        if (c.pasos) await c.pasos(page);
        await expect(page.getByText(c.ver).first()).toBeVisible({ timeout: 15000 });
        await page.evaluate(() => document.fonts.ready);
        if (c.marcar) {
            const marca = page.locator(c.marcar).first();
            await expect(marca).toBeVisible();
            // Lo marcado se tiene que ver entero: un aviso tapado por otro elemento no se publica.
            await expect.poll(() => marca.evaluate((el) => {
                const b = el.getBoundingClientRect();
                return [0.2, 0.5, 0.8].every((f) => el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height * f)));
            }), { message: `${c.marcar} está tapado por otro elemento`, timeout: 3000 }).toBe(true);
            await marca.evaluate((el) => { el.style.outline = '3px solid #dc2250'; el.style.outlineOffset = '6px'; el.style.borderRadius = '16px'; });
        }
        expect(errores, 'la app falló: revisa los datos simulados').toEqual([]);
        const sufijo = info.project.name === '360' ? '-360' : '';
        await page.screenshot({ path: join(DESTINO, `${c.archivo}${sufijo}.png`), animations: 'disabled', caret: 'hide' });
        if (sinDatos.size) console.log(`${c.archivo}: sin datos simulados: ${[...sinDatos].join(', ')}`);
    });
}
