// Los recorridos iniciales reales (src/ayuda/recorridos.ts), en la app con la
// API simulada. Como entran en borrador, Playwright los sirve como publicados
// (solo cambia `estado`), que es como van a quedar después de la revisión.
//
// Lo que se fija: cada perfil recibe su introducción de Inicio y ninguna otra,
// los pasos se resuelven contra las anclas marcadas en las pantallas reales, y
// en el teléfono los pasos del menú lateral se saltan y queda el del botón de
// menú.

import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';

const PERFILES = {
    trabajador: { rol: 'trabajador', permisos: ['actividades.ver'], obras: [{ obraId: 'o-1', nombre: 'Edificio Las Lilas', estado: 'activa' }] },
    supervisor: {
        rol: 'supervisor',
        permisos: ['obras.ver', 'obras.detalle', 'obra.asignar_trabajadores', 'obra.firma_asistida', 'personas.ver', 'personas.detalle',
            'repositorio.ver', 'firmas.crear', 'incidentes.estadisticas', 'incidentes.historial', 'incidentes.reportar', 'actividades.ver', 'actividades.crear'],
        obras: [{ obraId: 'o-1', nombre: 'Edificio Las Lilas', estado: 'activa' }],
    },
    admin: { rol: 'admin', permisos: [], obras: [] },
    // Administrador dentro de una obra (lo elegido queda guardado, como al volver a entrar).
    'admin-obra': { rol: 'admin', permisos: [], obras: [{ obraId: 'o-1', nombre: 'Edificio Las Lilas', estado: 'activa' }], guardado: { obraScope: 'obra', selectedObraId: 'o-1' } },
    // Administrador en la vista de empresa, con obras.
    'admin-empresa': { rol: 'admin', permisos: [], obras: [{ obraId: 'o-1', nombre: 'Edificio Las Lilas', estado: 'activa' }], guardado: { obraScope: 'empresa' } },
};

