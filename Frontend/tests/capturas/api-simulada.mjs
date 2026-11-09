// La API de las capturas: datos inventados, sin red. Nada sale del equipo: lo que
// no es la app ni sus tipografías se corta (ver `cortarLoDemas`), y un endpoint
// sin datos queda anotado para que las capturas no pasen en silencio con una
// pantalla vacía.

import { RECORRIDOS } from '../../src/ayuda/recorridos.ts';

export const API = 'http://localhost:3001';
/** La hora de todas las capturas, para que dos corridas den lo mismo. */
export const AHORA = new Date('2026-11-10T10:30:00-03:00');
const hace = (dias) => new Date(AHORA.getTime() - dias * 86400e3).toISOString();

export const OBRA = { obraId: 'o-1', nombre: 'Edificio Las Lilas', estado: 'activa', empresaId: 't-1', tenantId: 't-1' };

const TRABAJADORA = { personaId: 'p-1', userId: 'p-1', tenantId: 't-1', empresaId: 't-1', nombre: 'Ana', apellidoPaterno: 'Rojas', apellido: 'Rojas', rut: '11.111.111-1', cargo: 'Maestra de obra', rol: 'trabajador', estado: 'activo', habilitado: true, pinConfigurado: true, passwordTemporal: false };
const EN_LA_OBRA = (supervisorPersonaId) => ({ obraIds: ['o-1'], asignaciones: [{ obraId: 'o-1', cargos: [], supervisorPersonaId }] });
const COMPANERO = { ...TRABAJADORA, ...EN_LA_OBRA('p-2'), personaId: 'p-3', userId: 'p-3', nombre: 'Luis', apellidoPaterno: 'Vera', apellido: 'Vera', rut: '33.333.333-3', cargo: 'Jornal' };
const SUPERVISOR = { ...TRABAJADORA, personaId: 'p-2', userId: 'p-2', nombre: 'Pedro', apellidoPaterno: 'Soto', apellido: 'Soto', rut: '22.222.222-2', cargo: 'Supervisor', rol: 'supervisor', rolTipo: 'supervisor', ...EN_LA_OBRA(null) };

const PERMISOS_SUPERVISOR = ['obras.ver', 'obras.detalle', 'obra.asignar_trabajadores', 'obra.firma_asistida', 'personas.ver', 'personas.detalle', 'repositorio.ver', 'firmas.crear', 'incidentes.reportar', 'actividades.ver', 'actividades.crear'];

/** Quién está en sesión en cada captura. */
export const PERFILES = {
    trabajadora: { user: { ...TRABAJADORA, permisos: ['actividades.ver'] } },
    supervisor: { user: { ...SUPERVISOR, permisos: PERMISOS_SUPERVISOR }, guardado: { obraScope: 'obra', selectedObraId: 'o-1' } },
    'sin-enrolar': { user: { ...TRABAJADORA, permisos: ['actividades.ver'], habilitado: false, pinConfigurado: false } },
    'pin-restablecido': { user: { ...TRABAJADORA, permisos: ['actividades.ver'], pinConfigurado: false, pinRestablecido: { por: 'Administración' } } },
};

const TIPO_INFO = { label: 'Procedimiento de Trabajo', icon: 'file', requiresDoc: true };
const adjunto = { nombre: 'Procedimiento de trabajo en altura.pdf', url: 'documentos/altura.pdf', tipo: 'application/pdf', fileKey: 'documentos/altura.pdf' };
const solicitud = (requestId, titulo, tipo, dias) => ({
    requestId, referenciaId: null, tipo, tipoInfo: { ...TIPO_INFO, label: 'Procedimiento de Trabajo' }, titulo,
    descripcion: 'Léelo antes de firmar. Cualquier duda, pregúntale a tu supervisor.', documentos: [adjunto], tieneDocumentos: true,
    solicitanteId: 'p-2', solicitanteNombre: 'Pedro Soto', solicitanteRut: '22.222.222-2', trabajadores: [], totalRequeridos: 12, totalFirmados: 7,
    fechaCreacion: hace(2), fechaLimite: new Date(AHORA.getTime() + dias * 86400e3).toISOString(), fechaCompletado: null, ubicacion: null, obraId: 'o-1',
    empresaId: 't-1', estado: 'en_proceso', createdAt: hace(2), updatedAt: hace(1),
});
const PENDIENTES = [
    solicitud('s-1', 'Procedimiento de trabajo en altura', 'PROCEDIMIENTO', 2),
    solicitud('s-2', 'Uso de andamios', 'PROCEDIMIENTO', 9),
];
const firmaHecha = (signatureId, titulo, dias) => ({
    firma: {
        signatureId, token: `BS-${signatureId.toUpperCase()}-7F3A9C2E`, requestId: 's-9', requestTitulo: titulo, requestTipo: 'PROCEDIMIENTO',
        workerId: 'p-1', workerRut: '11.111.111-1', workerNombre: 'Ana Rojas', workerCargo: 'Maestra de obra', solicitanteId: 'p-2', solicitanteNombre: 'Pedro Soto',
        fecha: hace(dias).slice(0, 10), horario: '08:42', timestamp: hace(dias), ipAddress: '192.0.2.10', userAgent: 'Capturas', metodoValidacion: 'pin',
        documentosFirmados: [adjunto], estado: 'valida', empresaId: 't-1', createdAt: hace(dias),
    },
    solicitud: solicitud('s-9', titulo, 'PROCEDIMIENTO', -1),
});
const HISTORIAL = [firmaHecha('f-1', 'Reglamento Interno', 3), firmaHecha('f-2', 'Inducción de obra', 12)];
const DOCUMENTO = {
    documentId: 'd-1', titulo: 'Procedimiento de trabajo en altura', nombre: 'Procedimiento de trabajo en altura', tipo: 'Procedimiento de trabajo', estado: 'vigente', obraId: 'o-1', empresaId: 't-1',
    url: 'documentos/altura.pdf', fileKey: 'documentos/altura.pdf', createdAt: hace(2),
    asignaciones: [{ personaId: 'p-1', workerId: 'p-1', estado: 'pendiente' }, { personaId: 'p-3', workerId: 'p-3', estado: 'pendiente' }],
    firmas: [],
};
const EN_REVISION = [{
    signatureId: 'f-9', personaId: 'p-3', personaNombre: 'Luis Vera', tipoFirma: 'documento', referenciaId: 'd-1', referenciaTipo: 'document', obraId: 'o-1',
    timestamp: hace(2), motivoRevision: 'El vale de firma había vencido al sincronizar: la firma se registró pero requiere confirmación.', offline: { valeEmitidoEn: hace(4), valeExpiraEn: hace(3), valeEmitidoPor: 'p-2', firmadaSinConexionEn: hace(2) },
}];

