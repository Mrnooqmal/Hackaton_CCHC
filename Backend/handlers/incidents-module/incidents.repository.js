const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { HUELLA_SHA256, urlDeSubida } = require('../../lib/clients/s3');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { v4: uuidv4 } = require('uuid');
const { guardarTraza, conTraza, esTraza } = require('../../lib/traza-sensible');
const { hmacRut } = require('../../lib/cifradoCampo');
const { validateRut, normalizeRol } = require('../../lib/utils/validation');
const { construirMensaje } = require('../../lib/bandeja');
const { conNeutro, registrarFallo } = require('../../lib/degradacion');
const { obraDeLaEmpresa } = require('../../lib/auth/pertenencia');
const { personaPuede, PERMISSIONS } = require('../../lib/permissions');
const { TenantService } = require('../../lib/services/TenantService');

// Quién recibe el aviso de un reporte nuevo: quien puede clasificarlo, que es
// justo lo que el aviso le pide hacer, y además SIEMPRE el prevencionista
// (`ROL_AVISO_SIEMPRE`), tenga o no ese permiso. Con los roles por defecto son
// prevencionista, jefe de obra y admin; no supervisor ni trabajador.
const PERMISO_AVISO_REPORTE = PERMISSIONS.INCIDENTES_CALIFICAR_ACCIDENTE;

// El prevencionista es el responsable de prevención de la empresa: no puede
// quedar sin enterarse de un reporte porque alguien editó los permisos de su
// rol en Mi Empresa (decisión del usuario, 22-11-2026). Se compara contra el rol
// normalizado de la persona (`normalizeRol(persona.rol)`), el mismo dato con que
// `resolvePersonaPermisos` elige su rol. `lib/permissions.js` no expone una
// constante con este nombre: es el `tipo`/`id` protegido de `Tenant`, que no
// cambia aunque la empresa renombre el rol.
const ROL_AVISO_SIEMPRE = 'prevencionista';

// Cómo se nombra cada tipo en el aviso a prevención (todos masculinos: "un …").
const TIPO_EN_AVISO = {
    condicion_subestandar: 'hallazgo (condición subestándar)',
    accion_subestandar: 'hallazgo (acción subestándar)',
    incidente: 'incidente',
    accidente: 'accidente',
};

// Tope del campo "medidas inmediatas": un párrafo, no un informe. Lo que pase de
// ahí se corta, igual que `descripcionBreve` del reporte flash; el formulario no
// deja escribir más.
const MAX_MEDIDAS_INMEDIATAS = 1000;
const textoMedidasInmediatas = (valor) => (typeof valor === 'string' ? valor.trim().slice(0, MAX_MEDIDAS_INMEDIATAS) : '');

class IncidentsRepository {
    constructor() {
        // Inicialización simple como en incidents.js
        const dynamoClient = new DynamoDBClient({});
        this.dynamo = DynamoDBDocumentClient.from(dynamoClient);
        // Las subidas desde el navegador se prefirman con `urlDeSubida`: la huella
        // la calcula quien tiene el archivo (ver lib/clients/s3.js).
        this.s3 = new S3Client({});
        this.sns = new SNSClient({});

        this.incidentsTable = process.env.INCIDENTS_TABLE;
        // La evidencia de un incidente acredita cumplimiento (Arts. 71-72): vive en
        // el bucket con bloqueo de objetos, igual que los documentos firmados.
        this.incidentEvidenceBucket = process.env.EVIDENCIA_BUCKET;
        this.personasTable = process.env.PERSONAS_TABLE;
        this.inboxTable = process.env.INBOX_TABLE;

        console.log('IncidentsRepository initialized with table:', this.incidentsTable);
    }

    // Helper functions converted to methods
    getAccountIdFromContext(context) {
        if (process.env.AWS_ACCOUNT_ID) {
            return process.env.AWS_ACCOUNT_ID;
        }
        const arn = context?.invokedFunctionArn || process.env.AWS_LAMBDA_FUNCTION_ARN;
        if (arn) {
            const parts = arn.split(':');
            if (parts.length > 4) {
                return parts[4];
            }
        }
        return null;
    }

    buildNotificationTopicArn(context) {
        if (process.env.INCIDENT_NOTIFICATION_TOPIC_ARN) {
            return process.env.INCIDENT_NOTIFICATION_TOPIC_ARN;
        }
        const topicName = process.env.INCIDENT_NOTIFICATION_TOPIC;
        if (!topicName) {
            return null;
        }
        const region = process.env.AWS_REGION || 'us-east-1';
        const accountId = this.getAccountIdFromContext(context);
        if (!accountId) {
            return null;
        }
        return `arn:aws:sns:${region}:${accountId}:${topicName}`;
    }

    async buildEvidencePreviews(keys = []) {
        if (!Array.isArray(keys) || keys.length === 0) return [];

        const previews = await Promise.all(
            keys.map(async (key) => {
                if (!key) return null;
                try {
                    const command = new GetObjectCommand({
                        Bucket: this.incidentEvidenceBucket,
                        Key: key
                    });
                    const url = await getSignedUrl(this.s3, command, { expiresIn: 900 });
                    return { key, url };
                } catch (error) {
                    console.error('Error generando URL de evidencia:', key, error);
                    return { key };
                }
            })
        );
        return previews.filter(Boolean);
    }