async function prepararApp(page, perfil, { progreso = [] } = {}) {
    const p = PERFILES[perfil];
    const llamadas = { put: [] };
    await page.addInitScript((guardado) => {
        localStorage.setItem('auth_token', 'token-de-prueba');
        localStorage.setItem('session_id', 'sesion-de-prueba');
        for (const [k, v] of Object.entries(guardado || {})) localStorage.setItem(k, v);
    }, p.guardado);
    // Las definiciones reales, publicadas.
    await page.route(/\/src\/ayuda\/recorridos\.ts(\?.*)?$/, async (ruta) => {
        const original = await ruta.fetch();
        const cuerpo = (await original.text()).replace(/estado:\s*(["'])borrador\1/g, 'estado: "publicado"');
        await ruta.fulfill({ response: original, body: cuerpo });
    });
    await page.route(`${API}/**`, async (ruta) => {
        const url = new URL(ruta.request().url());
        const metodo = ruta.request().method();
        const json = (data) => ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname === '/auth/me') {
            return json({ success: true, data: {
                user: { personaId: 'p-1', tenantId: 't-1', nombre: 'Ana', apellidoPaterno: 'Rojas', rol: p.rol, permisos: p.permisos, habilitado: true, passwordTemporal: false },
                session: { expiresAt: new Date(Date.now() + 3600e3).toISOString() },
            } });
        }
        if (url.pathname === '/ayuda/progreso' && metodo === 'GET') return json({ success: true, data: { progreso, registrar: true } });
        if (url.pathname.startsWith('/ayuda/progreso/') && metodo === 'PUT') {
            llamadas.put.push({ id: decodeURIComponent(url.pathname.split('/').pop()), ...JSON.parse(ruta.request().postData() || '{}') });
            return json({ success: true, data: {} });
        }
        if (url.pathname === '/obras' && metodo === 'GET') return json({ success: true, data: p.obras });
        return json({ success: true, data: [] });
    });
    return llamadas;
}

const globo = (page) => page.locator('.recorrido-globo');
const recorrido = (page) => page.locator('[data-recorrido]');

/** Recorre el recorrido abierto hasta el final y devuelve los títulos de los pasos que se mostraron. */
async function recorrerHastaElFinal(page) {
    const titulos = [];
    for (let i = 0; i < 25; i += 1) {
        await expect(globo(page)).toBeVisible({ timeout: 6000 });
        const titulo = await globo(page).locator('h2').innerText();
        if (titulos[titulos.length - 1] !== titulo) titulos.push(titulo);
        const final = page.getByRole('button', { name: 'Finalizar' });
        if (await final.isVisible()) { await final.click(); break; }
        await page.getByRole('button', { name: 'Siguiente' }).click();
        await expect(globo(page).locator('h2')).not.toHaveText(titulo, { timeout: 6000 });
    }
    await expect(globo(page)).toHaveCount(0);
    return titulos;
}

test('trabajador: su introducción de Inicio, completa, sin el aviso de ingreso si no le faltan firmas', async ({ page }) => {
    const llamadas = await prepararApp(page, 'trabajador');
    await page.goto('/');
    await expect(recorrido(page)).toHaveAttribute('data-recorrido', 'inicio-terreno', { timeout: 6000 });
    const titulos = await recorrerHastaElFinal(page);
    expect(titulos).toEqual(['Tus accesos', 'Lo que te toca', '¿Tienes dudas?']);
    await expect.poll(() => llamadas.put).toEqual([{ id: 'inicio-terreno', version: 1, estado: 'completado', ultimoPaso: 3, cierres: 0 }]);
});

test('supervisor dentro de una obra: la introducción de gestión, con la obra, el menú y Cambiar de obra', async ({ page }) => {
    const llamadas = await prepararApp(page, 'supervisor');
    await page.goto('/');
    await expect(recorrido(page)).toHaveAttribute('data-recorrido', 'inicio-gestion', { timeout: 6000 });
    const titulos = await recorrerHastaElFinal(page);
    expect(titulos).toEqual(['Dónde estás trabajando', 'Tus módulos', 'El menú', 'Cambiar de obra', 'Tus propios pendientes', 'Ayuda en cada pantalla']);
    await expect.poll(() => llamadas.put.map((x) => x.id)).toEqual(['inicio-gestion']);
});

test('administrador en la vista de empresa: su introducción y ninguna otra', async ({ page }) => {
    const llamadas = await prepararApp(page, 'admin');
    await page.goto('/');
    await expect(recorrido(page)).toHaveAttribute('data-recorrido', 'inicio-empresa', { timeout: 6000 });
    const titulos = await recorrerHastaElFinal(page);
    expect(titulos).toEqual(['La vista de empresa', 'El menú', 'Entrar a una obra', 'Ayuda en cada pantalla']);
    await expect.poll(() => llamadas.put.map((x) => x.id)).toEqual(['inicio-empresa']);
});

test('mis-firmas: se lanza en Mis firmas para quien ya hizo su introducción, con sus tres pasos', async ({ page }) => {
    const llamadas = await prepararApp(page, 'trabajador', {
        progreso: [{ recorridoId: 'inicio-terreno', version: 1, estado: 'completado', ultimoPaso: 3, cierres: 0, actualizadoEn: '2026-11-07T00:00:00Z' }],
    });
    await page.goto('/my-signatures');
    await expect(recorrido(page)).toHaveAttribute('data-recorrido', 'mis-firmas', { timeout: 6000 });
    const titulos = await recorrerHastaElFinal(page);
    expect(titulos).toEqual(['Pendientes e historial', 'Cómo se firma', 'Tu avance']);
    await expect.poll(() => llamadas.put.map((x) => x.id)).toEqual(['mis-firmas']);
});

test('los opcionales de una pantalla aparecen en su ayuda y se abren desde ahí', async ({ page }) => {
    await prepararApp(page, 'trabajador', {
        progreso: [{ recorridoId: 'inicio-terreno', version: 1, estado: 'completado', ultimoPaso: 3, cierres: 0, actualizadoEn: '2026-11-07T00:00:00Z' }],
    });
    await page.goto('/incidents/reportar');
    await page.locator('[data-tour="global.boton-ayuda"]').click();
    await page.getByRole('region', { name: 'Ayuda' }).getByRole('button', { name: /Hallazgo, incidente o accidente/ }).click();
    const titulos = await recorrerHastaElFinal(page);
    expect(titulos).toEqual(['¿Hallazgo o incidente?', 'Qué y dónde', 'Qué pasó', 'Fotos', 'Revisar y enviar']);
});

// ─── Lo que encontró la revisión en dev (8 de noviembre de 2026) ─────────────

const vistaPrevia = (page, ruta, id) => page.goto(`${ruta}?recorrido=${id}&previa=1`);

test('reportar y subir-documentos pedidos en la vista de empresa: se avisa que son para dentro de una obra', async ({ page }) => {
    // Antes no aparecía nada: sin obra, la pantalla no tiene formulario ni botón,
    // y el motor esperaba cada ancla y terminaba en silencio.
    await prepararApp(page, 'admin-empresa');
    for (const [ruta, id] of [['/incidents/reportar', 'reportar'], ['/documents-repository', 'subir-documentos']]) {
        await vistaPrevia(page, ruta, id);
        await expect(page.getByText('Este recorrido es para dentro de una obra')).toBeVisible({ timeout: 6000 });
        await expect(globo(page)).toHaveCount(0);
    }
});

test('reportar y subir-documentos no aparecen en la ayuda de la vista de empresa', async ({ page }) => {
    await prepararApp(page, 'admin-empresa', {
        progreso: [{ recorridoId: 'inicio-empresa', version: 1, estado: 'completado', ultimoPaso: 3, cierres: 0, actualizadoEn: '2026-11-07T00:00:00Z' }],
    });
    await page.goto('/documents-repository');
    await page.locator('[data-tour="global.boton-ayuda"]').click();
    await expect(page.getByRole('region', { name: 'Ayuda' })).toContainText('No hay recorridos para esta pantalla.');
});

test('subir-documentos dentro de una obra: subir y la versión nueva sobre la carpeta DS44', async ({ page }) => {
    await prepararApp(page, 'admin-obra');
    await vistaPrevia(page, '/documents-repository', 'subir-documentos');
    expect(await recorrerHastaElFinal(page)).toEqual(['Subir un documento', 'Una versión nueva, no otro archivo']);
});

test('programar-actividades sin borradores del plan: en "Una actividad suelta" ya se puede finalizar', async ({ page }) => {
    await prepararApp(page, 'admin-obra');
    await vistaPrevia(page, '/activities', 'programar-actividades');
    await expect(globo(page)).toContainText('Lista o calendario', { timeout: 6000 });
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(globo(page)).toContainText('Planificar el mes');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(globo(page)).toContainText('Una actividad suelta');
    // El contador no cuenta "Por completar", que no se va a mostrar (antes decía "3 de 5").
    await expect(page.locator('.recorrido-globo__progreso')).toHaveText('Paso 3 de 4');
    // Y Siguiente no se queda esperando 4 s ese paso: salta al buscador.
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(globo(page)).toContainText('Buscar', { timeout: 1500 });
    await expect(page.locator('.recorrido-globo__progreso')).toHaveText('Paso 4 de 4');
    await expect(page.getByRole('button', { name: 'Finalizar' })).toBeVisible();
});

// ─── Pasos nuevos (propuesta aprobada el 8 de noviembre de 2026) ─────────────

test('encontrar-documentos: pestañas, buscador, carpetas y la carpeta DS44', async ({ page }) => {
    await prepararApp(page, 'admin-obra');
    await vistaPrevia(page, '/documents-repository', 'encontrar-documentos');
    expect(await recorrerHastaElFinal(page)).toEqual(['General o Personal', 'Buscar', 'Las carpetas', 'DS44 · Cumplimiento']);
});

/** Abre un recorrido desde el menú de ayuda de la pantalla en la que se está. */
async function abrirDesdeLaAyuda(page, titulo) {
    await page.locator('[data-tour="global.boton-ayuda"]').click();
    await page.getByRole('region', { name: 'Ayuda' }).getByRole('button', { name: titulo }).click();
}

const yaHizoSuIntroduccion = [{ recorridoId: 'inicio-gestion', version: 1, estado: 'completado', ultimoPaso: 5, cierres: 0, actualizadoEn: '2026-11-07T00:00:00Z' }];

test('encontrar-documentos en Personal: la carpeta DS44 no está y su paso se salta', async ({ page }) => {
    await prepararApp(page, 'supervisor', { progreso: yaHizoSuIntroduccion });
    await page.goto('/documents-repository');
    await page.getByRole('tab', { name: /Personal/ }).click();
    await abrirDesdeLaAyuda(page, /Encontrar un documento/);
    // Sin documentos asignados no hay carpetas: quedan las pestañas y el buscador.
    expect(await recorrerHastaElFinal(page)).toEqual(['General o Personal', 'Buscar']);
});

test('reportar un hallazgo: sin el paso de afectados, que aparece solo en acción subestándar', async ({ page }) => {
    await prepararApp(page, 'admin-obra');
    await vistaPrevia(page, '/incidents/reportar', 'reportar');
    expect(await recorrerHastaElFinal(page)).toEqual(['¿Hallazgo o incidente?', 'Qué y dónde', 'Qué pasó', 'Fotos', 'Revisar y enviar']);
});

test('reportar un incidente: los seis pasos, con el afectado', async ({ page }) => {
    await prepararApp(page, 'supervisor', { progreso: yaHizoSuIntroduccion });
    await page.goto('/incidents/reportar');
    await page.getByRole('radio', { name: 'Incidente' }).click();
    await abrirDesdeLaAyuda(page, /Hallazgo, incidente o accidente/);
    expect(await recorrerHastaElFinal(page)).toEqual(['¿Hallazgo o incidente?', 'Qué y dónde', 'Quién resultó afectado', 'Qué pasó', 'Fotos', 'Revisar y enviar']);
});

test('gestionar-incidentes: listado, filtros, gestión e investigaciones', async ({ page }) => {
    await prepararApp(page, 'supervisor');
    await vistaPrevia(page, '/incidents', 'gestionar-incidentes');
    expect(await recorrerHastaElFinal(page)).toEqual(['Listado y estadísticas', 'Encontrar un evento', 'Gestionar un evento', 'Investigaciones']);
});

test('cambiar-de-obra en escritorio: un solo paso, el menú de tres puntos', async ({ page }) => {
    await prepararApp(page, 'supervisor');
    await vistaPrevia(page, '/', 'cambiar-de-obra');
    expect(await recorrerHastaElFinal(page)).toEqual(['Cambiar de obra']);
});

test.describe('a 360 px', () => {
    test.use({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });

    test('supervisor: los pasos del menú lateral, la obra y la sesión se saltan; queda el del botón de menú', async ({ page }) => {
        await prepararApp(page, 'supervisor');
        await page.goto('/');
        await expect(recorrido(page)).toHaveAttribute('data-recorrido', 'inicio-gestion', { timeout: 6000 });
        const titulos = await recorrerHastaElFinal(page);
        expect(titulos).toEqual(['El menú', 'Tus propios pendientes', 'Ayuda en cada pantalla']);
    });

    test('cambiar-de-obra en el teléfono: un solo paso, abrir el menú', async ({ page }) => {
        await prepararApp(page, 'supervisor');
        await vistaPrevia(page, '/', 'cambiar-de-obra');
        expect(await recorrerHastaElFinal(page)).toEqual(['Abre el menú']);
    });
});
