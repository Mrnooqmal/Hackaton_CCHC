import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';
const ADMIN = {
    personaId: 'p-admin', tenantId: 't-1', nombre: 'Ana', apellidoPaterno: 'Rojas', rol: 'admin',
    permisos: ['persona.activar_acceso', 'personas.ver', 'personas.crear'], habilitado: true, passwordTemporal: false,
};
const EN_7_DIAS = new Date(Date.now() + 7 * 24 * 3600e3).toISOString();
const HACE_UN_DIA = new Date(Date.now() - 24 * 3600e3).toISOString();

const persona = (id, nombre, extra) => ({
    personaId: id, nombre, apellido: 'Paz', rut: '12.345.678-5', rol: 'trabajador', rolNombre: 'Persona trabajadora',
    estado: 'activo', tieneAccesoWeb: true, activacionPendiente: true, obraIds: ['o-1'], ...extra,
});

async function preparar(page, { respuestas }) {
    const pedidos = [];
    await page.addInitScript(() => {
        localStorage.setItem('auth_token', 'token-de-prueba');
        localStorage.setItem('session_id', 'sesion-de-prueba');
        localStorage.setItem('sesionLocal', '{}');
        localStorage.setItem('selectedObraId', 'o-1');
        localStorage.setItem('obraScope', 'obra');
    });
    await page.route(`${API}/**`, async (ruta) => {
        const url = new URL(ruta.request().url());
        const metodo = ruta.request().method();
        const json = (data, status = 200) => ruta.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname === '/auth/me') {
            return json({ success: true, data: { user: ADMIN, session: { expiresAt: new Date(Date.now() + 3600e3).toISOString() } } });
        }
        if (url.pathname === '/obras') return json({ success: true, data: [{ obraId: 'o-1', nombre: 'Obra Norte' }] });
        if (url.pathname === '/personas' && metodo === 'GET') {
            return json({ success: true, data: { personas: [
                persona('p-1', 'Juan', { credencialInicial: true, passwordTemporal: true, passwordTemporalVence: HACE_UN_DIA }),
                persona('p-2', 'Rosa', { credencialInicial: true, passwordTemporal: true, passwordTemporalVence: EN_7_DIAS }),
            ] } });
        }
        if (url.pathname === '/personas/reactivar-inicial' && metodo === 'POST') {
            pedidos.push(JSON.parse(ruta.request().postData() || '{}'));
            const r = respuestas[Math.min(pedidos.length - 1, respuestas.length - 1)];
            return r.status ? json({ success: false, error: r.error }, r.status) : json({ success: true, data: { vence: EN_7_DIAS, ...r } });
        }
        return json({ success: true, data: [] });
    });
    return pedidos;
}

const omitidas = (extra = {}) => ({ temporalVigente: 0, sinPermiso: 0, sinInicial: 0, conflicto: 0, ...extra });

test('las etiquetas dicen si la contraseña inicial está vigente o vencida', async ({ page }) => {
    await preparar(page, { respuestas: [] });
    await page.goto('/personas/activacion');
    await expect(page.getByText(/Contraseña inicial vencida/)).toBeVisible();
    await expect(page.getByText(/Contraseña inicial vigente/)).toBeVisible();
});

test('sin obra elegida no se ofrece reactivar; con obra, pide confirmar antes de hacer nada', async ({ page }) => {
    const pedidos = await preparar(page, { respuestas: [{ reactivadas: 1, yaReactivadas: 1, omitidas: omitidas(), restantes: 0 }] });
    await page.goto('/personas/activacion');
    await expect(page.getByText('Juan Paz')).toBeVisible();
    await page.getByLabel('Filtrar por obra').click();
    await page.getByRole('option', { name: 'Todas las obras' }).click();
    await expect(page.getByRole('button', { name: 'Reactivar acceso inicial' })).toHaveCount(0);

    await page.getByLabel('Filtrar por obra').click();
    await page.getByRole('option', { name: 'Obra Norte' }).click();
    await page.getByRole('button', { name: 'Reactivar acceso inicial' }).click();
    await expect(page.getByText(/cualquiera que conozca su RUT también/)).toBeVisible();
    expect(pedidos).toHaveLength(0);

    await page.getByRole('button', { name: 'Reactivar por 7 días' }).click();
    await expect(page.getByRole('status')).toContainText('2 personas pueden entrar con los cuatro primeros dígitos de su RUT');
    expect(pedidos).toEqual([{ obraId: 'o-1' }]);
});

test('si el servidor dice que faltan personas, vuelve a pedir hasta terminar y muestra lo que quedó fuera', async ({ page }) => {
    const pedidos = await preparar(page, { respuestas: [
        { reactivadas: 20, yaReactivadas: 0, omitidas: omitidas(), restantes: 15 },
        { reactivadas: 15, yaReactivadas: 20, omitidas: omitidas({ temporalVigente: 1, sinPermiso: 2 }), restantes: 0 },
    ] });
    await page.goto('/personas/activacion');
    await page.getByRole('button', { name: 'Reactivar acceso inicial' }).click();
    await page.getByRole('button', { name: 'Reactivar por 7 días' }).click();
    const resumen = page.getByRole('status');
    await expect(resumen).toContainText('35 personas pueden entrar');
    await expect(resumen).toContainText('1 con una temporal de 2 horas vigente');
    await expect(resumen).toContainText('2 tienen permisos que tú no tienes');
    expect(pedidos).toHaveLength(2);
});

test('un error del servidor se muestra y no se presenta como hecho', async ({ page }) => {
    await preparar(page, { respuestas: [{ status: 403, error: 'No tienes permiso para reactivar el acceso de otras personas' }] });
    await page.goto('/personas/activacion');
    await page.getByRole('button', { name: 'Reactivar acceso inicial' }).click();
    await page.getByRole('button', { name: 'Reactivar por 7 días' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'No tienes permiso' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
});
