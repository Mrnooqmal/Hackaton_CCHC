import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';
const USUARIO = {
    personaId: 'p-1', tenantId: 't-1', rut: '12.345.678-5', nombre: 'Ana', apellidoPaterno: 'Rojas', rol: 'prevencionista',
    permisos: ['incidentes.reportar', 'incidentes.historial'], habilitado: true, passwordTemporal: false, pinConfigurado: true,
};
const CASO = {
    incidentId: 'i-1', tenantId: 't-1', tipo: 'accidente', clasificacion: 'incidente', gravedad: 'leve', estado: 'en_investigacion',
    fecha: '2026-11-26', hora: '10:00', descripcion: 'Caso de prueba', evidencias: [], triaje: { tipo: 'accidente' },
};

async function preparar(page, { alAnular, estado = 'en_investigacion' } = {}) {
    const servidor = { anulado: null, motivos: [], lecturas: 0 };
    await page.addInitScript((u) => {
        localStorage.setItem('auth_token', 'token-de-prueba');
        localStorage.setItem('session_id', 'sesion-de-prueba');
        localStorage.setItem('sesionLocal', JSON.stringify(u));
    }, USUARIO);
    await page.route(`${API}/**`, async (ruta) => {
        const url = new URL(ruta.request().url());
        const json = (cuerpo, status = 200) => ruta.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) });
        if (url.pathname === '/auth/me') {
            return json({ success: true, data: { user: USUARIO, session: { expiresAt: new Date(Date.now() + 3600e3).toISOString() } } });
        }
        if (url.pathname === '/incidents/i-1') return json({ success: true, data: { ...CASO, estado } });
        if (url.pathname === '/incidents/i-1/documents') {
            servidor.lecturas += 1;
            return json({ success: true, data: { archivos: [{
                papelId: 'papel-1', tipo: 'diat', nombreArchivo: 'diat.pdf', tipoMime: 'application/pdf', subidoPor: 'p-1',
                subidoEn: '2026-11-26T12:00:00.000Z', fechaDocumento: null, tamano: 1000, contieneSalud: true,
                ...(servidor.anulado ? { anulado: servidor.anulado } : {}),
            }], requeridos: [], avance: { cumplidos: 0, total: 0, porcentaje: 100 } } });
        }
        if (url.pathname === '/incidents/i-1/documents/papel-1/anular') {
            const { motivo } = ruta.request().postDataJSON();
            servidor.motivos.push(motivo);
            if (alAnular) return json(alAnular.cuerpo, alAnular.status);
            servidor.anulado = { anuladoEn: '2026-11-26T13:00:00.000Z', anuladoPor: 'p-1', motivo };
            return json({ success: true, data: {} });
        }
        return json({ success: true, data: [] });
    });
    return servidor;
}

const seccion = (page) => page.getByRole('region', { name: 'Papeles del caso' });

test('anular un papel pide motivo, lo deja marcado y ya no ofrece anularlo', async ({ page }) => {
    const servidor = await preparar(page);
    await page.goto('/incidents/i-1');
    await seccion(page).getByRole('button', { name: 'Anular', exact: true }).click();
    await seccion(page).getByRole('button', { name: 'Anular papel' }).click();
    await expect(seccion(page).getByText('Escribe por qué se anula el papel.')).toBeVisible();
    expect(servidor.motivos).toEqual([]);

    await seccion(page).getByLabel('Por qué se anula').fill('Tipo equivocado');
    await seccion(page).getByRole('button', { name: 'Anular papel' }).click();
    await expect(seccion(page).getByText('Anulado', { exact: true })).toBeVisible();
    await expect(seccion(page).getByText(/Tipo equivocado/)).toBeVisible();
    await expect(seccion(page).getByRole('button', { name: 'Anular', exact: true })).toHaveCount(0);
    expect(servidor.motivos).toEqual(['Tipo equivocado']);
});

test('si el caso cambió mientras se anulaba, vuelve a leer los papeles', async ({ page }) => {
    const servidor = await preparar(page, { alAnular: { status: 409, cuerpo: { success: false, error: 'El caso cambió mientras lo editabas.' } } });
    await page.goto('/incidents/i-1');
    await seccion(page).getByRole('button', { name: 'Anular', exact: true }).click();
    const antes = servidor.lecturas;
    await seccion(page).getByLabel('Por qué se anula').fill('Tipo equivocado');
    await seccion(page).getByRole('button', { name: 'Anular papel' }).click();
    await expect.poll(() => servidor.lecturas).toBeGreaterThan(antes);
});

test('en un caso cerrado no se ofrece anular', async ({ page }) => {
    await preparar(page, { estado: 'cerrado' });
    await page.goto('/incidents/i-1');
    await expect(seccion(page).getByRole('button', { name: 'Descargar' })).toBeVisible();
    await expect(seccion(page).getByRole('button', { name: 'Anular', exact: true })).toHaveCount(0);
});
