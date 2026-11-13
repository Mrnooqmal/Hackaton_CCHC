// Prueba en terreno del 11 de noviembre de 2026 (dev), Encuestas:
//   1. Con señal: "Trabajadores alcanzados 48 de 0 en la obra".
//   2. Sin señal: "Todas · 0" y "Encuestas creadas 0".
//   4. Sin señal: tres avisos apilados (uno rojo) y "Nueva encuesta" a la vista.
//
// "Sin señal" como en Android: el navegador cree que hay red (`navigator.onLine`
// sigue en true) pero las peticiones a la API no llegan a ninguna parte.

import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';

async function prepararApp(page, { sinSenal, encuestas = [], alcance }) {
    await page.addInitScript(() => {
        localStorage.setItem('auth_token', 'token-de-prueba');
        localStorage.setItem('session_id', 'sesion-de-prueba');
        localStorage.setItem('obraScope', 'empresa');
    });
    await page.route(`${API}/**`, async (ruta) => {
        const url = new URL(ruta.request().url());
        const json = (data) => ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname === '/auth/me') {
            return json({ success: true, data: {
                user: { personaId: 'p-1', tenantId: 't-1', nombre: 'Ana', apellidoPaterno: 'Rojas', rol: 'admin', permisos: [], habilitado: true, passwordTemporal: false },
                session: { expiresAt: new Date(Date.now() + 3600e3).toISOString() },
            } });
        }
        if (sinSenal) return ruta.abort('internetdisconnected');
        if (url.pathname === '/ayuda/progreso') return json({ success: true, data: { progreso: [], registrar: false } });
        if (url.pathname === '/surveys') return json({ success: true, data: { total: encuestas.length, surveys: encuestas, alcance } });
        return json({ success: true, data: [] });
    });
}

test('sin señal, Encuestas: un solo aviso, neutro; "No disponible sin conexión" en vez de ceros; nada que necesite conexión', async ({ page }) => {
    await prepararApp(page, { sinSenal: true });
    await page.goto('/surveys');
    await expect(page.getByRole('heading', { name: 'Encuestas', level: 1 })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('No disponible sin conexión').first()).toBeVisible({ timeout: 10000 });

    // Un solo aviso de que no hay señal, el del layout, y no rojo.
    await expect(page.getByText(/Sin señal/)).toHaveCount(1);
    const aviso = page.locator('.sincronizador-firmas--sin-senal');
    await expect(aviso).toHaveCount(1);
    await expect(page.locator('.alert-danger, .alert-error, [role="alert"]')).toHaveCount(0);
    await expect(page.getByText(/No hay señal\. Esto se carga/)).toHaveCount(0);

    // Ni ceros ni cuentas.
    await expect(page.getByText(/Todas · \d/)).toHaveCount(0);
    await expect(page.locator('.survey-stat-tile')).toHaveCount(0);

    // Nada que necesite conexión.
    await expect(page.getByRole('button', { name: /Nueva encuesta|Crear/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Enviar ahora' })).toHaveCount(0);
});

test('con señal, "Trabajadores alcanzados" usa el alcance del servidor: personas distintas de las de la empresa', async ({ page }) => {
    const encuesta = (n) => ({
        surveyId: `s-${n}`, titulo: `Encuesta ${n}`, descripcion: '', estado: 'activa', createdAt: '2026-11-0' + n + 'T12:00:00Z',
        createdBy: 'p-1', totalPreguntas: 2, audienceType: 'todos', stats: { totalRecipients: 16, responded: 4 }, miAsignacion: null,
    });
    // Tres encuestas a las mismas 16 personas: antes decía "48 de 0".
    await prepararApp(page, { sinSenal: false, encuestas: [1, 2, 3].map(encuesta), alcance: { personasAlcanzadas: 16, totalPersonas: 20 } });
    await page.goto('/surveys');
    const tile = page.locator('.survey-stat-tile').filter({ hasText: 'Trabajadores alcanzados' });
    await expect(tile).toBeVisible({ timeout: 10000 });
    await expect(tile.locator('.survey-stat-tile-value')).toHaveText('16');
    await expect(tile.locator('.survey-stat-tile-sub')).toHaveText('de 20 en la empresa');
    await expect(page.getByText(/Sin señal/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Nueva encuesta/ })).toBeVisible();
});

test('sin señal, Inicio y Mis firmas no dicen "Al día" ni "Todo al día": no está disponible', async ({ page }) => {
    await prepararApp(page, { sinSenal: true });
    await page.goto('/');
    await expect(page.getByText('No disponible sin conexión').first()).toBeVisible({ timeout: 10000 });
    for (const falso of ['Al día', 'Todo al día', 'Nada hoy', 'Ninguno', 'Sin actividades']) {
        await expect(page.getByText(falso, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByText(/Sin señal/)).toHaveCount(1);

    await page.goto('/my-signatures');
    await expect(page.getByText('No disponible sin conexión').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Todo al día', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/de 0 al día/)).toHaveCount(0);
    await page.getByRole('tab', { name: /Historial/ }).click();
    await expect(page.getByText('Sin historial', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Sin señal/)).toHaveCount(1);
});