    /**
     * A quiénes avisar de un reporte nuevo: las personas ACTIVAS de UNA empresa
     * (la partición `TENANT#{tenantId}` no ve a nadie de otra) que tienen el
     * permiso efectivo `PERMISO_AVISO_REPORTE` o cuyo rol es prevencionista
     * (`ROL_AVISO_SIEMPRE`). Cada persona aparece una sola vez aunque cumpla las
     * dos cosas: el filtro recorre personas, no las suma.
     *
     * Se busca por permiso para que una empresa que creó su rol "Encargado SST"
     * con permisos de prevención reciba el aviso. El prevencionista lo recibe
     * igual aunque su empresa le haya quitado el permiso: es el responsable de
     * prevención y no debe quedar sin aviso por una edición de permisos. Cuenta
     * como prevencionista quien tiene `persona.rol` normalizado a ese valor, el
     * mismo criterio con que `resolvePersonaPermisos` decide su rol: un rol
     * personalizado de otro id ("prevencionista_senior") no cuenta por nombre,
     * solo por permiso. Los permisos se resuelven igual que en el autorizador:
     * `TenantService.getById` → `toSafeFormat()` → `personaPuede`, con una sola
     * lectura del tenant por aviso.
     *
     * Si el tenant no se puede leer, se degrada a los roles por defecto
     * (`personaPuede` con tenant `null` usa los presets) en vez de a nadie: un
     * aviso que llega a los roles estándar es mejor que un reporte que nadie ve.
     * Queda constancia (`FALLO_DEPENDENCIA`, `incidente.aviso.roles`).
     *
     * Lanza si falla la lectura de personas: quien llama decide cómo degradar.
     */
    async destinatariosDelAviso(tenantId) {
        if (!tenantId) return [];
        const tenant = await conNeutro(
            'incidente.aviso.roles',
            () => new TenantService().getById(tenantId),
            null,
            { tenantId }
        );
        const tenantSafe = tenant ? tenant.toSafeFormat() : null;
        const items = [];
        let desde;
        do {
            const result = await this.dynamo.send(new QueryCommand({
                TableName: this.personasTable,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                FilterExpression: 'estado = :estado',
                ExpressionAttributeValues: {
                    ':pk': `TENANT#${tenantId}`,
                    ':prefix': 'PERSONA#',
                    ':estado': 'activo'
                },
                ...(desde ? { ExclusiveStartKey: desde } : {})
            }));
            items.push(...(result.Items || []));
            desde = result.LastEvaluatedKey;
        } while (desde);
        return items
            .filter((item) => item.personaId && (
                normalizeRol(item.rol) === ROL_AVISO_SIEMPRE
                || personaPuede(item, tenantSafe, PERMISO_AVISO_REPORTE)
            ))
            .map((item) => ({ userId: item.personaId, personaId: item.personaId }));
    }

    /**
     * Avisa a prevención de riesgos que hay un reporte nuevo: bandeja y SNS.
     *
     * Antes leía `incident.trabajador.nombre`, que el incidente guardado no tiene
     * (el nombre va en `trabajadorNombre` y el resto en la traza): lanzaba
     * TypeError, el `catch` se lo tragaba y nadie recibía nada. Además mandaba el
     * relato y el nombre del afectado a la bandeja y a SNS, que no están detrás
     * del permiso de historial. Ahora el aviso lleva lo justo para abrir el caso
     * (ver `resumenDelAviso`), no avisa a quien reportó, y cada fallo deja
     * constancia medible (`FALLO_DEPENDENCIA`) sin botar la creación.
     *
     * Nunca lanza.
     */
    async avisarPrevencion(incident, context) {
        try {
            const resumen = await this.resumenDelAviso(incident);

            const topicArn = this.buildNotificationTopicArn(context);
            if (topicArn) {
                await conNeutro('incidente.aviso.sns', () => this.sns.send(new PublishCommand({
                    TopicArn: topicArn,
                    // SNS exige un asunto ASCII: va el tipo como identificador.
                    Subject: `Nuevo reporte: ${incident.tipo}`,
                    Message: JSON.stringify(resumen.sns, null, 2)
                })), null, { incidentId: incident.incidentId });
            }

            const destinatarios = (await conNeutro(
                'incidente.aviso.destinatarios',
                () => this.destinatariosDelAviso(incident.tenantId),
                [],
                { incidentId: incident.incidentId }
            )).filter((p) => p.personaId !== incident.reportadoPor);
            if (destinatarios.length === 0) {
                console.log('[AVISO] incidente', incident.incidentId, '| sin destinatarios a quienes avisar');
                return;
            }

            const now = new Date().toISOString();
            const baseMessageId = uuidv4();
            let enviados = 0;
            for (const { personaId } of destinatarios) {
                const ok = await conNeutro('incidente.aviso.bandeja', async () => {
                    await this.dynamo.send(new PutCommand({
                        TableName: this.inboxTable,
                        Item: construirMensaje({
                            recipientId: personaId,
                            baseMessageId,
                            now,
                            senderId: 'sistema',
                            senderName: 'Sistema de Incidentes',
                            senderRol: 'system',
                            type: 'alert',
                            priority: resumen.prioridad,
                            subject: resumen.asunto,
                            content: resumen.contenido,
                            linkedEntity: { type: 'incident', id: incident.incidentId },
                        }),
                    }));
                    return true;
                }, false, { incidentId: incident.incidentId, destinatario: personaId });
                if (ok) enviados++;
            }
            console.log('[AVISO] incidente', incident.incidentId, '| avisos', enviados, 'de', destinatarios.length);
        } catch (err) {
            registrarFallo('incidente.aviso', err, { incidentId: incident?.incidentId });
        }
    }

