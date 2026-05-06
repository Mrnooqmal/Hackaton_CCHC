/**
 * Personas Module - Handler
 * 
 * Identidad unificada: reemplaza /users y /workers.
 * Todas las operaciones filtran por tenantId.
 */
const XLSX = require('xlsx');
const { PersonaService } = require('../../lib/services/PersonaService');
const { success, error, created, cors, headers } = require('../../lib/response');
const { sendWelcomeEmail } = require('../notifications');

const personaService = new PersonaService();

const TEMPLATE_HEADERS = [
    'rut',
    'nombre',
    'apellido',
    'email',
    'telefono',
    'rol',
    'cargo',
    'tieneAccesoWeb'
];

const TEMPLATE_EXAMPLE_ROWS = [
    ['12.345.678-9', 'Juan', 'Perez', 'jperez@empresa.cl', '56912345678', 'trabajador', 'Operador', 'no'],
    ['11.111.111-1', 'Maria', 'Lopez', 'mlopez@empresa.cl', '56987654321', 'admin', 'Administradora', 'si']
];

const TEMPLATE_INSTRUCTIONS = [
    '1. Las columnas rut, nombre y rol son obligatorias.',
    '2. El rol debe ser admin, prevencionista, supervisor o trabajador.',
    '3. tieneAccesoWeb acepta si/no, true/false, 1/0.',
    '4. Si tieneAccesoWeb es si y el email es valido, se genera password temporal.',
    '5. Elimine las filas de ejemplo antes de cargar el archivo.'
];

const normalizeHeader = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s._-]+/g, '');

const headerAliases = {
    rut: 'rut',
    nombre: 'nombre',
    apellido: 'apellido',
    email: 'email',
    correo: 'email',
    telefono: 'telefono',
    phone: 'telefono',
    rol: 'rol',
    cargo: 'cargo',
    tieneaccesoweb: 'tieneAccesoWeb',
    accesoweb: 'tieneAccesoWeb'
};

const parseBoolean = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const normalized = String(value).trim().toLowerCase();
    if (['si', 'sí', 'true', '1', 'yes'].includes(normalized)) return true;
    if (['no', 'false', '0'].includes(normalized)) return false;
    return undefined;
};

const createTemplateBuffer = () => {
    const workbook = XLSX.utils.book_new();
    const dataSheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLE_ROWS]);
    XLSX.utils.book_append_sheet(workbook, dataSheet, 'Personas');

    const instructionsSheet = XLSX.utils.aoa_to_sheet([
        ['Instrucciones'],
        ...TEMPLATE_INSTRUCTIONS.map(line => [line])
    ]);
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instrucciones');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

