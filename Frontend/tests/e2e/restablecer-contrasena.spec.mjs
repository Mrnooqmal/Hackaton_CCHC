import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';
const ADMIN = {
    personaId: 'p-admin', tenantId: 't-1', rut: '9.876.543-3', nombre: 'Ana', apellidoPaterno: 'Rojas', rol: 'admin',
    permisos: [], habilitado: true, passwordTemporal: false, pinConfigurado: true,
};
const TRABAJADOR = {
    personaId: 'p-2', tenantId: 't-1', rut: '12.345.678-5', nombre: 'Juan', apellido: 'Paz', apellidoPaterno: 'Paz',
    rol: 'trabajador', estado: 'activo', tieneAccesoWeb: true, passwordTemporal: false, habilitado: true,
    pinConfigurado: true, obraIds: [], permisos: [], evidencias: [], cursos: [], asignaciones: [], historialAsignaciones: [],
    contactoEmergencia: { nombre: '', telefono: '', relacion: '' }, nivelEscolar: '', consentimientos: [], oposiciones: [],
};

async function preparar(page, { respuesta }) {
    const pedidos = [];
    await page.addInitScript((u) => {
        localStorage.setItem('auth_token', 'token-de-prueba');
        localStorage.setItem('session_id', 'sesion-de-prueba');
        localStorage.setItem('tenant_id', 't-1');
        localStorage.setItem('sesionLocal', JSON.stringify(u));
        localStorage.setItem('obraScope', 'empresa');
    }, ADMIN);
    await page.route(`${API}/**`, async (ruta) => {
        const url = new URL(ruta.request().url());
        const metodo = ruta.request().method();
        const json = (data, status = 200) => ruta.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname === '/auth/me') {
            return json({ success: true, data: { user: ADMIN, session: { expiresAt: new Date(Date.now() + 3600e3).toISOString() } } });
        }
        if (url.pathname.startsWith('/personas/by-rut/')) return json({ success: true, data: TRABAJADOR });
        if (url.pathname === '/personas/p-2/restablecer-contrasena' && metodo === 'POST') {
            pedidos.push(JSON.parse(ruta.request().postData() || '{}'));
            return respuesta.status ? json({ success: false, error: respuesta.error }, respuesta.status) : json({ success: true, data: respuesta });
        }
        if (url.pathname === '/ayuda/progreso') return json({ success: true, data: { progreso: [], registrar: false } });
        if (url.pathname.endsWith('/epp')) return json({ success: true, data: { epp: [] } });
        return json({ success: true, data: {} });
    });
    return pedidos;
}

const VENCE = new Date(Date.now() + 72 * 3600e3).toISOString();

test('restablecer pide un motivo de 10 a 120 caracteres, muestra la temporal una vez y no la guarda en el navegador', async ({ page }) => {
    const pedidos = await preparar(page, { respuesta: { password: 'K7MP-3QXR-9HTW', vence: VENCE, sesionesCerradas: true, correo: 'sin-correo' } });
    await page.goto('/personas/12.345.678-5');
    await page.getByRole('button', { name: 'Restablecer contraseña' }).first().click();

    const confirmar = page.getByRole('button', { name: 'Restablecer contraseña' }).last();
    await expect(confirmar).toBeDisabled();
    await page.getByPlaceholder('Por ejemplo: olvidó su contraseña y no tiene correo').fill('corto');
    await expect(confirmar).toBeDisabled();
    await page.getByPlaceholder('Por ejemplo: olvidó su contraseña y no tiene correo').fill('Olvidó su contraseña y no tiene correo');
    await confirmar.click();

    await expect(page.getByLabel('Contraseña temporal', { exact: true })).toHaveText('K7MP-3QXR-9HTW');
    expect(pedidos).toEqual([{ motivo: 'Olvidó su contraseña y no tiene correo' }]);
    const guardado = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(guardado).not.toContain('K7MP-3QXR-9HTW');

    await page.getByRole('button', { name: 'Ya la entregué' }).click();
    await expect(page.getByLabel('Contraseña temporal', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Restablecer contraseña' }).first().click();
    await expect(page.getByPlaceholder('Por ejemplo: olvidó su contraseña y no tiene correo')).toHaveValue('');
    await expect(page.getByLabel('Contraseña temporal', { exact: true })).toHaveCount(0);
});

test('si no se pudieron cerrar las sesiones, lo dice', async ({ page }) => {
    await preparar(page, { respuesta: { password: 'K7MP-3QXR-9HTW', vence: VENCE, sesionesCerradas: false, correo: 'enviado' } });
    await page.goto('/personas/12.345.678-5');
    await page.getByRole('button', { name: 'Restablecer contraseña' }).first().click();
    await page.getByPlaceholder('Por ejemplo: olvidó su contraseña y no tiene correo').fill('Olvidó su contraseña y no tiene correo');
    await page.getByRole('button', { name: 'Restablecer contraseña' }).last().click();
    await expect(page.getByRole('alert').filter({ hasText: 'No pudimos cerrar las sesiones abiertas' })).toBeVisible();
});

test('un rechazo del servidor se muestra y no aparece ninguna contraseña', async ({ page }) => {
    await preparar(page, { respuesta: { status: 403, error: 'No puedes restablecer la contraseña de alguien que tiene permisos que tú no tienes' } });
    await page.goto('/personas/12.345.678-5');
    await page.getByRole('button', { name: 'Restablecer contraseña' }).first().click();
    await page.getByPlaceholder('Por ejemplo: olvidó su contraseña y no tiene correo').fill('Olvidó su contraseña y no tiene correo');
    await page.getByRole('button', { name: 'Restablecer contraseña' }).last().click();
    await expect(page.getByRole('alert').filter({ hasText: 'permisos que tú no tienes' })).toBeVisible();
    await expect(page.getByLabel('Contraseña temporal', { exact: true })).toHaveCount(0);
});
