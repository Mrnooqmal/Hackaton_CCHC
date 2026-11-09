// Pruebas en navegador real de los recorridos guiados (D-33): scroll hasta el
// ancla, espera de un ancla que aparece tarde y globo legible sin tapar el
// elemento a 360 px. Se corren a mano antes de pasar a prod (decisión 5 de la
// Fase 0), no en el script de despliegue:
//
//   ./node_modules/.bin/playwright install chromium   # una vez por equipo
//   npm run test:e2e
//
// Levantan Vite en un puerto propio y abren el arnés `tests/e2e/arnes.html`,
// que monta el motor real con elementos colocados a propósito. El arnés no
// entra al build: `vite build` solo construye `index.html`.

import { defineConfig, devices } from '@playwright/test';

const PUERTO = 5181;
/** El build servido con `vite preview` (manual sin conexión). */
export const PUERTO_BUILD = 5182;

export default defineConfig({
    testDir: 'tests/e2e',
    testMatch: '*.spec.mjs',
    fullyParallel: true,
    reporter: 'list',
    use: { baseURL: `http://localhost:${PUERTO}` },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: [
        {
            command: `node ./node_modules/vite/bin/vite.js --port ${PUERTO} --strictPort`,
            url: `http://localhost:${PUERTO}/tests/e2e/arnes.html`,
            reuseExistingServer: false,
            timeout: 60000,
        },
        {
            // El build real de prod (con su service worker), para probar el
            // manual sin conexión y que en prod la sección FUF pendiente de
            // revisión quede fuera sin dejar enlaces rotos.
            command: `VITE_AMBIENTE=prod node ./node_modules/vite/bin/vite.js build --outDir dist-e2e --emptyOutDir --logLevel error && node ./node_modules/vite/bin/vite.js preview --outDir dist-e2e --port ${PUERTO_BUILD} --strictPort`,
            url: `http://localhost:${PUERTO_BUILD}/manual`,
            reuseExistingServer: false,
            timeout: 180000,
        },
    ],
});
