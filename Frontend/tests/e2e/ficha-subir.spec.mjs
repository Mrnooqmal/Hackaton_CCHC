import { test, expect } from '@playwright/test';

const usuario = { personaId: 'p-admin', tenantId: 't1', rol: 'admin', nombre: 'Admin', habilitado: true, permisos: [] };
const persona = { personaId: 'p1', tenantId: 't1', rut: '11111111-1', nombre: 'Persona', apellido: 'Prueba', cargo: 'jornal', rol: 'trabajador', habilitado: true, obraIds: [], asignaciones: [] };
const documento = { documentId: 'd1', tipo: 'IRL', asignaciones: [{ personaId: 'p1' }] };
const vacio = { epp: [], cargos: [], progreso: [], firmas: [], historial: [], pendientes: [], solicitudes: [], activities: [], surveys: [], documents: [], obras: [], entregas: [], items: [], personas: [], notifications: [], messages: [], total: 0 };

async function abrirFicha(page, { documentos = [documento], fallo = null, usuarioActual = usuario, ficha = persona } = {}) {
    const escrituras = [];
    const cuerpos = [];
    const lecturas = [];
    await page.addInitScript(() => {
        localStorage.setItem('auth_token', 'prueba');
        localStorage.setItem('tenant_id', 't1');
    });
    await page.route((url) => url.port === '3001' || !['localhost', '127.0.0.1'].includes(url.hostname), (route) => {
        const pedido = route.request();
        const url = new URL(pedido.url());
        const ruta = url.pathname;
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
            body: JSON.stringify(body),
        });
        if (pedido.method() === 'OPTIONS') return json({});
        if (pedido.method() !== 'GET') escrituras.push(`${pedido.method()} ${ruta}`);
        if (pedido.method() !== 'GET' && ruta.includes('/documents/')) cuerpos.push(pedido.postDataJSON());
        if (pedido.method() === 'GET' && ruta.endsWith('/documents')) lecturas.push(ruta);
        if (url.hostname === 's3.invalid' && fallo === 'red') return route.abort();
        if (url.hostname === 's3.invalid') return json({}, fallo === 's3' ? 403 : 200);
        if (ruta.endsWith('/auth/me')) return json({ success: true, data: { user: usuarioActual, session: { sessionId: 's', expiresAt: new Date(Date.now() + 3600000).toISOString() } } });
        if (pedido.method() === 'PUT' && ruta.includes('/personas/') && fallo === 'foto') return json({ success: false, error: 'No tienes permiso para cambiar la foto' }, 403);
        if (ruta.includes('11111111') || ruta.includes('/personas/rut')) return json({ success: true, data: ficha });
        if (ruta.endsWith('/uploads/presigned-url')) return json({ success: true, data: { uploadUrl: 'https://s3.invalid/k', fileKey: 'k' } });
        if (ruta.endsWith('/uploads/confirm')) return json({ success: true, data: { documento: { url: 'k' } } });
        if (ruta.includes('/documents/')) return json(fallo === 'guardar' ? { success: false, error: 'No tienes permiso para modificar documentos' } : { success: true, data: {} });
        if (ruta.endsWith('/documents') && fallo === 'lista') return json({ success: false, error: 'x' });
        if (ruta.endsWith('/documents')) return json({ success: true, data: { documents: documentos } });
        return json({ success: true, data: vacio });
    });
    await page.goto('/personas/11111111-1');
    await page.getByText('Asignaciones', { exact: true }).click();
    const onboarding = page.getByRole('region', { name: 'Onboarding DS 44' });
    await expect(onboarding).toBeVisible();
    return { onboarding, escrituras, cuerpos, lecturas };
}

async function elegirArchivo(page, onboarding) {
    const selector = page.waitForEvent('filechooser');
    await onboarding.getByText('Subir', { exact: true }).first().click();
    await (await selector).setFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
}

test('sin documento asignado no ofrece subir y lo explica', async ({ page }) => {
    const { onboarding } = await abrirFicha(page, { documentos: [] });
    await expect(onboarding.getByText('Sin documento asignado').first()).toBeVisible();
    await expect(onboarding.locator('input[type=file]')).toHaveCount(0);
    await expect(onboarding.getByText('no admiten archivo')).toHaveCount(1);
});

test('con documento asignado sube el archivo y lo guarda', async ({ page }) => {
    const { onboarding, escrituras, cuerpos, lecturas } = await abrirFicha(page);
    const lecturasAntes = lecturas.length;
    await elegirArchivo(page, onboarding);
    await expect.poll(() => escrituras).toContain('PUT /documents/d1');
    expect(cuerpos[0]).toMatchObject({ s3Key: 'k', archivoUrl: 'k', archivoNombre: 'a.pdf' });
    await expect.poll(() => lecturas.length).toBeGreaterThan(lecturasAntes);
    await expect(onboarding.getByRole('alert')).toHaveCount(0);
});

test('si S3 rechaza el archivo avisa y no toca el documento', async ({ page }) => {
    const { onboarding, escrituras } = await abrirFicha(page, { fallo: 's3' });
    await elegirArchivo(page, onboarding);
    await expect(onboarding.getByRole('alert')).toContainText('S3 rechazó el archivo (403).');
    expect(escrituras).not.toContain('PUT /documents/d1');
});

