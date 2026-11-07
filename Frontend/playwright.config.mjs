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

export default defineConfig({
    testDir: 'tests/e2e',
    testMatch: '*.spec.mjs',
    fullyParallel: true,
    reporter: 'list',
    use: { baseURL: `http://localhost:${PUERTO}` },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: `node ./node_modules/vite/bin/vite.js --port ${PUERTO} --strictPort`,
        url: `http://localhost:${PUERTO}/tests/e2e/arnes.html`,
        reuseExistingServer: false,
        timeout: 60000,
    },
});
