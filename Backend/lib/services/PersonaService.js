/**
 * PersonaService (Refactored)
 * 
 * Opera sobre PersonasTable unicamente.
 * Elimina toda la logica de sincronizacion dual Users/Workers.
 * Un solo ID, un solo pinHash, queries por PK TENANT#{tenantId}.
 */

const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { verificarConLimiteOLanzar } = require('../limitePin');
const { construirMensaje, INBOX_TABLE } = require('../bandeja');
const { registrarFallo } = require('../degradacion');
const { ValeFirmaService } = require('./ValeFirmaService');

/** Largo mínimo del motivo de un restablecimiento: una palabra suelta ("olvido")
 *  no sirve para que la persona afectada, o quien revise después, entienda qué
 *  pasó. */
const MOTIVO_MIN = 10;
const MOTIVO_MAX = 500;

/** Condiciones de "no hay" para atributos que `crear` escribe como NULL: en
 *  DynamoDB un NULL es un atributo presente, así que `attribute_not_exists`
 *  solo no alcanza. Usan `:nulo`. */
 /** Correo normalizado, o `undefined` si no hay. Nunca cadena vacía: `email` es
  * la clave de `email-index`, y DynamoDB rechaza la escritura completa si una
  * clave de índice viene vacía. Sin el atributo, la persona simplemente no
  * entra al índice. Hasta el 27 de septiembre de 2026 se escribía `''` y no se
  * podía crear a nadie sin correo. */
const correoONada = (email) => {
    const limpio = typeof email === 'string' ? email.trim() : '';
    return limpio || undefined;
};

const SIN_PIN = '(attribute_not_exists(pinHash) OR pinHash = :nulo)';
const SIN_RESTABLECIMIENTO = '(attribute_not_exists(pinRestablecido) OR pinRestablecido = :nulo)';

/** Error de PIN con un código estable, para que la ruta responda el estado HTTP
 *  correcto sin interpretar mensajes. */
const errorPin = (mensaje, codigo) => Object.assign(new Error(mensaje), { codigo });
const { fechaHoraChile } = require('../utils/fechaChile');
const { Persona, ROLES } = require('../models/Persona');
const cifradoCampo = require('../cifradoCampo');
const { revocarSesionesDe } = require('../auth/sesion');
const { llaveDeTenant, PROPOSITOS } = require('../llaveTenant');
const {
    validateRut, validateRequired, hashPin, verifyPin,
    validatePin, generateSignatureToken, hashPassword, generateTempPassword, normalizeRol
} = require('../utils/validation');

const PERSONAS_TABLE = process.env.PERSONAS_TABLE || 'Personas';

/**
 * Contraseña inicial de una persona con acceso web (D-13): los cuatro primeros
 * dígitos de su RUT. Una sola definición: la usan el alta y la carga masiva,
 * que la necesita para el correo de bienvenida de una fila creada en un intento
 * anterior. Devuelve null si el RUT no da cuatro dígitos.
 */
function passwordInicialDeRut(rutFormateado) {
    const rutDigits = String(rutFormateado || '').replace(/[^0-9]/g, '').slice(0, -1); // quita DV
    const first4 = rutDigits.slice(0, 4);
    return first4.length === 4 ? first4 : null;
}

class PersonaService {
    constructor() {
        this.dynamo = docClient;
        this.table = PERSONAS_TABLE;
    }

    /**
     * Cifra RUT y salud de un `personaData` en construcción, con las llaves
     * COMPARTIDAS de este tenant (D-10, `lib/llaveTenant.js`): una llave para
     * el RUT, otra para salud, cada una generada una sola vez por empresa y
     * reutilizada para cada persona — así listar el plantel o contar cuántos
     * están en vigilancia de salud cuesta 1 llamada a KMS por invocación, no
     * una por persona.
     *
     * Muta `personaData` en el lugar: agrega `rutCifrado`/`rutHmac` y
     * `vigilanciaSaludCifrada`/`restriccionLaboralCifrada`, dejando además el
     * RUT y la salud EN CLARO en los mismos campos de siempre (`rut`,
     * `vigilanciaSalud`, `restriccionLaboral`) para que el constructor de
     * `Persona` los deje disponibles de inmediato en memoria.
     */
    async _cifrarCamposSensibles(tenantId, personaData) {
        const [llaveRut, llaveSalud] = await Promise.all([
            llaveDeTenant(tenantId, PROPOSITOS.RUT_PERSONAS),
            llaveDeTenant(tenantId, PROPOSITOS.SALUD),
        ]);

        const vigilancia = personaData.vigilanciaSalud !== undefined ? personaData.vigilanciaSalud : {
            enVigilancia: false, protocolos: [], fechaUltimoExamen: null, aptitudLaboral: null, restricciones: [],
        };
        const restriccion = personaData.restriccionLaboral !== undefined ? personaData.restriccionLaboral : null;

        personaData.rutHmac = await cifradoCampo.hmacRut(personaData.rut);
        personaData.rutCifrado = cifradoCampo.cifrarConLlaveDatos(personaData.rut, llaveRut);
        personaData.vigilanciaSalud = vigilancia;
        personaData.vigilanciaSaludCifrada = cifradoCampo.cifrarConLlaveDatos(vigilancia, llaveSalud);
        personaData.restriccionLaboral = restriccion;
        // `cifrarConLlaveDatosSiempre`, no `cifrarConLlaveDatos`: restriccionLaboral
        // suele ser `null` ("sin restricción") y eso SIGUE siendo un dato que se
        // cifra, no "nada que cifrar" — condicionar al contenido es el mismo
        // patrón de falla silenciosa que se evitó en las respuestas de encuesta.
        personaData.restriccionLaboralCifrada = cifradoCampo.cifrarConLlaveDatosSiempre(restriccion, llaveSalud);

        return personaData;
    }