    /**
     * Qué dice el aviso. Solo tipo, obra, fecha, gravedad (si es incidente) y el
     * enlace al caso: ni el relato ni quién es el afectado. Quien lo necesite lo
     * lee al abrir el caso, donde sí se mira el permiso de historial.
     */
    async resumenDelAviso(incident) {
        const tipoTexto = TIPO_EN_AVISO[incident.tipo] || 'reporte';
        const esIncidente = incident.clasificacion !== 'hallazgo';
        const obra = incident.obraId
            ? await obraDeLaEmpresa(incident.obraId, { tenantId: incident.tenantId })
            : null;
        const lugar = obra?.nombre || incident.centroTrabajo || 'obra sin especificar';
        const [a, m, d] = String(incident.fecha || '').split('-');
        const fecha = a && m && d ? `${d}-${m}-${a}` : String(incident.fecha || '');
        const hora = incident.hora ? String(incident.hora).slice(0, 5) : '';
        const gravedad = esIncidente ? (incident.gravedad || 'leve') : null;

        const asunto = `Nuevo ${tipoTexto} reportado${gravedad ? ` (${gravedad})` : ''}`;
        const contenido = `Se reportó un ${tipoTexto} en ${lugar} el ${fecha}${hora ? ` a las ${hora}` : ''}.`
            + (gravedad ? ` Gravedad: ${gravedad}.` : '')
            + ' Abre el caso desde este aviso para revisarlo.';
        let prioridad = 'normal';
        if (gravedad === 'fatal') prioridad = 'urgent';
        else if (gravedad === 'grave') prioridad = 'high';

        return {
            asunto,
            contenido,
            prioridad,
            sns: {
                incidentId: incident.incidentId,
                clasificacion: incident.clasificacion || null,
                tipo: incident.tipo,
                tenantId: incident.tenantId,
                obraId: incident.obraId || null,
                obra: lugar,
                fecha: incident.fecha,
                hora: incident.hora || null,
                ...(gravedad ? { gravedad } : {}),
                enlace: `/incidents/${incident.incidentId}`,
            },
        };
    }

    // CREATE
    async create(data, context) {
        const incidentId = uuidv4();
        // Solo identificadores. Esto registraba el incidente completo con
        // `JSON.stringify(data)`: el RUT, el nombre y el género del trabajador, y
        // el relato del accidente, en claro en CloudWatch — por fuera del cifrado
        // que protege esos mismos datos en la tabla.
        console.log('[CREATE] incidente', incidentId, '| empresa', data?.tenantId || data?.empresaId || '-', '| tipo', data?.tipo || '-');
        const now = new Date().toISOString();

        // Validation: tipo siempre requerido; descripcion requerida; resto opcional.
        if (!data.tipo) {
            console.error('[CREATE] Validation failed - missing tipo');
            throw new Error('El tipo de reporte es requerido');
        }

        if (!data.descripcion || data.descripcion.trim() === '') {
            console.error('[CREATE] Validation failed - empty description');
            throw new Error('La descripción es requerida');
        }

        const incident = {
            incidentId,
            tipo: data.tipo,
            // Taxonomia reunion 2026-06-10: 'hallazgo' (abierto a todos, con
            // gobernanza) | 'incidente' (creacion restringida a supervisor+).
            clasificacion: data.clasificacion
                || (['condicion_subestandar', 'accion_subestandar'].includes(data.tipo) ? 'hallazgo' : 'incidente'),
            gobernanza: data.gobernanza || null,
            // `reporteFlash` lleva `afectados[]` con nombre y RUT: va aparte.
            centroTrabajo: data.centroTrabajo || '',
            // El nombre queda en el elemento listado porque la tabla en pantalla
            // lo muestra; el RUT, el género y el cargo se guardan aparte (ver
            // `lib/traza-sensible.js`) para que ningún índice los contenga.
            trabajadorNombre: data.trabajador?.nombre || '',
            // Con qué persona se vincula el incidente, sin guardar su RUT: el mismo
            // HMAC que busca a la persona en su ficha (`rutHmac`, D-10). Sin esto, la
            // retención y la supresión a solicitud (lib/gobernanza) no podían
            // encontrar los incidentes de alguien sin descifrarlos todos.
            afectadoRutHmac: validateRut(data.trabajador?.rut || '').valid ? await hmacRut(data.trabajador.rut) : null,
            fecha: data.fecha || now.split('T')[0],
            hora: data.hora || now.split('T')[1].split('.')[0],
            descripcion: data.descripcion,
            // Qué se hizo en el momento para contener el riesgo (fase 1 del
            // rediseño). Es texto libre sobre la obra, no sobre personas: va en el
            // elemento listado y no en la traza, como `descripcion`.
            medidasInmediatas: textoMedidasInmediatas(data.medidasInmediatas),
            gravedad: data.gravedad || 'leve',
            diasPerdidos: data.diasPerdidos || 0,
            evidencias: data.evidencias || [],
            documentos: data.documentos || {},
            investigaciones: {
                prevencionista: null,
                jefeDirecto: null,
                comiteParitario: null
            },
            estado: 'reportado', // reportado | en_investigacion | cerrado

            // Etapa constructiva (filtro/estadística "Por etapa constructiva")
            etapaConstructiva: data.etapaConstructiva || '',
            // Ubicación GPS capturada al reportar
            ubicacion: data.ubicacion || null,

            // Cabecera del informe — quién genera el reporte (lo muestra el frontend)
            // Solo quién es, nunca su RUT: el navegador lo mandaba y quedaba en
            // claro en la tabla, por fuera del cifrado de campo (D-10).
            realizadoPor: {
                personaId: data.realizadoPor?.personaId || null,
                nombre: data.realizadoPor?.nombre || '',
                cargo: data.realizadoPor?.cargo || '',
            },

            // Medidas correctivas (Art. 71) — read-model de la Fase ACT en ObraDetalle.
            // [{ numero, causaRaiz, medida, responsableId, responsableNombre, fechaMaxEjecucion, estado:'pendiente'|'en_proceso'|'completada'|'verificada' }]
            medidasCorrectivas: data.medidasCorrectivas || [],

            reportadoPor: data.reportadoPor || 'sistema',
            // El frontend envía tenantId; empresaId se acepta como alias legacy.
            tenantId: data.tenantId || data.empresaId || 'default',
            obraId: data.obraId || null,
            viewedBy: [],
            createdAt: now,
            updatedAt: now
        };

        await guardarTraza(this.incidentsTable, 'incidentId', incident.incidentId, {
            trabajador: {
                nombre: data.trabajador?.nombre || '',
                rut: data.trabajador?.rut || '',
                genero: data.trabajador?.genero || '',
                cargo: data.trabajador?.cargo || '',
            },
            reporteFlash: data.reporteFlash || null,
        });

        await this.dynamo.send(new PutCommand({
            TableName: this.incidentsTable,
            Item: incident
        }));

        // Nunca lanza: el reporte ya está guardado y un aviso caído no lo deshace.
        await this.avisarPrevencion(incident, context);

        return {
            incident,
            message: 'Incidente creado exitosamente'
        };
    }

