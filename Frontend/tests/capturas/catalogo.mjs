// Las capturas del manual que dependen de la firma: PIN y firma sin conexión.
// Una entrada por imagen. Sale `<archivo>.png` en escritorio y `<archivo>-360.png`
// a 360 px, en la misma carpeta que usa el manual (public/manual-img).
//
//   archivo   ruta bajo manual-img, sin extensión.
//   perfil    quién está en sesión (api-simulada.mjs).
//   ruta      la pantalla.
//   guardado  localStorage antes de abrir (obra elegida, cola de firmas...).
//   sinSenal  la app cree que no hay señal.
//   requiere  archivo que tiene que existir para capturarla: lo que llega con la
//             firma sin conexión se omite hasta la mezcla, y desde ahí corre solo.
//             Si el archivo existe y la pantalla no aparece, la captura FALLA.
//   pasos     llegar a lo que se muestra, sobre la pantalla real.
//   ver       texto que tiene que estar antes de capturar.
//   marcar    elemento que se encierra en rojo, como las capturas del manual.

import { expect } from '@playwright/test';

const FIRMA_SIN_CONEXION = 'src/components/firmas/SincronizadorFirmas.tsx';

const PIN = '482915';
/** Escribe el PIN del largo que pida la pantalla. */
const escribirPin = async (page) => {
    const campo = page.locator('.pin-casillas-input').first();
    await campo.fill(PIN.slice(0, Number(await campo.getAttribute('maxlength'))));
};
// El menú de la tarjeta se cierra apenas la página se desplaza, y Playwright la
// desplaza para acercar el botón: se reintenta y el clic va directo al botón.
const abrirAsistida = async (page) => {
    await expect(async () => {
        await page.getByText('Luis Vera').first().click({ timeout: 3000 });
        await page.getByRole('button', { name: /Firmar asistido|Firma asistida/ }).first().dispatchEvent('click', {}, { timeout: 1500 });
        await expect(page.locator('.fa-doc-row').first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
};

const abrirFirma = async (page) => { await page.getByRole('button', { name: 'Firmar', exact: true }).first().click(); };

const comenzar = async (page) => { await page.getByRole('button', { name: 'Comenzar' }).click(); };

const porEnviar = (i) => ({
    id: `local-${i}`, tenantId: 't-1', type: 'documento', targetId: 'd-1', targetTitle: 'Procedimiento de trabajo en altura', workerId: `p-${i}`,
    workerName: i === 1 ? 'Ana Rojas' : 'Luis Vera', vale: 'simulado', timestamp: '2026-11-10T09:15:00-03:00',
});

export const CAPTURAS = [
    { archivo: 'firmas/mis-firmas', perfil: 'trabajadora', ruta: '/my-signatures', ver: 'Procedimiento de trabajo en altura' },
    { archivo: 'firmas/firmar', perfil: 'trabajadora', ruta: '/my-signatures', pasos: abrirFirma, ver: 'Confirmar firma', marcar: '.pin-input-container' },
    {
        archivo: 'firmas/historial', perfil: 'trabajadora', ruta: '/my-signatures', ver: 'Descargar comprobante',
        pasos: async (page) => {
            await page.getByRole('tab', { name: 'Historial' }).or(page.getByRole('button', { name: 'Historial' })).first().click();
            await page.getByText('Reglamento Interno').first().click();
        },
    },
    { archivo: 'firmas/firma-asistida', perfil: 'supervisor', ruta: '/personas', pasos: abrirAsistida, ver: 'Documentos pendientes', marcar: '.fa-doc-row' },
    {
        archivo: 'firmas/firma-asistida-pin', perfil: 'supervisor', ruta: '/personas', ver: 'Confirmar firma', marcar: '.pin-input-container',
        pasos: async (page) => { await abrirAsistida(page); await page.locator('.fa-doc-row').first().click(); },
    },
    { archivo: 'guia-inicio/enrolamiento-pin', perfil: 'sin-enrolar', ruta: '/enroll-me', pasos: comenzar, ver: 'Elige tu PIN', marcar: '.pin-casillas' },
    {
        archivo: 'guia-inicio/enrolamiento-confirmar', perfil: 'sin-enrolar', ruta: '/enroll-me', ver: 'Repite tu PIN', marcar: '.pin-casillas',
        pasos: async (page) => { await comenzar(page); await escribirPin(page); await page.getByRole('button', { name: 'Continuar' }).click(); },
    },
    { archivo: 'guia-inicio/crear-pin-nuevo', perfil: 'pin-restablecido', ruta: '/configuracion', ver: 'Crear PIN de firma nuevo', marcar: 'button:has-text("Crear PIN de firma nuevo")' },
    { archivo: 'firmas/por-enviar', nueva: true, requiere: FIRMA_SIN_CONEXION, perfil: 'trabajadora', ruta: '/my-signatures', sinSenal: true, guardado: { 'firmasPendientes:t-1': JSON.stringify([porEnviar(1), porEnviar(3)]) }, ver: '2 firmas por enviar', marcar: '.sincronizador-firmas' },
    {
        archivo: 'firmas/no-se-valido', nueva: true, requiere: FIRMA_SIN_CONEXION, perfil: 'supervisor', ruta: '/my-signatures', ver: 'no se validó', marcar: '.sincronizador-firmas--rechazadas',
        guardado: { 'firmasRechazadas:t-1': JSON.stringify([{ id: 'local-3', workerName: 'Luis Vera', targetTitle: 'Procedimiento de trabajo en altura', motivo: 'PIN incorrecto', en: '2026-11-10T10:20:00-03:00' }]) },
    },
    { archivo: 'firmas/en-revision', nueva: true, requiere: 'src/pages/FirmasEnRevision.tsx', perfil: 'supervisor', ruta: '/firmas/revision', ver: 'Luis Vera' },
];