const AVISO_PRIVACIDAD = {
    version: 'capturas', responsable: { nombre: 'Constructora de ejemplo', rol: 'Responsable de los datos', contacto: 'contacto@example.com' },
    encargados: [], tratamientos: [], bases: [], consentimientos: [], enElEquipo: '', datosSensibles: '', derechos: [],
    plazos: { respuestaDias: 30, prorrogaDias: 30, bloqueoDiasHabiles: 2, texto: '' }, reclamo: '',
};

const respuestas = (perfil, progreso) => [
    ['GET', /^\/auth\/me$/, () => ({ user: perfil.user, session: { expiresAt: new Date(AHORA.getTime() + 3600e3).toISOString() } })],
    ['GET', /^\/ayuda\/progreso$/, () => ({ progreso, registrar: true })],
    ['PUT', /^\/ayuda\/progreso\//, () => ({})],
    ['GET', /^\/obras$/, () => [OBRA]],
    ['GET', /^\/obras\/o-1$/, () => OBRA],
    ['GET', /^\/signature-requests\/pending\//, () => ({ pendientes: PENDIENTES, total: PENDIENTES.length })],
    ['GET', /^\/signature-requests\/history\//, () => ({ historial: HISTORIAL, totalFirmas: HISTORIAL.length })],
    // Lo pendiente de la persona ya viene por las solicitudes; la firma asistida lista los de la obra.
    ['GET', /^\/documents$/, (url) => ({ documents: url.searchParams.has('pendienteDe') ? [] : [DOCUMENTO] })],
    ['GET', /^\/personas$/, () => ({ total: 3, personas: [{ ...TRABAJADORA, ...EN_LA_OBRA('p-2') }, COMPANERO, SUPERVISOR] })],
    ['GET', /^\/gobernanza\/mis-datos\/aviso$/, () => AVISO_PRIVACIDAD],
    ['GET', /^\/surveys$/, () => []],
    ['GET', /^\/inbox\/unread-count$/, () => ({ count: 0 })],
    ['GET', /^\/signatures\/en-revision$/, () => ({ firmas: EN_REVISION })],
    ['GET', /^\/signatures\/revision$/, () => ({ firmas: EN_REVISION })],
];

/**
 * Prepara la página antes de abrirla: sesión, reloj fijo, recorridos ya vistos
 * (que no se abran encima de la captura) y API simulada. Devuelve lo que la app
 * pidió y no tenía datos, para revisar una pantalla que sale vacía.
 */
export async function prepararPagina(page, { perfil, guardado = {}, sinSenal = false }) {
    const p = PERFILES[perfil];
    if (!p) throw new Error(`Perfil desconocido: ${perfil}`);
    const progreso = RECORRIDOS.map((d) => ({ recorridoId: d.id, version: d.version, estado: 'completado', ultimoPaso: d.pasos.length, cierres: 0, actualizadoEn: AHORA.toISOString() }));
    const sinDatos = new Set();
    await page.clock.setFixedTime(AHORA);
    await page.addInitScript(({ datos, sinRed }) => {
        localStorage.setItem('auth_token', 'token-de-capturas');
        localStorage.setItem('session_id', 'sesion-de-capturas');
        localStorage.setItem('tenant_id', 't-1');
        for (const [k, v] of Object.entries(datos)) localStorage.setItem(k, v);
        // La app cree que no hay señal; la página ya cargó por el servidor local.
        if (sinRed) Object.defineProperty(navigator, 'onLine', { get: () => false });
    }, { datos: { ...p.guardado, ...guardado }, sinRed: sinSenal });

    // Nada sale del equipo, salvo las tipografías de la app.
    await page.route(/^https?:\/\/(?!localhost[:/]|fonts\.googleapis\.com|fonts\.gstatic\.com)/, (ruta) => ruta.abort());

    const lista = respuestas(p, progreso);
    await page.route(`${API}/**`, async (ruta) => {
        const url = new URL(ruta.request().url());
        const metodo = ruta.request().method();
        const r = lista.find(([m, re]) => m === metodo && re.test(url.pathname));
        if (!r) sinDatos.add(`${metodo} ${url.pathname}`);
        await ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: r ? r[2](url) : [] }) });
    });
    return sinDatos;
}