    // LIST
    async list({ tenantId, obraId, tipo, estado, fechaInicio, fechaFin }) {
        console.log('Repo.list called');
        let items = [];

        if (tenantId) {
            // Query por GSI tenantId-fecha-index
            const result = await this.dynamo.send(new QueryCommand({
                TableName: this.incidentsTable,
                IndexName: 'tenantId-fecha-index',
                KeyConditionExpression: 'tenantId = :tenantId',
                ExpressionAttributeValues: { ':tenantId': tenantId }
            }));
            items = result.Items || [];
        } else {
            const result = await this.dynamo.send(new ScanCommand({
                TableName: this.incidentsTable
            }));
            // Un `Scan` recorre la tabla entera y ve también los elementos con la
            // parte sensible, que no son incidentes.
            items = (result.Items || []).filter((i) => !esTraza(i, 'incidentId'));
        }

        if (obraId) items = items.filter(item => item.obraId === obraId);
        if (tipo) items = items.filter(item => item.tipo === tipo);
        if (estado) items = items.filter(item => item.estado === estado);
        if (fechaInicio) items = items.filter(item => item.fecha >= fechaInicio);
        if (fechaFin) items = items.filter(item => item.fecha <= fechaFin);

        items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        return { items, total: items.length };
    }

    // ─── DS44 Art. 71 — Read-model de medidas correctivas por obra ──────────────
    // Aplana las medidas de TODAS las investigaciones de incidentes de la obra,
    // cada una con su origen (incidentId), causa raiz, responsable, plazo y estado.
    // Insumo directo de la Fase ACT (seguimiento) y de CHECK (consolidado).
    async getMedidasByObra(tenantId, obraId, estadoFilter) {
        const { items } = await this.list({ tenantId });
        const incidentes = items.filter((i) => !obraId || i.obraId === obraId);
        const hoy = new Date().toISOString().slice(0, 10);

        const medidas = [];
        for (const inc of incidentes) {
            for (const m of (inc.medidasCorrectivas || [])) {
                const estado = m.estado || 'pendiente';
                const cerrada = estado === 'completada' || estado === 'verificada';
                const fechaMax = m.fechaMaxEjecucion ? String(m.fechaMaxEjecucion).slice(0, 10) : null;
                const vencida = !cerrada && !!fechaMax && fechaMax < hoy;
                medidas.push({
                    incidentId: inc.incidentId,
                    incidenteDescripcion: inc.descripcion || '',
                    gravedad: inc.gravedad || 'leve',
                    numero: m.numero,
                    causaRaiz: m.causaRaiz || '',
                    medida: m.medida || '',
                    responsableId: m.responsableId || null,
                    responsableNombre: m.responsableNombre || '',
                    fechaMaxEjecucion: m.fechaMaxEjecucion || null,
                    estado,
                    vencida
                });
            }
        }

        const filtered = estadoFilter
            ? medidas.filter((m) => estadoFilter === 'vencida' ? m.vencida : m.estado === estadoFilter)
            : medidas;

        const resumen = {
            total: medidas.length,
            pendientes: medidas.filter((m) => m.estado === 'pendiente').length,
            enProceso: medidas.filter((m) => m.estado === 'en_proceso').length,
            completadas: medidas.filter((m) => m.estado === 'completada').length,
            verificadas: medidas.filter((m) => m.estado === 'verificada').length,
            vencidas: medidas.filter((m) => m.vencida).length
        };

        return { medidas: filtered, resumen };
    }