    /**
     * Descifra RUT y salud de una o más `Persona` ya construidas, agrupando
     * por tenant para pedir la llave de cada empresa UNA sola vez sin importar
     * cuántas personas de esa empresa haya en el lote (`listByTenant` con 200
     * personas: 2 llamadas a KMS —RUT y salud del tenant—, no 400).
     *
     * Las fichas legadas (RUT o salud todavía en claro, sin migrar) no tienen
     * nada que descifrar y se dejan pasar tal cual: es el lado de LECTURA del
     * "leer y reparar" — la escritura las migra al formato nuevo la próxima
     * vez que se guarden.
     */
    async _hidratar(personas) {
        const lista = Array.isArray(personas) ? personas : [personas];
        const porTenant = new Map();
        for (const p of lista) {
            if (!p) continue;
            if (!p.rutSinDescifrar && !p.saludSinDescifrar) continue;
            if (!porTenant.has(p.tenantId)) porTenant.set(p.tenantId, []);
            porTenant.get(p.tenantId).push(p);
        }

        await Promise.all([...porTenant.entries()].map(async ([tenantId, del]) => {
            const necesitaRut = del.some((p) => p.rutSinDescifrar);
            const necesitaSalud = del.some((p) => p.saludSinDescifrar);
            const [llaveRut, llaveSalud] = await Promise.all([
                necesitaRut ? llaveDeTenant(tenantId, PROPOSITOS.RUT_PERSONAS) : null,
                necesitaSalud ? llaveDeTenant(tenantId, PROPOSITOS.SALUD) : null,
            ]);
            for (const p of del) {
                if (p.rutSinDescifrar) p.rut = cifradoCampo.descifrarConLlaveDatos(p._rutCifrado, llaveRut);
                if (p.saludSinDescifrar) {
                    p.vigilanciaSalud = cifradoCampo.descifrarConLlaveDatos(p._vigilanciaSaludCifrada, llaveSalud);
                    p.restriccionLaboral = cifradoCampo.descifrarConLlaveDatosSiempre(p._restriccionLaboralCifrada, llaveSalud);
                }
            }
        }));

        return Array.isArray(personas) ? lista : lista[0] || null;
    }

    /**
     * Arma los datos de una "alta nueva" (personaId + campos base) a partir del
     * body recibido. Compartido por crear() (persona 100% nueva) y
     * transferirEntreTenants() (persona existente que cambia de tenant, donde se
     * reutiliza el personaId de origen en vez de generar uno nuevo).
     */
    async _datosBaseAlta(tenantId, data, { personaId } = {}) {
        const rutValidation = validateRut(data.rut);
        if (!rutValidation.valid) throw new Error('RUT invalido');

        if (!data.rol || typeof data.rol !== 'string' || !data.rol.trim()) {
            throw new Error('El campo rol es requerido');
        }

        const resolvedPersonaId = personaId || uuidv4();
        const now = new Date().toISOString();
        // Los roles del sistema tienen permisos predefinidos; los roles personalizados del tenant no.
        // Se normaliza para admitir nombres con mayúsculas o espacios ("Jefe de Obra", "Prevencionista").
        const rolConfig = ROLES[normalizeRol(data.rol)];
        const tieneAccesoWeb = data.tieneAccesoWeb !== undefined ? data.tieneAccesoWeb : Boolean(rolConfig);
        let passwordTemporal = null;

        const apellidoPaterno = data.apellidoPaterno || '';
        const apellidoMaterno = data.apellidoMaterno || '';
        const apellido = data.apellido || [apellidoPaterno, apellidoMaterno].filter(Boolean).join(' ');

        const personaData = {
            personaId: resolvedPersonaId,
            tenantId,
            rut: rutValidation.formatted,
            nombre: data.nombre,
            apellidoPaterno,
            apellidoMaterno,
            apellido,
            fechaNacimiento: data.fechaNacimiento || null,
            email: correoONada(data.email),
            telefono: data.telefono || '',
            rol: data.rol,
            permisos: rolConfig ? rolConfig.permisos : [],
            // El cargo es el oficio DS44 (del catálogo de /onboarding), NO el rol.
            // Si no se indica, queda vacío: antes se rellenaba con el nombre del rol
            // ("Trabajador"), creando cargos fantasma que no existen en el catálogo.
            cargo: data.cargo || null,
            obraIds: data.obraIds || [],
            // Si vienen asignaciones explícitas (obra+cargos), priman; si no, el
            // modelo las deriva de obraIds + cargo (shim de compatibilidad).
            asignaciones: Array.isArray(data.asignaciones) ? data.asignaciones : undefined,
            evidencias: Array.isArray(data.evidencias) ? data.evidencias : [],
            contactoEmergencia: data.contactoEmergencia || { nombre: '', telefono: '', relacion: '' },
            nivelEscolar: data.nivelEscolar || '',
            cursos: Array.isArray(data.cursos) ? data.cursos : [],
            tieneAccesoWeb,
            habilitado: false,
            estado: 'pendiente',
            creadoPor: data.creadoPor || null,
            createdAt: now,
            updatedAt: now
        };

        // Generar password temporal si tiene acceso web.
        // Convención: los primeros 4 dígitos del RUT (sin puntos ni dígito verificador).
        // El usuario debe cambiarla en el primer ingreso (passwordTemporal = true).
        //
        // CON o SIN correo. La convención existe precisamente porque en terreno
        // mucha gente no tiene correo: la contraseña se le dice en persona. Hasta
        // el 27 de septiembre de 2026 solo se generaba si había correo, así que
        // quien no lo tenía quedaba sin forma de entrar.
        if (tieneAccesoWeb && data.password) {
            // Contraseña elegida por la propia persona (onboarding por interfaz):
            // no es temporal y no hay nada que cambiar en el primer ingreso.
            personaData.passwordHash = await hashPassword(data.password, resolvedPersonaId);
            personaData.passwordTemporal = false;
        } else if (tieneAccesoWeb) {
            passwordTemporal = passwordInicialDeRut(rutValidation.formatted) || generateTempPassword(10);
            personaData.passwordHash = await hashPassword(passwordTemporal, resolvedPersonaId);
            personaData.passwordTemporal = true;
        }

        await this._cifrarCamposSensibles(tenantId, personaData);

        return { personaData, passwordTemporal };
    }