test('si no se puede guardar el documento muestra el motivo', async ({ page }) => {
    const { onboarding } = await abrirFicha(page, { fallo: 'guardar' });
    await elegirArchivo(page, onboarding);
    await expect(onboarding.getByRole('alert')).toContainText('No tienes permiso para modificar documentos');
});

test('si la foto no se guarda muestra el motivo', async ({ page }) => {
    await abrirFicha(page, { fallo: 'foto' });
    const selector = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Cambiar foto' }).click();
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await (await selector).setFiles({ name: 'f.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await expect(page.getByRole('alert')).toContainText('No tienes permiso para cambiar la foto');
});

test('sin permiso de onboarding no ofrece subir', async ({ page }) => {
    const lector = { ...usuario, rol: 'trabajador', permisos: ['personas.ver', 'personas.detalle'] };
    const { onboarding } = await abrirFicha(page, { usuarioActual: lector });
    await expect(onboarding.getByText('Pendiente de subir').first()).toBeVisible();
    await expect(onboarding.locator('input[type=file]')).toHaveCount(0);
});

test('reemplazar un documento firmado pide confirmación antes de subir', async ({ page }) => {
    const firmado = { ...documento, tipo: 'CAPACITACION_SST', s3Key: 'v', requiereFirmaRelator: true, asignaciones: [{ personaId: 'p1', estado: 'firmado' }] };
    const { onboarding, escrituras } = await abrirFicha(page, { documentos: [firmado] });
    const aviso = page.getByRole('alertdialog', { name: 'Reemplazar documento firmado' });
    const elegir = async () => {
        const selector = page.waitForEvent('filechooser');
        await onboarding.getByText('Reemplazar', { exact: true }).click();
        await (await selector).setFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
        await expect(aviso).toBeVisible();
    };
    await elegir();
    await aviso.getByRole('button', { name: 'Cancelar' }).click();
    await expect(aviso).toHaveCount(0);
    expect(escrituras).not.toContain('PUT /documents/d1');
    await elegir();
    await aviso.getByRole('button', { name: 'Reemplazar' }).click();
    await expect.poll(() => escrituras).toContain('PUT /documents/d1');
});

test('lo firmado en otra obra no completa el ítem de la obra en vista', async ({ page }) => {
    const documentos = [{ ...documento, obraId: 'obraA', s3Key: 'v', asignaciones: [{ personaId: 'p1', estado: 'firmado' }] }];
    const { onboarding } = await abrirFicha(page, { documentos, ficha: { ...persona, obraIds: ['obraB'] } });
    await expect(onboarding.getByText('Sin documento asignado').first()).toBeVisible();
    await expect(onboarding.getByText('0 de')).toBeVisible();
});

test('un documento compartido con otras personas no se reemplaza desde la ficha', async ({ page }) => {
    const compartido = { ...documento, clasificacion: 'obra', s3Key: 'v', asignaciones: [{ personaId: 'p1' }, { personaId: 'p2' }] };
    const { onboarding } = await abrirFicha(page, { documentos: [compartido] });
    await expect(onboarding.getByText('Pendiente de firma').first()).toBeVisible();
    await expect(onboarding.locator('input[type=file]')).toHaveCount(0);
});

test('con documentos en dos obras sube al de la obra de la persona', async ({ page }) => {
    const documentos = [{ ...documento, documentId: 'otra', obraId: 'obraA' }, { ...documento, documentId: 'actual', obraId: 'obraB' }];
    const { onboarding, escrituras } = await abrirFicha(page, { documentos, ficha: { ...persona, obraIds: ['obraB'] } });
    await elegirArchivo(page, onboarding);
    await expect.poll(() => escrituras).toContain('PUT /documents/actual');
});

test('si falla el listado de documentos lo avisa', async ({ page }) => {
    const { onboarding } = await abrirFicha(page, { fallo: 'lista' });
    await expect(onboarding.getByRole('alert')).toContainText('No se pudieron cargar los documentos');
});

test('sin red al subir avisa y no toca el documento', async ({ page }) => {
    const { onboarding, escrituras } = await abrirFicha(page, { fallo: 'red' });
    await elegirArchivo(page, onboarding);
    await expect(onboarding.getByRole('alert')).toContainText('No hay señal');
    expect(escrituras).not.toContain('PUT /documents/d1');
});

test('si la foto no se puede quitar muestra el motivo', async ({ page }) => {
    await abrirFicha(page, { fallo: 'foto', ficha: { ...persona, fotoPerfil: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' } });
    await page.getByRole('button', { name: 'Eliminar foto' }).click();
    await expect(page.getByRole('alert')).toContainText('No tienes permiso para cambiar la foto');
});

test('una imagen dañada como foto avisa', async ({ page }) => {
    await abrirFicha(page);
    const selector = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Cambiar foto' }).click();
    await (await selector).setFiles({ name: 'rota.png', mimeType: 'image/png', buffer: Buffer.from('no es una imagen') });
    await expect(page.getByRole('alert')).toContainText('No se pudo guardar la foto.');
});