    // ─── Gobernanza de hallazgos (reunion 2026-06-10) ────────────────────────────
    // Actualiza responsable, plazo y estado de cierre SIN tocar el resto del registro.
    /**
     * @param {object} data lo que el cliente puede cambiar.
     * @param {{verificadoPor?: string|null}} servidor lo que decide el handler a
     *   partir de la sesión: quién verificó el cierre. Nunca sale de `data`.
     */
    async updateGobernanza(incidentId, data, { verificadoPor = null } = {}) {
        const res = await this.dynamo.send(new GetCommand({
            TableName: this.incidentsTable,
            Key: { incidentId }
        }));
        if (!res.Item) throw new Error('Incidente no encontrado');
        if (res.Item.clasificacion !== 'hallazgo') {
            throw new Error('La gobernanza solo aplica a hallazgos');
        }

        const camposPermitidos = ['responsableId', 'responsableNombre', 'plazoRespuestaISO', 'estadoCierre', 'comentarioCierre'];
        const estadosValidos = ['abierto', 'en_proceso', 'cerrado'];
        if (data.estadoCierre && !estadosValidos.includes(data.estadoCierre)) {
            throw new Error(`Estado de cierre invalido. Validos: ${estadosValidos.join(', ')}`);
        }
        if (data.estadoCierre === 'cerrado' && !data.comentarioCierre && !res.Item.gobernanza?.comentarioCierre) {
            throw new Error('El comentario de cierre es requerido para cerrar un hallazgo');
        }

        const gobernanza = { ...(res.Item.gobernanza || {}) };
        camposPermitidos.forEach((campo) => {
            if (data[campo] !== undefined) gobernanza[campo] = data[campo];
        });
        if (data.estadoCierre === 'cerrado') {
            gobernanza.verificadoPor = verificadoPor;
            if (!gobernanza.fechaVerificacion) gobernanza.fechaVerificacion = new Date().toISOString();
        }

        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.incidentsTable,
            Key: { incidentId },
            UpdateExpression: 'SET gobernanza = :g, updatedAt = :u',
            ExpressionAttributeValues: { ':g': gobernanza, ':u': new Date().toISOString() },
            ReturnValues: 'ALL_NEW'
        }));
        return { incident: result.Attributes, gobernanza };
    }

    // ─── Completar reporte flash (reunion 2026-06-10) ───────────────────────────
    // Permite corregir/completar los datos una vez disponible la informacion real.
    // esFlash y segunInformacionDisponible son INMUTABLES (trazabilidad legal).
    async completarFlash(incidentId, data) {
        const res = await this.dynamo.send(new GetCommand({
            TableName: this.incidentsTable,
            Key: { incidentId }
        }));
        if (!res.Item) throw new Error('Incidente no encontrado');
        if (!res.Item.reporteFlash?.esFlash) {
            throw new Error('El incidente no fue creado como reporte flash');
        }

        const now = new Date().toISOString();
        const reporteFlash = {
            ...res.Item.reporteFlash,
            afectados: data.afectados !== undefined ? data.afectados : res.Item.reporteFlash.afectados,
            descripcionBreve: data.descripcionBreve !== undefined ? String(data.descripcionBreve).slice(0, 500) : res.Item.reporteFlash.descripcionBreve,
            severidad: data.gravedad || res.Item.reporteFlash.severidad,
            ubicacionReferencia: data.ubicacionReferencia !== undefined ? data.ubicacionReferencia : res.Item.reporteFlash.ubicacionReferencia,
            esFlash: true,
            segunInformacionDisponible: true,
            editadoEn: now
        };

        // Campos del incidente que se completan con la investigacion.
        let updateExpression = 'SET reporteFlash = :rf, updatedAt = :u';
        const values = { ':rf': reporteFlash, ':u': now };
        if (data.descripcion) { updateExpression += ', descripcion = :d'; values[':d'] = data.descripcion; }
        if (data.gravedad) { updateExpression += ', gravedad = :gr'; values[':gr'] = data.gravedad; }
        if (data.trabajador) { updateExpression += ', trabajador = :t'; values[':t'] = data.trabajador; }
        if (data.diasPerdidos !== undefined) { updateExpression += ', diasPerdidos = :dp'; values[':dp'] = data.diasPerdidos; }

        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.incidentsTable,
            Key: { incidentId },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: values,
            ReturnValues: 'ALL_NEW'
        }));
        return { incident: result.Attributes };
    }

    // ─── DS44 Art. 71 — Seguimiento del estado de una medida correctiva ─────────
    async updateMedidaEstado(incidentId, numero, estado) {
        const estadosValidos = ['pendiente', 'en_proceso', 'completada', 'verificada'];
        if (!estadosValidos.includes(estado)) {
            throw new Error(`Estado inválido. Válidos: ${estadosValidos.join(', ')}`);
        }
        const res = await this.dynamo.send(new GetCommand({
            TableName: this.incidentsTable,
            Key: { incidentId }
        }));
        if (!res.Item) throw new Error('Incidente no encontrado');

        const now = new Date().toISOString();
        const medidas = (res.Item.medidasCorrectivas || []).map((m) =>
            String(m.numero) === String(numero)
                ? { ...m, estado, fechaActualizacionEstado: now }
                : m
        );
        const todasVerificadas = medidas.length > 0 && medidas.every((m) => m.estado === 'verificada');

        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.incidentsTable,
            Key: { incidentId },
            UpdateExpression: 'SET medidasCorrectivas = :m, medidasVerificadas = :mv, updatedAt = :u',
            ExpressionAttributeValues: { ':m': medidas, ':mv': todasVerificadas, ':u': now },
            ReturnValues: 'ALL_NEW'
        }));

        return { incident: result.Attributes, medidas };
    }

    // GET
    /**
     * Devuelve el incidente CRUDO, sin previsualizaciones de evidencia.
     *
     * Existe para comprobar a qué empresa pertenece antes de responder cualquier
     * cosa sobre él: `get()` además arma URLs firmadas de la evidencia, y hacer
     * ese trabajo (y pagar esas llamadas a S3) para un incidente que no es de
     * quien pregunta sería exactamente al revés.
     */
    async getItem(incidentId) {
        const result = await this.dynamo.send(new GetCommand({
            TableName: this.incidentsTable,
            Key: { incidentId }
        }));
        if (!result.Item) return null;
        return conTraza(this.incidentsTable, 'incidentId', result.Item);
    }

    async get(id) {
        console.log('[GET] Repo.get called for ID:', id);
        const result = await this.dynamo.send(new GetCommand({
            TableName: this.incidentsTable,
            Key: { incidentId: id }
        }));

        if (!result.Item) {
            console.error('[GET] Incident not found:', id);
            throw new Error('Incidente no encontrado');
        }

        const incident = await conTraza(this.incidentsTable, 'incidentId', result.Item);
        console.log('[GET] Building evidence previews for', (incident.evidencias || []).length, 'items');
        const evidencePreviews = await this.buildEvidencePreviews(incident.evidencias || []);
        console.log('[GET] Evidence previews built:', evidencePreviews.length);

        return {
            ...incident,
            evidencePreviews
        };
    }

    // UPDATE
    async update(id, data) {
        // Qué campos cambian, nunca sus valores (ver la nota de `create`).
        console.log('[UPDATE] incidente', id, '| campos:', Object.keys(data || {}).join(',') || '-');
        const now = new Date().toISOString();
        let updateExpression = 'SET updatedAt = :updatedAt';
        const expressionAttributeValues = { ':updatedAt': now };

        if (data.tipo) {
            updateExpression += ', tipo = :tipo';
            expressionAttributeValues[':tipo'] = data.tipo;
        }
        if (data.clasificacion) {
            updateExpression += ', clasificacion = :clasificacion';
            expressionAttributeValues[':clasificacion'] = data.clasificacion;
        }
        if (data.estado) {
            updateExpression += ', estado = :estado';
            expressionAttributeValues[':estado'] = data.estado;
        }
        if (data.investigacionPrevencionista) {
            updateExpression += ', investigaciones.prevencionista = :invPrev';
            expressionAttributeValues[':invPrev'] = { ...data.investigacionPrevencionista, fecha: now };
        }
        if (data.investigacionJefeDirecto) {
            updateExpression += ', investigaciones.jefeDirecto = :invJefe';
            expressionAttributeValues[':invJefe'] = { ...data.investigacionJefeDirecto, fecha: now };
        }
        if (data.investigacionComiteParitario) {
            updateExpression += ', investigaciones.comiteParitario = :invComite';
            expressionAttributeValues[':invComite'] = { ...data.investigacionComiteParitario, fecha: now };
        }
        if (data.diasPerdidos !== undefined) {
            updateExpression += ', diasPerdidos = :diasPerdidos';
            expressionAttributeValues[':diasPerdidos'] = data.diasPerdidos;
        }
        if (data.documentos) {
            updateExpression += ', documentos = :documentos';
            expressionAttributeValues[':documentos'] = data.documentos;
        }
        if (data.evidencias) {
            updateExpression += ', evidencias = :evidencias';
            expressionAttributeValues[':evidencias'] = data.evidencias;
        }
        if (data.medidasInmediatas !== undefined) {
            updateExpression += ', medidasInmediatas = :medidasInmediatas';
            expressionAttributeValues[':medidasInmediatas'] = textoMedidasInmediatas(data.medidasInmediatas);
        }
        if (data.fechaCierre !== undefined) {
            updateExpression += ', fechaCierre = :fechaCierre';
            expressionAttributeValues[':fechaCierre'] = data.fechaCierre;
        }
        if (data.informeDocumentId !== undefined) {
            updateExpression += ', informeDocumentId = :informeDocumentId';
            expressionAttributeValues[':informeDocumentId'] = data.informeDocumentId;
        }

        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.incidentsTable,
            Key: { incidentId: id },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        }));

        return {
            incident: result.Attributes,
            message: 'Incidente actualizado exitosamente'
        };
    }

    /**
     * Agrega claves de evidencia ya validadas por el handler (empresa, incidente,
     * forma y tope). Agrega, nunca reemplaza: `update` con `evidencias` pisa la
     * lista entera, y quien reporta no debe poder borrar lo que adjuntó otro.
     *
     * Se escribe la lista completa con la condición de que el incidente no haya
     * cambiado desde que el handler lo leyó: así el tope de cantidad que contó
     * sigue siendo cierto al guardar, aunque lleguen dos envíos a la vez.
     */
    async agregarEvidencias(incidentId, nuevas, updatedAtLeido) {
        console.log('[EVIDENCIAS] incidente', incidentId, '| agregadas', nuevas.length);
        const res = await this.dynamo.send(new GetCommand({
            TableName: this.incidentsTable,
            Key: { incidentId }
        }));
        if (!res.Item) throw new Error('Incidente no encontrado');
        const previas = Array.isArray(res.Item.evidencias) ? res.Item.evidencias : [];
        if (nuevas.length === 0) return { evidencias: previas };
        const evidencias = [...previas, ...nuevas.filter((k) => !previas.includes(k))];
        try {
            const result = await this.dynamo.send(new UpdateCommand({
                TableName: this.incidentsTable,
                Key: { incidentId },
                UpdateExpression: 'SET evidencias = :e, updatedAt = :u',
                ConditionExpression: 'updatedAt = :leido',
                ExpressionAttributeValues: { ':e': evidencias, ':u': new Date().toISOString(), ':leido': updatedAtLeido },
                ReturnValues: 'ALL_NEW'
            }));
            return { evidencias: result.Attributes?.evidencias || evidencias };
        } catch (err) {
            if (err?.name === 'ConditionalCheckFailedException') {
                const conflicto = new Error('El reporte cambió mientras se adjuntaban las fotos. Intenta de nuevo.');
                conflicto.statusCode = 409;
                throw conflicto;
            }
            throw err;
        }
    }

    // UPLOAD EVIDENCE
    async uploadEvidence({ fileName, fileType, incidentId, tenantId, checksumSha256 }) {
        // Sin el nombre del archivo: suele traer el de la persona.
        console.log('[UPLOAD_EVIDENCE] incidente', incidentId, '| tipo', fileType);
        if (!fileName || !fileType) {
            throw new Error('fileName y fileType son requeridos');
        }
        // El bucket de evidencia tiene Object Lock: sin huella, S3 rechaza la subida.
        if (!HUELLA_SHA256.test(String(checksumSha256 || ''))) {
            throw new Error('Falta la huella SHA-256 del archivo. Recarga la página e intenta de nuevo.');
        }
        if (!tenantId) throw new Error('tenantId es requerido');

        // La clave cuelga de la empresa, como todo lo demás: `tenants/{empresa}/
        // incidentes/…`. Antes empezaba por el incidentId, así que quedaba fuera
        // del modelo de pertenencia —que se apoya en ese prefijo— y ningún
        // control podía decir de quién era el archivo.
        const fileExtension = fileName.split('.').pop();
        const s3Key = `tenants/${tenantId}/incidentes/${incidentId || 'sin-incidente'}/${uuidv4()}.${fileExtension}`;

        const command = new PutObjectCommand({
            Bucket: this.incidentEvidenceBucket,
            Key: s3Key,
            ContentType: fileType,
            ChecksumSHA256: checksumSha256,
        });
        const uploadUrl = await urlDeSubida(command, 3600);

        return {
            uploadUrl,
            s3Key,
            fileUrl: `https://${this.incidentEvidenceBucket}.s3.amazonaws.com/${s3Key}`
        };
    }

    // GET STATS
    async getStats({ tenantId, obraId, mes, masaLaboral }) {
        mes = mes || new Date().toISOString().slice(0, 7);
        masaLaboral = parseInt(masaLaboral) || 100;

        let items = [];
        if (tenantId) {
            const result = await this.dynamo.send(new QueryCommand({
                TableName: this.incidentsTable,
                IndexName: 'tenantId-fecha-index',
                KeyConditionExpression: 'tenantId = :tenantId',
                ExpressionAttributeValues: { ':tenantId': tenantId }
            }));
            items = result.Items || [];
        } else {
            const result = await this.dynamo.send(new ScanCommand({
                TableName: this.incidentsTable
            }));
            // Un `Scan` recorre la tabla entera y ve también los elementos con la
            // parte sensible, que no son incidentes.
            items = (result.Items || []).filter((i) => !esTraza(i, 'incidentId'));
        }
        if (obraId) items = items.filter(item => item.obraId === obraId);
        items = items.filter(item => item.fecha && item.fecha.startsWith(mes));

        const accidentes = items.filter(i => i.tipo === 'accidente');
        const numAccidentes = accidentes.length;
        const diasPerdidos = accidentes.reduce((sum, acc) => sum + (acc.diasPerdidos || 0), 0);
        const tasaAccidentabilidad = masaLaboral > 0 ? (numAccidentes / masaLaboral) * 100 : 0;
        const siniestralidad = masaLaboral > 0 ? (diasPerdidos / masaLaboral) * 100 : 0;
        const horasTrabajadas = masaLaboral * 8 * 22;
        const tasaFrecuencia = horasTrabajadas > 0 ? (numAccidentes / horasTrabajadas) * 1000000 : 0;

        const porTipo = {
            accidentes: items.filter(i => i.tipo === 'accidente').length,
            incidentes: items.filter(i => i.tipo === 'incidente').length,
            condicionesSubestandar: items.filter(i => i.tipo === 'condicion_subestandar').length
        };
        const porGravedad = {
            leve: accidentes.filter(a => a.gravedad === 'leve').length,
            grave: accidentes.filter(a => a.gravedad === 'grave').length,
            fatal: accidentes.filter(a => a.gravedad === 'fatal').length
        };

        return {
            mes,
            masaLaboral,
            numeroAccidentes: numAccidentes,
            diasPerdidos,
            tasaAccidentabilidad: parseFloat(tasaAccidentabilidad.toFixed(2)),
            siniestralidad: parseFloat(siniestralidad.toFixed(2)),
            tasaFrecuencia: parseFloat(tasaFrecuencia.toFixed(2)),
            porTipo,
            porGravedad,
            totalIncidentes: items.length
        };
    }

    // ADD INVESTIGATION
    async addInvestigation(id, data) {
        if (!id) throw new Error('ID de incidente requerido');
        const now = new Date().toISOString();

        if (!data.tipo || !data.hallazgos || !data.recomendaciones || !data.medidas) {
            throw new Error('Campos requeridos: tipo, hallazgos, recomendaciones, medidas');
        }
        const tiposValidos = ['prevencionista', 'jefe_directo', 'comite_paritario'];
        if (!tiposValidos.includes(data.tipo)) {
            throw new Error(`Tipo de investigación inválido. Valores válidos: ${tiposValidos.join(', ')}`);
        }
        const campoInvestigacion = {
            'prevencionista': 'prevencionista',
            'jefe_directo': 'jefeDirecto',
            'comite_paritario': 'comiteParitario'
        }[data.tipo];

        const investigation = {
            investigador: data.investigador || 'sistema',
            rolInvestigador: data.tipo,
            fecha: now,
            hallazgos: data.hallazgos,
            recomendaciones: data.recomendaciones,
            medidas: data.medidas,
            estado: 'completada'
        };

        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.incidentsTable,
            Key: { incidentId: id },
            UpdateExpression: `SET investigaciones.${campoInvestigacion} = :investigation, estado = :estado, updatedAt = :updatedAt`,
            ExpressionAttributeValues: {
                ':investigation': investigation,
                ':estado': 'en_investigacion',
                ':updatedAt': now
            },
            ReturnValues: 'ALL_NEW'
        }));

        return {
            incident: result.Attributes,
            message: 'Investigación agregada exitosamente',
            investigation
        };
    }

    // UPLOAD DOCUMENT
    async uploadDocument(id, data) {
        if (!id) throw new Error('ID de incidente requerido');
        const { fileName, fileType, documentType, tenantId, checksumSha256 } = data;
        if (!fileName || !fileType || !documentType) {
            throw new Error('fileName, fileType y documentType son requeridos');
        }
        if (!HUELLA_SHA256.test(String(checksumSha256 || ''))) {
            throw new Error('Falta la huella SHA-256 del archivo. Recarga la página e intenta de nuevo.');
        }
        if (!tenantId) throw new Error('tenantId es requerido');
        const tiposValidos = ['diat', 'diep'];
        if (!tiposValidos.includes(documentType)) {
            throw new Error(`Tipo de documento inválido. Valores válidos: ${tiposValidos.join(', ')}`);
        }

        const fileExtension = fileName.split('.').pop();
        const s3Key = `tenants/${data.tenantId}/incidentes/${id}/${documentType}-${uuidv4()}.${fileExtension}`;
        const command = new PutObjectCommand({
            Bucket: this.incidentEvidenceBucket,
            Key: s3Key,
            ContentType: fileType,
            ChecksumSHA256: checksumSha256,
        });
        const uploadUrl = await urlDeSubida(command, 3600);
        const now = new Date().toISOString();

        await this.dynamo.send(new UpdateCommand({
            TableName: this.incidentsTable,
            Key: { incidentId: id },
            UpdateExpression: `SET documentos.${documentType} = :docInfo, updatedAt = :updatedAt`,
            ExpressionAttributeValues: {
                ':docInfo': { s3Key, fileName, fileType, uploadedAt: now },
                ':updatedAt': now
            }
        }));

        return { uploadUrl, s3Key, documentType };
    }

    // GET DOCUMENTS
    async getDocuments(id) {
        if (!id) throw new Error('ID de incidente requerido');
        const result = await this.dynamo.send(new GetCommand({
            TableName: this.incidentsTable,
            Key: { incidentId: id }
        }));
        if (!result.Item) throw new Error('Incidente no encontrado');

        const documents = [];
        const incident = result.Item;
        if (incident.documentos) {
            for (const [docType, docInfo] of Object.entries(incident.documentos)) {
                if (docInfo && docInfo.s3Key) {
                    documents.push({
                        documentType: docType,
                        ...docInfo,
                        url: `https://${this.incidentEvidenceBucket}.s3.amazonaws.com/${docInfo.s3Key}`
                    });
                }
            }
        }
        return { documents };
    }

    // GET ANALYTICS
    async getAnalytics({ tenantId, obraId, fechaInicio, fechaFin }) {
        fechaFin = fechaFin || new Date().toISOString().split('T')[0];
        let items = [];

        if (tenantId) {
            const result = await this.dynamo.send(new QueryCommand({
                TableName: this.incidentsTable,
                IndexName: 'tenantId-fecha-index',
                KeyConditionExpression: 'tenantId = :tenantId',
                ExpressionAttributeValues: { ':tenantId': tenantId }
            }));
            items = result.Items || [];
        } else {
            const result = await this.dynamo.send(new ScanCommand({
                TableName: this.incidentsTable
            }));
            // Un `Scan` recorre la tabla entera y ve también los elementos con la
            // parte sensible, que no son incidentes.
            items = (result.Items || []).filter((i) => !esTraza(i, 'incidentId'));
        }

        if (obraId) items = items.filter(item => item.obraId === obraId);
        if (fechaInicio) items = items.filter(item => item.fecha >= fechaInicio);
        if (fechaFin) items = items.filter(item => item.fecha <= fechaFin);

        const distribucionPorTipo = {
            accidentes: items.filter(i => i.tipo === 'accidente').length,
            incidentes: items.filter(i => i.tipo === 'incidente').length,
            condicionesSubestandar: items.filter(i => i.tipo === 'condicion_subestandar').length
        };
        const accidentes = items.filter(i => i.tipo === 'accidente');
        const distribucionPorGravedad = {
            leve: accidentes.filter(a => a.gravedad === 'leve').length,
            grave: accidentes.filter(a => a.gravedad === 'grave').length,
            fatal: accidentes.filter(a => a.gravedad === 'fatal').length
        };

        const tendencias = [];
        const ahora = new Date();
        for (let i = 5; i >= 0; i--) {
            const mes = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
            const mesStr = mes.toISOString().slice(0, 7);
            const itemsMes = items.filter(item => item.fecha && item.fecha.startsWith(mesStr));
            tendencias.push({
                mes: mesStr,
                total: itemsMes.length,
                accidentes: itemsMes.filter(j => j.tipo === 'accidente').length,
                incidentes: itemsMes.filter(j => j.tipo === 'incidente').length
            });
        }

        const centrosMap = {};
        items.forEach(item => {
            const centro = item.centroTrabajo || 'Sin especificar';
            if (!centrosMap[centro]) centrosMap[centro] = { total: 0 };
            centrosMap[centro].total++;
        });

        const porCentroTrabajo = Object.entries(centrosMap).map(([centro, data]) => ({
            centro,
            total: data.total,
            tasa: items.length > 0 ? ((data.total / items.length) * 100).toFixed(2) : 0
        }));

        return {
            periodo: `${fechaInicio || 'inicio'} - ${fechaFin}`,
            distribucionPorTipo,
            distribucionPorGravedad,
            tendencias,
            porCentroTrabajo,
            totalIncidentes: items.length
        };
    }

    // QUICK REPORT
    async quickReport(data) {
        const incidentId = uuidv4();
        const now = new Date().toISOString();
        if (!data.tipo || !data.centroTrabajo || !data.descripcion) {
            throw new Error('Campos requeridos: tipo, centroTrabajo, descripcion');
        }

        const incident = {
            incidentId,
            tipo: data.tipo,
            clasificacion: data.clasificacion || 'hallazgo',
            tipoHallazgo: data.tipoHallazgo || 'condicion',
            etapaConstructiva: data.etapaConstructiva || '',
            centroTrabajo: data.centroTrabajo,
            trabajador: {
                nombre: data.reportadoPor || 'Reporte Anónimo',
                rut: '',
                genero: '',
                cargo: ''
            },
            fecha: now.split('T')[0],
            hora: now.split('T')[1].split('.')[0],
            descripcion: data.descripcion,
            gravedad: data.gravedad || 'leve',
            diasPerdidos: 0,
            evidencias: data.evidencias || [],
            documentos: {},
            investigaciones: {
                prevencionista: null,
                jefeDirecto: null,
                comiteParitario: null
            },
            estado: 'reportado',
            reportadoPor: data.reportadoPor || 'QR-Publico',
            qrToken: data.qrToken || null,
            firmaConfirmacion: data.firmaConfirmacion || null,
            tenantId: data.tenantId || data.empresaId || 'default',
            obraId: data.obraId || null,
            origenReporte: 'qr_publico',
            viewedBy: [],
            createdAt: now,
            updatedAt: now
        };

        await this.dynamo.send(new PutCommand({
            TableName: this.incidentsTable,
            Item: incident
        }));

        // El mismo aviso que `create`: antes este mandaba el relato completo a la
        // bandeja y a SNS.
        await this.avisarPrevencion(incident);

        return {
            incidentId,
            message: 'Reporte creado exitosamente'
        };
    }

    // MARK AS VIEWED
    async markAsViewed(id, userId) {
        if (!id || !userId) return;

        console.log(`[MARK_AS_VIEWED] Incident ${id} by user ${userId}`);

        try {
            await this.dynamo.send(new UpdateCommand({
                TableName: this.incidentsTable,
                Key: { incidentId: id },
                UpdateExpression: 'ADD viewedBy :userId',
                ExpressionAttributeValues: {
                    ':userId': new Set([userId])
                }
            }));
        } catch (error) {
            console.error('[ERROR] markAsViewed failed:', error);
        }
    }
}

module.exports = { IncidentsRepository };