    /**
     * Crear una nueva persona dentro de un tenant
     */
    /**
     * @param {object} [opciones]
     * @param {string} [opciones.personaId] - id dado por quien llama. Lo usa la
     *        carga masiva (D-24) para que crear sea idempotente: el id sale de
     *        `(cargaId, RUT)` y la escritura es condicional, así que un reintento
     *        de la cola nunca crea a la misma persona dos veces.
     */
    async crear(tenantId, data, { personaId } = {}) {
        const validation = validateRequired(data, ['rut', 'nombre', 'rol']);
        if (!validation.valid) {
            throw new Error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const rutValidation = validateRut(data.rut);
        if (!rutValidation.valid) throw new Error('RUT invalido');

        // Verificar unicidad por RUT dentro del tenant (via GSI)
        const existente = await this.getByRut(tenantId, rutValidation.formatted);
        if (existente) throw new Error('Ya existe una persona con este RUT en este tenant');

        const { personaData, passwordTemporal } = await this._datosBaseAlta(tenantId, data, { personaId });
        const persona = new Persona(personaData);

        await this.dynamo.send(new PutCommand({
            TableName: this.table,
            Item: persona.toDynamoItem(),
            ...(personaId ? { ConditionExpression: 'attribute_not_exists(SK)' } : {}),
        }));

        return { persona, passwordTemporal };
    }

    /**
     * Ficha completa a partir de la clave que devuelve un índice.
     *
     * Los tres índices de personas están proyectados con `KEYS_ONLY`: guardan solo
     * lo justo para llegar a la ficha, y no una copia entera con el hash del PIN,
     * el de la contraseña y los campos de salud. El precio es este paso: el índice
     * dice dónde está, la tabla dice qué es.
     *
     * Es PÚBLICA a propósito. Quien consulte un índice directamente tiene que
     * pasar por acá y no deducir la ficha de lo que venga en el resultado: cada
     * índice proyecta solo SUS claves, así que `tenantRutHmac-index` trae
     * `tenantId` y `rutHmac` pero NO `personaId`. Asumir lo contrario fue
     * exactamente el error que dejó sin funcionar la recuperación de contraseña.
     *
     * Descifra RUT y salud (D-10) antes de devolver la ficha: de acá en más el
     * resto del sistema sigue leyendo `persona.rut` en claro como siempre.
     */
    async fichaDesdeClave(item) {
        if (!item) return null;
        const result = await this.dynamo.send(new GetCommand({
            TableName: this.table,
            Key: { PK: item.PK, SK: item.SK },
        }));
        return this._hidratar(Persona.fromDynamoItem(result.Item));
    }

    /** Ítem CRUDO de la ficha (con los campos que el modelo no preserva). */
    async itemDesdeClave(item) {
        if (!item) return null;
        const result = await this.dynamo.send(new GetCommand({
            TableName: this.table,
            Key: { PK: item.PK, SK: item.SK },
        }));
        return result.Item || null;
    }

    /**
     * Obtener persona por ID (via GSI personaId-index)
     */
    async getById(personaId) {
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'personaId-index',
            KeyConditionExpression: 'personaId = :personaId',
            ExpressionAttributeValues: { ':personaId': personaId }
        }));
        if (!result.Items || result.Items.length === 0) return null;
        return this.fichaDesdeClave(result.Items[0]);
    }

    /** Ítem crudo por personaId: lo necesita el flujo de recuperación de clave,
     *  que usa campos (`resetTokenHash`) que el modelo no preserva. */
    async getItemById(personaId) {
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'personaId-index',
            KeyConditionExpression: 'personaId = :personaId',
            ExpressionAttributeValues: { ':personaId': personaId }
        }));
        if (!result.Items || result.Items.length === 0) return null;
        return this.itemDesdeClave(result.Items[0]);
    }

    /**
     * Buscar si un RUT ya existe en cualquier tenant (scan global)
     */
    async getByRutGlobal(rut) {
        const todas = await this.getAllByRutGlobal(rut);
        return todas[0] || null;
    }

    /**
     * Busca TODAS las fichas (en cualquier tenant, cualquier estado) que
     * coinciden con un RUT. Base para el login multi-tenant: una persona puede
     * pertenecer a varias empresas a la vez.
     *
     * El filtro compara por `rutHmac` (D-10) O por `rut` en claro: las fichas
     * ya migradas solo tienen HMAC, las que todavía no se migraron solo tienen
     * el RUT en claro (leer-y-reparar). El día que no quede ninguna ficha
     * legada, la segunda rama del filtro deja de encontrar algo y se puede
     * quitar — no antes, porque hasta entonces sigue siendo el único camino
     * para encontrarlas.
     */
    async getAllByRutGlobal(rut) {
        const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
        const rutValidation = validateRut(rut);
        const rutFormatted = rutValidation.valid ? rutValidation.formatted : rut;
        const rutHmac = await cifradoCampo.hmacRut(rutFormatted);
        const result = await this.dynamo.send(new ScanCommand({
            TableName: this.table,
            FilterExpression: '(rutHmac = :h OR rut = :rut) AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':h': rutHmac, ':rut': rutFormatted, ':prefix': 'PERSONA#' }
        }));
        return this._hidratar((result.Items || []).map((item) => Persona.fromDynamoItem(item)));
    }

    /**
     * Propaga una contraseña recién cambiada a las demás fichas (otros tenants)
     * de la misma persona, para que la contraseña siga siendo "una sola" para
     * toda la identidad. Recibe la ficha ya actualizada (origen) + la
     * contraseña en texto plano (necesaria para recalcular el hash con la sal
     * propia de cada ficha hermana).
     *
     * @returns {Promise<string[]>} los `personaId` de las fichas hermanas que
     *   cambió: sus sesiones abiertas también hay que revocarlas (D-26).
     */
    async propagarPassword(personaOrigen, passwordPlano, { passwordTemporal = false } = {}) {
        const todas = await this.getAllByRutGlobal(personaOrigen.rut);
        const hermanas = todas.filter((p) => p.personaId !== personaOrigen.personaId && p.tieneAccesoWeb);
        const now = new Date().toISOString();

        // Los hashes se calculan en fila, no en paralelo: scrypt reserva 32 MB
        // por cálculo y la Lambda tiene 1 GB. Con una persona en muchas empresas,
        // hacerlos todos a la vez es la forma de quedarse sin memoria justo
        // mientras alguien cambia su contraseña.
        const hashes = [];
        for (const h of hermanas) hashes.push(await hashPassword(passwordPlano, h.personaId));

        await Promise.all(hermanas.map((h, i) => this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: { PK: `TENANT#${h.tenantId}`, SK: `PERSONA#${h.personaId}` },
            UpdateExpression: 'SET passwordHash = :passwordHash, passwordTemporal = :passwordTemporal, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':passwordHash': hashes[i],
                ':passwordTemporal': passwordTemporal,
                ':updatedAt': now
            }
        }))));
        return hermanas.map((h) => h.personaId);
    }

    /**
     * Obtener persona por RUT dentro de un tenant (via GSI tenantRut-index)
     */
    async getByRut(tenantId, rut) {
        const rutValidation = validateRut(rut);
        const rutFormatted = rutValidation.valid ? rutValidation.formatted : rut;
        const rutHmac = await cifradoCampo.hmacRut(rutFormatted);

        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'tenantRutHmac-index',
            KeyConditionExpression: 'tenantId = :tenantId AND rutHmac = :h',
            ExpressionAttributeValues: {
                ':tenantId': tenantId,
                ':h': rutHmac
            }
        }));
        if (!result.Items || result.Items.length === 0) return null;
        return this.fichaDesdeClave(result.Items[0]);
    }

    /**
     * Obtener persona por email (via GSI email-index, cross-tenant para login)
     */
    async getByEmail(email) {
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'email-index',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: { ':email': email }
        }));
        if (!result.Items || result.Items.length === 0) return null;
        return this.fichaDesdeClave(result.Items[0]);
    }

    /**
     * Listar personas de un tenant (via PK)
     *
     * Por omisión deja fuera a quien tiene el tratamiento BLOQUEADO por una
     * solicitud de rectificación, supresión u oposición pendiente (Ley 21.719,
     * lib/gobernanza/derechos.js): no se la lista, no se la convoca, no se le
     * avisa ni se le asigna nada. `incluirBloqueadas: true` solo donde el uso es
     * conservación u obligación legal, no tratamiento nuevo: detectar RUT
     * duplicados en la carga masiva, los informes para la autoridad y el
     * registro de los comités.
     */
    async listByTenant(tenantId, filters = {}) {
        let filterExpression = '';
        const expressionValues = {
            ':pk': `TENANT#${tenantId}`,
            ':prefix': 'PERSONA#'
        };
        const expressionNames = {};

        if (filters.rol) {
            filterExpression += 'rol = :rol';
            expressionValues[':rol'] = filters.rol;
        }
        if (filters.estado) {
            filterExpression += filterExpression ? ' AND #estado = :estado' : '#estado = :estado';
            expressionNames['#estado'] = 'estado';
            expressionValues[':estado'] = filters.estado;
        } else {
            // Por defecto excluir personas desvinculadas
            filterExpression += filterExpression ? ' AND #estado <> :desvinculado' : '#estado <> :desvinculado';
            expressionNames['#estado'] = 'estado';
            expressionValues[':desvinculado'] = 'desvinculado';
        }
        if (filters.obraId) {
            filterExpression += ' AND contains(obraIds, :obraId)';
            expressionValues[':obraId'] = filters.obraId;
        }
        if (!filters.incluirBloqueadas) {
            // El conjunto se elimina solo cuando queda vacío (DynamoDB no guarda
            // conjuntos vacíos): sin el atributo, no hay bloqueo.
            filterExpression += ' AND attribute_not_exists(solicitudesBloqueo)';
        }

        const params = {
            TableName: this.table,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: expressionValues
        };

        if (filterExpression) {
            params.FilterExpression = filterExpression;
        }
        if (Object.keys(expressionNames).length > 0) {
            params.ExpressionAttributeNames = expressionNames;
        }

        const result = await this.dynamo.send(new QueryCommand(params));
        // Descifra RUT y salud del plantel completo con 2 llamadas a KMS —una
        // por tenant, no una por persona— gracias a la llave compartida (D-10).
        return this._hidratar((result.Items || []).map(item => Persona.fromDynamoItem(item)));
    }

    /**
     * Actualizar datos de una persona
     */
    async actualizar(tenantId, personaId, updates) {
        const allowedFields = ['nombre', 'apellido', 'apellidoPaterno', 'apellidoMaterno', 'email', 'telefono',
            'fechaNacimiento', 'fotoPerfil',
            'rol', 'cargo', 'estado', 'preferencias', 'obraIds', 'asignaciones', 'historialAsignaciones', 'evidencias',
            'onboardingDS44', 'contactoEmergencia', 'nivelEscolar', 'cursos'];

        const updateExpressions = [];
        const expressionNames = {};
        const expressionValues = {};

        // Borrar el correo es quitar el atributo, no dejarlo en '' (ver `correoONada`).
        const quitar = [];
        if (updates.email !== undefined && !correoONada(updates.email)) {
            quitar.push('#email');
            expressionNames['#email'] = 'email';
            updates = { ...updates, email: undefined };
        } else if (updates.email !== undefined) {
            updates = { ...updates, email: correoONada(updates.email) };
        }

        allowedFields.forEach(field => {
            if (updates[field] !== undefined) {
                updateExpressions.push(`#${field} = :${field}`);
                expressionNames[`#${field}`] = field;
                expressionValues[`:${field}`] = updates[field];
            }
        });

        // vigilanciaSalud/restriccionLaboral (D-10): salen del bucle genérico
        // porque el atributo de la tabla no es el mismo que el campo del
        // `updates` — se guardan cifradas, con la llave compartida de este
        // tenant, nunca en claro.
        if (updates.vigilanciaSalud !== undefined || updates.restriccionLaboral !== undefined) {
            const llaveSalud = await llaveDeTenant(tenantId, PROPOSITOS.SALUD);
            if (updates.vigilanciaSalud !== undefined) {
                updateExpressions.push('#vigilanciaSaludCifrada = :vigilanciaSaludCifrada');
                expressionNames['#vigilanciaSaludCifrada'] = 'vigilanciaSaludCifrada';
                expressionValues[':vigilanciaSaludCifrada'] = cifradoCampo.cifrarConLlaveDatos(updates.vigilanciaSalud, llaveSalud);
            }
            if (updates.restriccionLaboral !== undefined) {
                updateExpressions.push('#restriccionLaboralCifrada = :restriccionLaboralCifrada');
                expressionNames['#restriccionLaboralCifrada'] = 'restriccionLaboralCifrada';
                expressionValues[':restriccionLaboralCifrada'] = cifradoCampo.cifrarConLlaveDatosSiempre(updates.restriccionLaboral, llaveSalud);
            }
        }

        if (updateExpressions.length === 0 && quitar.length === 0) throw new Error('No hay campos para actualizar');

        // Reloj de la conservación: el plazo de retención de la evidencia de una
        // persona se cuenta desde que termina su vínculo laboral, así que la fecha
        // tiene que existir cuando eso ocurre. La escribe el servidor, no el
        // cliente, y se limpia si la persona vuelve a estar activa.
        if (updates.estado !== undefined) {
            const termina = ['inactivo', 'desvinculado'].includes(updates.estado);
            updateExpressions.push('#fechaTerminoVinculo = :fechaTerminoVinculo');
            expressionNames['#fechaTerminoVinculo'] = 'fechaTerminoVinculo';
            if (termina) {
                // Si ya había una fecha (p. ej. inactivo → desvinculado) se conserva
                // la primera: el vínculo terminó entonces, no ahora.
                // Sin degradar: si esta lectura falla, el `null` haría que se
                // escribiera la fecha de HOY sobre la original, y esa fecha es
                // desde la que se cuentan los cinco años de conservación de su
                // evidencia. Perderla es perder el plazo.
                const actual = await this.getById(personaId);
                expressionValues[':fechaTerminoVinculo'] = actual?.fechaTerminoVinculo || new Date().toISOString();
            } else {
                expressionValues[':fechaTerminoVinculo'] = null;
            }
        }

        updateExpressions.push('#updatedAt = :updatedAt');
        expressionNames['#updatedAt'] = 'updatedAt';
        expressionValues[':updatedAt'] = new Date().toISOString();

        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `PERSONA#${personaId}`
            },
            UpdateExpression: `SET ${updateExpressions.join(', ')}${quitar.length ? ` REMOVE ${quitar.join(', ')}` : ''}`,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues,
            ReturnValues: 'ALL_NEW'
        }));

        return this._hidratar(Persona.fromDynamoItem(result.Attributes));
    }

    /**
     * Persiste asignaciones + mantiene el espejo obraIds en el mismo update
     * (DynamoDB UpdateCommand es parcial: hay que escribir ambos juntos para que
     * no queden inconsistentes).
     */
    async _persistAsignaciones(tenantId, personaId, asignaciones) {
        const obraIds = [...new Set(asignaciones.map((a) => a.obraId))];
        return this.actualizar(tenantId, personaId, { asignaciones, obraIds });
    }

    /**
     * Asigna (o reemplaza) los cargos de la persona en una obra. cargos es la
     * lista COMPLETA de cargos en esa obra (multi-cargo). Devuelve la persona y
     * los obraId nuevos (para que el caller dispare onboarding solo en esos).
     */
    async setAsignacionObra(tenantId, personaId, obraId, cargos = [], supervisorPersonaId = undefined, asignadaPor = undefined, prevencionistaPersonaId = undefined) {
        const persona = await this.getById(personaId);
        if (!persona) throw new Error('Persona no encontrada');
        const yaAsignada = persona.asignaciones.some((a) => a.obraId === obraId);
        const prev = persona.asignaciones.find((a) => a.obraId === obraId);
        const asignaciones = persona.asignaciones.filter((a) => a.obraId !== obraId);
        asignaciones.push({
            obraId,
            cargos: Persona._normalizeCargos(cargos),
            // Si no se envía supervisor se conserva el previo (no se borra al editar cargos).
            supervisorPersonaId: supervisorPersonaId !== undefined
                ? (supervisorPersonaId || null)
                : (prev?.supervisorPersonaId || null),
            // Prevencionista a cargo (para supervisores). Mismo criterio: si no se
            // envía, se conserva el previo.
            prevencionistaPersonaId: prevencionistaPersonaId !== undefined
                ? (prevencionistaPersonaId || null)
                : (prev?.prevencionistaPersonaId || null),
            fechaIngreso: prev?.fechaIngreso || new Date().toISOString(),
            // Quién asignó: al crear se toma el actor; al editar se conserva el original.
            asignadaPor: yaAsignada ? (prev?.asignadaPor || null) : (asignadaPor || null),
            estado: 'activa',
        });
        const actualizada = await this._persistAsignaciones(tenantId, personaId, asignaciones);
        return { persona: actualizada, esNueva: !yaAsignada };
    }

    /**
     * Quita la asignación de la persona a una obra. NO la borra: la mueve a
     * `historialAsignaciones[]` con egreso + auditoría (finalizadaPor, motivo).
     * Las evidencias persona-level se conservan intactas.
     * @param {{ finalizadaPor?: string, motivo?: string }} opts
     */
    async quitarDeObra(tenantId, personaId, obraId, opts = {}) {
        const persona = await this.getById(personaId);
        if (!persona) throw new Error('Persona no encontrada');
        const asignacion = persona.asignaciones.find((a) => a.obraId === obraId);
        const asignaciones = persona.asignaciones.filter((a) => a.obraId !== obraId);
        const obraIds = [...new Set(asignaciones.map((a) => a.obraId))];

        const historialAsignaciones = [...(persona.historialAsignaciones || [])];
        if (asignacion) {
            historialAsignaciones.push({
                obraId: asignacion.obraId,
                cargos: asignacion.cargos || [],
                supervisorPersonaId: asignacion.supervisorPersonaId || null,
                prevencionistaPersonaId: asignacion.prevencionistaPersonaId || null,
                fechaIngreso: asignacion.fechaIngreso || null,
                fechaEgreso: new Date().toISOString(),
                asignadaPor: asignacion.asignadaPor || null,
                finalizadaPor: opts.finalizadaPor || null,
                motivo: opts.motivo || 'egreso',
            });
        }
        return this.actualizar(tenantId, personaId, { asignaciones, obraIds, historialAsignaciones });
    }

    /**
     * Registra/actualiza una evidencia persona-level con vigencia (examen altura,
     * SPDC…). Se guarda la última por tipo (la vigente que reutilizan las obras).
     */
    async addEvidencia(tenantId, personaId, evidencia) {
        const persona = await this.getById(personaId);
        if (!persona) throw new Error('Persona no encontrada');
        const evidencias = [
            ...persona.evidencias.filter((e) => e.tipo !== evidencia.tipo),
            { ...evidencia, registradoEn: new Date().toISOString() },
        ];
        return this.actualizar(tenantId, personaId, { evidencias });
    }

    /**
     * Configura o cambia el PIN de una persona. Es la credencial con la que se
     * firma: quien la fija puede firmar por esa persona. Por eso la regla vive
     * ACÁ, en el único punto por donde pasa todo cambio de PIN, y no en cada
     * ruta que lo llame:
     *
     *   - si la persona YA tiene PIN, solo ella lo cambia, probando el actual, y
     *     esa prueba pasa por el límite de intentos (D-9);
     *   - si no lo tiene, lo configura ella o quien tenga el permiso de enrolar
     *     (en terreno el trabajador teclea su PIN en el dispositivo de quien lo
     *     registra);
     *   - si no lo tiene porque alguien lo RESTABLECIÓ (`pinRestablecido`), vale
     *     lo mismo, con una excepción: quien restableció no puede ser quien
     *     asiste. Restablecer y asistir son las dos mitades de poner un PIN que
     *     la persona no eligió sola; exigir que sean dos personas distintas es
     *     lo que impide que una sola se quede con la credencial de otra.
     *
     * Cada evento queda en `pinHistorial`, con quién lo hizo y si fue asistido.
     *
     * Hasta el 26 de septiembre de 2026 el PIN actual se verificaba solo "si el
     * cliente lo envía": omitirlo cambiaba el PIN sin prueba. La ruta lo exigía,
     * pero era la única defensa, y la escritura no estaba condicionada: entre que
     * la ruta leía "no tiene PIN" y el servicio escribía, un PIN recién creado se
     * podía sobrescribir sin conocerlo. Ahora la escritura solo procede si el PIN
     * guardado sigue siendo el que se verificó (o si sigue sin haber uno).
     *
     * @param {object} actor - quién pide el cambio, SIEMPRE desde la sesión:
     *        `{ personaId, nombre, puedeEnrolar }`.
     */
    async setPin(tenantId, personaId, pin, pinActual, actor) {
        if (!actor?.personaId) throw errorPin('Falta quién cambia el PIN', 'PIN_SIN_ACTOR');

        const pinValidation = validatePin(pin);
        if (!pinValidation.valid) throw errorPin(pinValidation.error, 'PIN_INVALIDO');

        const persona = await this.getById(personaId);
        if (!persona) throw errorPin('Persona no encontrada', 'PERSONA_NO_ENCONTRADA');

        const esPropio = actor.personaId === personaId;
        const pinAnterior = persona._pinHash || null;

        if (pinAnterior) {
            if (!esPropio) throw errorPin('Solo la propia persona puede cambiar su PIN', 'PIN_AJENO');
            if (!pinActual) throw errorPin('Debes ingresar tu PIN actual para cambiarlo', 'PIN_ACTUAL_REQUERIDO');
            // Lanza PIN_BLOQUEADO si la cuenta está bloqueada, y cuenta el fallo.
            const ok = await verificarConLimiteOLanzar(persona, pinActual, verifyPin);
            if (!ok) throw errorPin('PIN actual incorrecto', 'PIN_ACTUAL_INCORRECTO');
            if (await verifyPin(pin, pinAnterior, personaId)) {
                throw errorPin('El nuevo PIN no puede ser igual al PIN actual', 'PIN_IGUAL');
            }
        } else if (!esPropio && !actor.puedeEnrolar) {
            throw errorPin('No tienes permiso para configurar el PIN de otra persona', 'PIN_AJENO');
        }

        const restablecido = pinAnterior ? null : (persona.pinRestablecido || null);
        if (restablecido && !esPropio && restablecido.por === actor.personaId) {
            throw errorPin('Restableciste este PIN, así que no puedes asistir en la configuración del nuevo. '
                + 'Debe hacerlo otra persona, o el propio trabajador desde su cuenta.', 'PIN_MISMA_PERSONA');
        }

        const now = new Date().toISOString();
        const newPinHash = await hashPin(pin, personaId);
        const evento = {
            evento: pinAnterior ? 'cambiado' : 'configurado',
            por: actor.personaId,
            nombre: actor.nombre || null,
            asistido: !esPropio,
            en: now,
            ...(restablecido ? { trasRestablecimientoDe: restablecido.en } : {}),
        };

        // Lo que se verificó tiene que seguir siendo cierto al escribir:
        //   - con PIN: el mismo hash que se probó;
        //   - sin PIN tras un restablecimiento: ESE restablecimiento (otro
        //     posterior podría ser de otra persona, y entonces quien asiste
        //     tendría que volver a pasar la regla);
        //   - sin PIN y sin restablecimiento: que siga sin haber ninguno.
        //
        // "Sin PIN" es ausente O NULL: `crear` guarda `pinHash: null`, un
        // atributo presente. El 26 de septiembre de 2026 esta condición decía
        // solo `attribute_not_exists(pinHash)`, y con eso ninguna persona nueva
        // podía configurar su primer PIN (ver `tests/expresiones-dynamo.js`).
        let condicion;
        const valores = {
            ':pinHash': newPinHash, ':pinCreatedAt': now, ':updatedAt': now,
            ':evento': [evento], ':vacia': [],
        };
        if (pinAnterior) {
            condicion = 'pinHash = :anterior';
            valores[':anterior'] = pinAnterior;
        } else if (restablecido) {
            condicion = `${SIN_PIN} AND pinRestablecido.en = :restEn`;
            valores[':restEn'] = restablecido.en;
            valores[':nulo'] = null;
        } else {
            condicion = `${SIN_PIN} AND ${SIN_RESTABLECIMIENTO}`;
            valores[':nulo'] = null;
        }

        try {
            await this.dynamo.send(new UpdateCommand({
                TableName: this.table,
                Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
                UpdateExpression: 'SET pinHash = :pinHash, pinCreatedAt = :pinCreatedAt, updatedAt = :updatedAt,'
                    + ' pinHistorial = list_append(if_not_exists(pinHistorial, :vacia), :evento)'
                    + ' REMOVE pinRestablecido',
                ConditionExpression: condicion,
                ExpressionAttributeValues: valores,
            }));
        } catch (err) {
            if (err.name !== 'ConditionalCheckFailedException') throw err;
            throw errorPin('El PIN cambió mientras se procesaba la solicitud. Intenta de nuevo.', 'PIN_CAMBIO_CONCURRENTE');
        }

        return {
            message: pinAnterior ? 'PIN actualizado exitosamente' : 'PIN configurado exitosamente',
            pinCreatedAt: now
        };
    }

    /**
     * Restablece el PIN de una persona que lo olvidó: lo borra para que se
     * configure uno nuevo. Nadie ve ni fija el PIN acá; solo se quita el que
     * había.
     *
     * Tres garantías, en este orden de importancia:
     *
     *   1. **No hay restablecimiento sin aviso.** Quitar el PIN y dejar el
     *      mensaje en la bandeja de la persona son UNA transacción: o pasan las
     *      dos o ninguna. La persona afectada es la única que puede notar que no
     *      lo pidió, así que un restablecimiento que ella no se entera que
     *      ocurrió no puede existir. El correo, si tiene, va después y es mejor
     *      esfuerzo: SES no entra en una transacción de DynamoDB, pero si falla
     *      queda medido (`registrarFallo`) y se le dice a quien restableció.
     *   2. **Quien restablece no puede asistir en el PIN nuevo** (ver `setPin`).
     *      Queda registrado en `pinRestablecido` hasta que se configura, y en
     *      `pinHistorial` para siempre.
     *   3. **Los vales sin usar se anulan**: se desbloquearon con el PIN
     *      anterior. Tampoco entran en la transacción (son N escrituras de otra
     *      tabla); lo que no se pudo anular se informa, no se calla.
     *
     * La escritura exige que el PIN siga siendo el que se leyó: dos
     * restablecimientos simultáneos no generan dos avisos por un solo cambio,
     * y uno no borra un PIN que la persona acaba de configurar.
     *
     * @param {object} actor - desde la sesión: `{ personaId, nombre }`. El
     *        permiso (`persona.restablecer_pin`) lo verifica la ruta.
     */
    async restablecerPin(tenantId, personaId, motivo, actor) {
        if (!actor?.personaId) throw errorPin('Falta quién restablece el PIN', 'PIN_SIN_ACTOR');
        const motivoLimpio = String(motivo ?? '').trim();
        if (motivoLimpio.length < MOTIVO_MIN) {
            throw errorPin(`Indica el motivo del restablecimiento (al menos ${MOTIVO_MIN} caracteres).`, 'MOTIVO_REQUERIDO');
        }
        if (motivoLimpio.length > MOTIVO_MAX) {
            throw errorPin(`El motivo no puede superar ${MOTIVO_MAX} caracteres.`, 'MOTIVO_REQUERIDO');
        }

        const persona = await this.getById(personaId);
        if (!persona || persona.tenantId !== tenantId) throw errorPin('Persona no encontrada', 'PERSONA_NO_ENCONTRADA');
        const pinAnterior = persona._pinHash || null;
        if (!pinAnterior) {
            throw errorPin(persona.pinRestablecido
                ? 'El PIN de esta persona ya está restablecido y espera que se configure uno nuevo.'
                : 'Esta persona todavía no tiene PIN: no hay nada que restablecer.', 'PIN_NO_CONFIGURADO');
        }

        const ahora = new Date();
        const en = ahora.toISOString();
        const porNombre = actor.nombre || 'Un administrador';
        const restablecimiento = { por: actor.personaId, nombre: porNombre, en, motivo: motivoLimpio };
        const { fecha, horario } = fechaHoraChile(ahora);

        const aviso = construirMensaje({
            recipientId: personaId,
            baseMessageId: uuidv4(),
            now: en,
            senderId: actor.personaId,
            senderName: porNombre,
            senderRol: 'system',
            type: 'alert',
            priority: 'high',
            subject: 'Tu PIN de firma fue restablecido',
            content: `${porNombre} restableció tu PIN de firma el ${fecha} a las ${horario}. `
                + `Motivo: ${motivoLimpio}\n\n`
                + 'Tu PIN anterior ya no sirve y tus vales para firmar sin conexión quedaron anulados. '
                + 'Para volver a firmar, crea un PIN nuevo: tú mismo en Configuración, «Crear PIN de firma nuevo», o en terreno con ayuda de alguien '
                + 'distinto de quien lo restableció. El PIN nuevo lo escribes tú; nadie más debe conocerlo.\n\n'
                + 'Si no pediste esto, avisa a tu empresa o al prevencionista de tu obra.',
            linkedEntity: { type: 'persona', id: personaId },
        });

        try {
            await this.dynamo.send(new TransactWriteCommand({
                TransactItems: [
                    {
                        Update: {
                            TableName: this.table,
                            Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
                            UpdateExpression: 'SET pinRestablecido = :rest, pinIntentosFallidos = :cero, updatedAt = :en,'
                                + ' pinHistorial = list_append(if_not_exists(pinHistorial, :vacia), :evento)'
                                + ' REMOVE pinHash, pinCreatedAt, pinBloqueadaHasta',
                            ConditionExpression: 'pinHash = :anterior',
                            ExpressionAttributeValues: {
                                ':rest': restablecimiento,
                                ':cero': 0,
                                ':en': en,
                                ':vacia': [],
                                ':evento': [{ evento: 'restablecido', ...restablecimiento }],
                                ':anterior': pinAnterior,
                            },
                        },
                    },
                    {
                        Put: {
                            TableName: INBOX_TABLE,
                            Item: aviso,
                            ConditionExpression: 'attribute_not_exists(messageId)',
                        },
                    },
                ],
            }));
        } catch (err) {
            const razones = err.CancellationReasons || [];
            if (err.name === 'TransactionCanceledException' && razones[0]?.Code === 'ConditionalCheckFailed') {
                throw errorPin('El PIN cambió mientras se procesaba la solicitud. Revisa el estado y vuelve a intentar.', 'PIN_CAMBIO_CONCURRENTE');
            }
            throw err;
        }

        // Desde acá el restablecimiento ya ocurrió y la persona ya tiene su aviso.
        // Lo que sigue no puede deshacerlo, pero tampoco puede fallar en silencio.
        let vales;
        try {
            vales = await ValeFirmaService.revocarDePersona(personaId, {
                tenantId, motivo: 'pin_restablecido', por: actor.personaId,
            });
            if (vales.fallidos > 0) registrarFallo('pin.revocar_vales', new Error(`${vales.fallidos} vales sin anular`), { personaId });
        } catch (err) {
            registrarFallo('pin.revocar_vales', err, { personaId });
            vales = { revocados: 0, noAplicaban: 0, fallidos: null };
        }

        let correo = 'sin-correo';
        if (persona.email) {
            // Carga diferida: `lib/` no depende de `handlers/` al importarse.
            const { sendPinRestablecidoEmail } = require('../../handlers/notifications/handler');
            const r = await sendPinRestablecidoEmail(persona.email, persona.nombre, { porNombre, fecha, horario, motivo: motivoLimpio })
                .catch((err) => ({ sent: false, err }));
            correo = r.sent ? 'enviado' : 'fallido';
            if (!r.sent) registrarFallo('correo.pin_restablecido', r.err || new Error(r.error || 'no enviado'), { personaId });
        }

        return {
            message: 'PIN restablecido. La persona fue avisada y debe configurar uno nuevo.',
            restablecidoEn: en,
            avisoBandeja: true,
            avisoCorreo: correo,
            // `null` = no se pudo ni consultar cuáles había: hay que revisarlo.
            valesAnulados: vales.revocados,
            valesSinAnular: vales.fallidos,
        };
    }

    /**
     * Completar enrolamiento — un solo update (no dos como antes)
     */
    async completarEnrolamiento(tenantId, personaId, pin, eventContext) {
        const persona = await this.getById(personaId);
        if (!persona) throw new Error('Persona no encontrada');
        if (persona.estaEnrolado()) throw new Error('La persona ya esta enrolada');

        // Verificar PIN
        const pinValido = await verificarConLimiteOLanzar(persona, pin, verifyPin);
        if (!pinValido) throw new Error('PIN incorrecto');

        const now = new Date();
        const token = generateSignatureToken();
        const ipAddress = eventContext?.requestContext?.http?.sourceIp
            || eventContext?.requestContext?.identity?.sourceIp || 'unknown';

        const firmaEnrolamiento = {
            token,
            ...fechaHoraChile(now),
            timestamp: now.toISOString(),
            metodoValidacion: 'PIN',
            ipAddress
        };

        await this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `PERSONA#${personaId}`
            },
            UpdateExpression: 'SET habilitado = :habilitado, estado = :estado, firmaEnrolamiento = :firmaEnrolamiento, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':habilitado': true,
                ':estado': 'activo',
                ':firmaEnrolamiento': firmaEnrolamiento,
                ':updatedAt': now.toISOString()
            }
        }));

        return {
            message: 'Enrolamiento completado exitosamente',
            personaId,
            habilitado: true,
            firma: {
                token: firmaEnrolamiento.token,
                fecha: firmaEnrolamiento.fecha,
                horario: firmaEnrolamiento.horario
            }
        };
    }
    /**
     * Resetear contraseña — genera nueva password temporal y la propaga a las
     * demás fichas (otras empresas) de la misma persona.
     */
    async resetPassword(tenantId, personaId) {
        const persona = await this.getById(personaId);
        if (!persona) throw new Error('Persona no encontrada');

        const passwordTemporal = generateTempPassword(10);
        const passwordHash = await hashPassword(passwordTemporal, personaId);
        const now = new Date().toISOString();

        await this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `PERSONA#${personaId}`
            },
            UpdateExpression: 'SET passwordHash = :passwordHash, passwordTemporal = :passwordTemporal, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':passwordHash': passwordHash,
                ':passwordTemporal': true,
                ':updatedAt': now
            }
        }));
        const hermanas = await this.propagarPassword(persona, passwordTemporal, { passwordTemporal: true });
        // Quien pidió el restablecimiento no puede entrar; quien tenga una sesión
        // abierta con la contraseña anterior, tampoco (D-26).
        await revocarSesionesDe([personaId, ...hermanas]);

        return {
            message: 'Contraseña reseteada exitosamente',
            passwordTemporal,
            personaId
        };
    }

    /**
     * Desvincular una persona de la empresa (soft delete).
     * Marca estado='desvinculado' y registra quién y cuándo desvinculó.
     * El ajuste del conteo de trabajadores del tenant lo realiza el handler.
     */
    async eliminar(tenantId, personaId, desvinculadoPor = null) {
        const now = new Date().toISOString();
        await this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `PERSONA#${personaId}`
            },
            UpdateExpression: 'SET #estado = :estado, desvinculacion = :desvinculacion,'
                + ' fechaTerminoVinculo = :fechaTerminoVinculo, updatedAt = :updatedAt',
            ExpressionAttributeNames: { '#estado': 'estado' },
            ExpressionAttributeValues: {
                ':estado': 'desvinculado',
                ':desvinculacion': {
                    fechaDesvinculacion: now,
                    desvinculadoPor: desvinculadoPor || null
                },
                // Desde acá se cuenta la conservación de su evidencia (ver el
                // comentario del campo en lib/models/Persona.js).
                ':fechaTerminoVinculo': now,
                ':updatedAt': now
            }
        }));
        return { message: 'Persona desvinculada de la empresa', personaId };
    }
}

module.exports = { PersonaService, passwordInicialDeRut };
