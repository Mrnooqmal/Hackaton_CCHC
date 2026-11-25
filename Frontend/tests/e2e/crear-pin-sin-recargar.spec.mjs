import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';
const USUARIO = {
    personaId: 'p-1', tenantId: 't-1', rut: '12.345.678-5', nombre: 'Ana', apellidoPaterno: 'Rojas', rol: 'trabajador',
    permisos: ['actividades.ver'], habilitado: true, passwordTemporal: false, pinConfigurado: true,
};

async function preparar(page) {
    const estado = { pinConfigurado: false, lecturasFicha: 0 };
    await page.addInitScript((u) => {
        localStorage.setItem('auth_token', 'token-de-prueba');
        localStorage.setItem('session_id', 'sesion-de-prueba');
        localStorage.setItem('sesionLocal', JSON.stringify(u));
    }, USUARIO);
    await page.route(`${API}/**`, async (ruta) => {
        const url = new URL(ruta.request().url());
        const json = (data) => ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname === '/auth/me') {
            return json({ success: true, data: { user: USUARIO, session: { expiresAt: new Date(Date.now() + 3600e3).toISOString() } } });
        }
        if (url.pathname.startsWith('/personas/by-rut/')) {
            estado.lecturasFicha += 1;
            return json({ success: true, data: {
                ...USUARIO,
                pinConfigurado: estado.pinConfigurado,
                pinRestablecido: estado.pinConfigurado ? null : { por: 'p-admin', nombre: 'Luis Mora', en: new Date().toISOString() },
            } });
        }
        return json({ success: true, data: [] });
    });
    return estado;
}

test('con la sesión diciendo que tiene PIN, Configuración muestra "Crear PIN de firma nuevo" si se lo restablecieron, sin recargar', async ({ page }) => {
    await preparar(page);
    await page.goto('/configuracion');
    await expect(page.getByRole('button', { name: 'Crear PIN de firma nuevo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cambiar PIN de firma' })).toHaveCount(0);
});

test('si se lo restablecen con Configuración abierta, al volver a la pestaña aparece "Crear PIN de firma nuevo"', async ({ page }) => {
    const estado = await preparar(page);
    estado.pinConfigurado = true;
    await page.goto('/configuracion');
    await expect(page.getByRole('button', { name: 'Cambiar PIN de firma' })).toBeVisible();

    estado.pinConfigurado = false;
    const antes = estado.lecturasFicha;
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByRole('button', { name: 'Crear PIN de firma nuevo' })).toBeVisible();
    expect(estado.lecturasFicha).toBeGreaterThan(antes);
});