module.exports.personasHandler = async (event) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = event.rawPath || event.path || '';

    const segments = path.replace(/^\/personas\/?/, '').split('/').filter(Boolean);
    const personaId = segments[0] || null;
    const action = segments[1] || null;

    // tenantId: del JWT o query (temporal durante migración)
    const tenantId = event.queryStringParameters?.tenantId
        || event.requestContext?.authorizer?.claims?.['custom:tenantId']
        || null;

    try {
        // CORS preflight
        if (method === 'OPTIONS') return cors();

        // GET /personas/plantilla — Descargar plantilla Excel
        if (method === 'GET' && personaId === 'plantilla') {
            const buffer = createTemplateBuffer();
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': 'attachment; filename=plantilla_personas.xlsx'
                },
                body: buffer.toString('base64'),
                isBase64Encoded: true
            };
        }

        // POST /personas/carga-masiva — Procesar Excel
        if (method === 'POST' && personaId === 'carga-masiva') {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            const fileBase64 = body.fileBase64 || body.archivoBase64 || '';
            const fileName = body.fileName || 'personas.xlsx';
            const sendEmails = Boolean(body.sendWelcomeEmail);

            if (!fileBase64) return error('No se proporciono ningun archivo');
            if (!fileName.toLowerCase().endsWith('.xlsx')) return error('El archivo debe ser un Excel (.xlsx)');

            const base64 = fileBase64.includes('base64,')
                ? fileBase64.split('base64,')[1]
                : fileBase64;

            const buffer = Buffer.from(base64, 'base64');
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames.includes('Personas')
                ? 'Personas'
                : workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
            if (!rows.length) return error('La plantilla no tiene filas');

            const rawHeaders = rows[0].map(normalizeHeader);
            const headerMap = {};

            rawHeaders.forEach((header, index) => {
                const canonical = headerAliases[header];
                if (canonical) headerMap[canonical] = index;
            });

            const requiredHeaders = ['rut', 'nombre', 'rol'];
            const missingHeaders = requiredHeaders.filter(h => headerMap[h] === undefined);
            if (missingHeaders.length > 0) {
                return error(`Faltan columnas obligatorias: ${missingHeaders.join(', ')}`);
            }

            const resultados = { creados: [], errores: [], duplicados: [], totalProcesados: 0 };
            const seenRut = new Set();

            for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
                const row = rows[rowIndex];
                const rowNumber = rowIndex + 1;

                const rowHasValue = row.some(cell => String(cell || '').trim() !== '');
                if (!rowHasValue) continue;

                resultados.totalProcesados += 1;

                const getCell = (key) => {
                    const idx = headerMap[key];
                    if (idx === undefined) return '';
                    const value = row[idx];
                    return value === undefined || value === null ? '' : String(value).trim();
                };

                const rut = getCell('rut');
                const nombre = getCell('nombre');
                const apellido = getCell('apellido');
                const email = getCell('email');
                const telefono = getCell('telefono');
                const rol = getCell('rol').toLowerCase();
                const cargo = getCell('cargo');
                const tieneAccesoWeb = parseBoolean(getCell('tieneAccesoWeb'));

                if (!rut || !nombre || !rol) {
                    resultados.errores.push({ fila: rowNumber, error: 'Faltan rut, nombre o rol' });
                    continue;
                }

                const rutKey = rut.replace(/[.\-]/g, '').toLowerCase();
                if (seenRut.has(rutKey)) {
                    resultados.duplicados.push({ fila: rowNumber, rut, motivo: 'Duplicado en archivo' });
                    continue;
                }
                seenRut.add(rutKey);

                try {
                    const { persona, passwordTemporal } = await personaService.crear(tenantId, {
                        rut,
                        nombre,
                        apellido,
                        email,
                        telefono,
                        rol,
                        cargo,
                        tieneAccesoWeb
                    });

                    if (sendEmails && persona.email && passwordTemporal) {
                        try {
                            await sendWelcomeEmail(persona.email, persona.nombre, persona.rut, passwordTemporal);
                        } catch (emailErr) {
                            console.error('Error sending welcome email:', emailErr);
                        }
                    }

                    resultados.creados.push({
                        fila: rowNumber,
                        personaId: persona.personaId,
                        rut: persona.rut,
                        passwordTemporal: passwordTemporal || undefined
                    });
                } catch (err) {
                    const message = err?.message || 'Error al crear persona';
                    if (message.includes('Ya existe una persona')) {
                        resultados.duplicados.push({ fila: rowNumber, rut, motivo: 'Ya existe en el tenant' });
                    } else {
                        resultados.errores.push({ fila: rowNumber, error: message });
                    }
                }
            }

            return success({
                mensaje: `Carga masiva completada. ${resultados.creados.length} personas creadas.`,
                resultados
            });
        }

        // POST /personas — Crear persona
        if (method === 'POST' && !personaId) {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            const { persona, passwordTemporal } = await personaService.crear(tenantId, body);

            // Enviar email de bienvenida si tiene acceso web
            let emailSent = false;
            if (persona.email && passwordTemporal) {
                try {
                    const emailResult = await sendWelcomeEmail(
                        persona.email, persona.nombre, persona.rut, passwordTemporal
                    );
                    emailSent = emailResult?.sent || false;
                } catch (emailErr) {
                    console.error('Error sending welcome email:', emailErr);
                }
            }

            return created({
                message: 'Persona creada exitosamente',
                persona: persona.toSafeFormat(),
                passwordTemporal: passwordTemporal || undefined,
                emailNotificado: emailSent
            });
        }

        // GET /personas — Listar personas del tenant
        if (method === 'GET' && !personaId) {
            if (!tenantId) return error('tenantId es requerido');
            const { rol, estado, obraId } = event.queryStringParameters || {};
            const personas = await personaService.listByTenant(tenantId, { rol, estado, obraId });
            return success({
                total: personas.length,
                personas: personas.map(p => p.toSafeFormat())
            });
        }

        // GET /personas/by-rut/{rut} — Buscar por RUT
        if (method === 'GET' && personaId === 'by-rut' && action) {
            if (!tenantId) return error('tenantId es requerido');
            const persona = await personaService.getByRut(tenantId, action);
            if (!persona) return error('Persona no encontrada', 404);
            return success(persona.toSafeFormat());
        }

        // GET /personas/{id} — Obtener persona
        if (method === 'GET' && personaId && !action) {
            const persona = await personaService.getById(personaId);
            if (!persona) return error('Persona no encontrada', 404);
            return success(persona.toSafeFormat());
        }

        // PUT /personas/{id} — Actualizar persona
        if (method === 'PUT' && personaId && !action) {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            const persona = await personaService.actualizar(tenantId, personaId, body);
            return success({
                message: 'Persona actualizada',
                persona: persona.toSafeFormat()
            });
        }

        // POST /personas/{id}/set-pin — Configurar PIN
        if (method === 'POST' && personaId && action === 'set-pin') {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            const result = await personaService.setPin(tenantId, personaId, body.pin, body.pinActual);
            return success(result);
        }

        // POST /personas/{id}/enrolamiento — Completar enrolamiento
        if (method === 'POST' && personaId && action === 'enrolamiento') {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            const result = await personaService.completarEnrolamiento(
                tenantId, personaId, body.pin, event
            );
            return success(result);
        }

        // POST /personas/{id}/reset-password — Resetear contraseña
        if (method === 'POST' && personaId && action === 'reset-password') {
            if (!tenantId) return error('tenantId es requerido');
            const result = await personaService.resetPassword(tenantId, personaId);
            return success(result);
        }

        return error('Ruta no encontrada', 404);
    } catch (err) {
        console.error('Error in personas handler:', err);
        return error(err.message, 500);
    }
};
