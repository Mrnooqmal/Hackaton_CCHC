// Capturas del manual, con la app real y la API simulada: sin backend, sin AWS y
// sin datos de nadie. Salen en escritorio y a 360 px.
//
//   npm run capturas                          deja las imágenes en test-results/capturas
//   CAPTURAS_PUBLICAR=1 npm run capturas      reemplaza las de public/manual-img
//   npm run capturas -- -g firmas/firmar      solo una
//
// Qué se captura y cómo: tests/capturas/catalogo.mjs. No corre con `npm run
// test:e2e` ni en el despliegue: se corre a mano cuando cambia una pantalla.

import { defineConfig, devices } from '@playwright/test';

const PUERTO = 5184;

export default defineConfig({
    testDir: 'tests/capturas',
    testMatch: '*.spec.mjs',
    outputDir: 'test-results/capturas-trazas',
    workers: 2,
    reporter: 'list',
    use: { baseURL: `http://localhost:${PUERTO}`, locale: 'es-CL', timezoneId: 'America/Santiago' },
    projects: [
        { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
        { name: '360', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    ],
    webServer: {
        // VITE_API_URL fijo: la app nunca apunta a un ambiente real, aunque el
        // equipo tenga un .env local.
        command: `VITE_API_URL=http://localhost:3001 node ./node_modules/vite/bin/vite.js --port ${PUERTO} --strictPort`,
        url: `http://localhost:${PUERTO}/`,
        reuseExistingServer: false,
        timeout: 60000,
    },
});
