const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { HUELLA_SHA256, urlDeSubida, s3Client } = require('../../lib/clients/s3');
const almacenamiento = require('../../lib/almacenamiento');
const {
    EXTENSION_POR_MIME, EXTENSION_POR_MIME_FOTO, MIME_PAPELES, MAX_BYTES_PAPEL, MAX_MEDIDAS_INMEDIATAS,
    tipoPapelConSalud, esHallazgo, clasificacionDelTipo, papelesDelCaso, conMedidasNumeradas, conVistoPor,
} = require('../../lib/casos');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { v4: uuidv4 } = require('uuid');
const { guardarTraza, conTraza, esTraza } = require('../../lib/traza-sensible');
const { hmacRut } = require('../../lib/cifradoCampo');
const { validateRut, normalizeRol } = require('../../lib/utils/validation');
const { construirMensaje } = require('../../lib/bandeja');
const { conNeutro, registrarFallo } = require('../../lib/degradacion');
const { obraDeLaEmpresa } = require('../../lib/auth/pertenencia');
const { fechaHoraChile } = require('../../lib/utils/fechaChile');
const { cortar } = require('../../lib/utils/texto');
const { personaPuede, PERMISSIONS } = require('../../lib/permissions');
const { tenantParaPermisos } = require('../../lib/auth/permisos-empresa');

const leido = (item) => conVistoPor(conMedidasNumeradas(item));

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

// Lo que pase del tope (`MAX_MEDIDAS_INMEDIATAS`, en lib/casos) se corta, igual que
// `descripcionBreve` del reporte flash; el formulario no deja escribir más.
// Se corta por caracteres completos: `slice` podía partir un emoji por la mitad.
const textoMedidasInmediatas = (valor) => (typeof valor === 'string' ? cortar(valor.trim(), MAX_MEDIDAS_INMEDIATAS) : '');

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
        const tenantSafe = await tenantParaPermisos(tenantId, 'incidente.aviso.roles');
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

        // La clasificación sale siempre del tipo (el handler ya la comprueba): la que traiga
        // `data` no cuenta.
        const clasificacionNueva = clasificacionDelTipo(data.tipo);
        const esHallazgoNuevo = clasificacionNueva === 'hallazgo';

        const incident = {
            incidentId,
            tipo: data.tipo,
            // Taxonomia reunion 2026-06-10: 'hallazgo' (abierto a todos, con
            // gobernanza) | 'incidente' (creacion restringida a supervisor+).
            clasificacion: clasificacionNueva,
            // La gobernanza es solo de hallazgos y la arma el handler, con el responsable
            // y el plazo ya validados (`responsableYPlazo`). Un incidente no la tiene.
            gobernanza: esHallazgoNuevo ? (data.gobernanza || null) : null,
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
            // Sin fecha del cliente, la de Chile: Lambda corre en UTC, y pasadas las 21:00 de
            // Chile el día UTC ya es el siguiente.
            fecha: data.fecha || fechaHoraChile(now).fecha,
            hora: data.hora || fechaHoraChile(now).horario,
            descripcion: data.descripcion,
            // Qué se hizo en el momento para contener el riesgo (fase 1 del
            // rediseño). Es texto libre sobre la obra, no sobre personas: va en el
            // elemento listado y no en la traza, como `descripcion`.
            medidasInmediatas: textoMedidasInmediatas(data.medidasInmediatas),
            gravedad: data.gravedad || 'leve',
            diasPerdidos: data.diasPerdidos || 0,
            // Las fotos NO vienen del cliente: se adjuntan con `agregarEvidencias`, que
            // valida que la clave sea de esta empresa y de este incidente. Con una clave
            // ajena, `get` firmaría la descarga de un archivo de otro.
            evidencias: [],
            // Los papeles del caso NO vienen del cliente: se agregan con
            // `registrarPapel`, con el archivo ya comprobado. `documentos` es el campo
            // anterior (un archivo por tipo), que ya no se escribe.
            documentos: {},
            papeles: [],
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

            // Las medidas correctivas ya no son datos del caso: se definen subiendo el plan de
            // medidas correctivas (un papel). `medidasCorrectivas` solo existe en los casos
            // guardados antes del cambio y se lee, no se escribe: ver `getMedidasByObra`.

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

    /**
     * TODOS los incidentes de una empresa, o de la tabla entera si no se da empresa.
     *
     * Es el único lugar que los lee por empresa, y PAGINA: una consulta de DynamoDB
     * devuelve hasta 1 MB y avisa con `LastEvaluatedKey` que hay más. Cada lector
     * (listado, estadísticas, analítica, medidas de la obra, resumen de casos, ítem 66
     * del FUF) hacía su propia consulta sin seguir esa llave, y una empresa con muchos
     * casos recibía solo la primera página sin que nada lo dijera. Lanza si la lectura
     * falla: quien llama decide si degrada (el FUF, por ejemplo, a "no verificado").
     */
    async itemsDeLaEmpresa(tenantId) {
        const items = [];
        let desde;
        if (tenantId) {
            do {
                const result = await this.dynamo.send(new QueryCommand({
                    TableName: this.incidentsTable,
                    IndexName: 'tenantId-fecha-index',
                    KeyConditionExpression: 'tenantId = :tenantId',
                    ExpressionAttributeValues: { ':tenantId': tenantId },
                    ...(desde ? { ExclusiveStartKey: desde } : {})
                }));
                items.push(...(result.Items || []).map(leido));
                desde = result.LastEvaluatedKey;
            } while (desde);
            return items;
        }
        do {
            const result = await this.dynamo.send(new ScanCommand({
                TableName: this.incidentsTable,
                ...(desde ? { ExclusiveStartKey: desde } : {})
            }));
            // Un `Scan` recorre la tabla entera y ve también los elementos con la
            // parte sensible, que no son incidentes.
            items.push(...(result.Items || []).filter((i) => !esTraza(i, 'incidentId')).map(leido));
            desde = result.LastEvaluatedKey;
        } while (desde);
        return items;
    }

    // LIST
    async list({ tenantId, obraId, tipo, estado, fechaInicio, fechaFin }) {
        console.log('Repo.list called');
        let items = await this.itemsDeLaEmpresa(tenantId);

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
        // El plazo es un día de Chile: "vencida" se mide contra el de hoy en Chile, no
        // contra el día UTC (que desde las 21:00 de Chile ya es el siguiente).
        const hoy = fechaHoraChile(Date.now()).fecha;

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
    // Actualiza responsable, plazo, estado de seguimiento y comentario SIN tocar el
    // resto del registro, y SIN cerrar: el cierre de un hallazgo (`estadoCierre =
    // 'cerrado'`) pasa siempre por `cerrar`, que exige el permiso de cierre, deja
    // `cierre` escrito y verifica quién cerró. El handler ya validó a la persona
    // responsable (de la empresa, activa, con el nombre de su ficha) y el plazo.
    /**
     * @param {object} incidente el elemento leído por el handler (la escritura exige que
     *   no haya cambiado desde esa lectura: 409 si cambió).
     * @param {{responsableId?: string|null, responsableNombre?: string|null, plazoRespuestaISO?: string|null,
     *   estadoCierre?: 'abierto'|'en_proceso', comentarioCierre?: string|null}} cambios ya validados.
     */
    async updateGobernanza(incidente, cambios) {
        if (!esHallazgo(incidente)) {
            throw Object.assign(new Error('La gobernanza solo aplica a hallazgos'), { statusCode: 400 });
        }
        const camposPermitidos = ['responsableId', 'responsableNombre', 'plazoRespuestaISO', 'estadoCierre', 'comentarioCierre'];
        const gobernanza = { ...(incidente.gobernanza || {}) };
        camposPermitidos.forEach((campo) => {
            if (cambios[campo] !== undefined) gobernanza[campo] = cambios[campo];
        });
        const actualizado = await this.actualizarCaso(incidente, { gobernanza });
        return { incident: actualizado, gobernanza };
    }

    // ─── Completar reporte flash (reunion 2026-06-10) ───────────────────────────
    // Permite corregir/completar los datos una vez disponible la informacion real.
    // esFlash y segunInformacionDisponible son INMUTABLES (trazabilidad legal).
    /**
     * @param {object} incidente el elemento leído por el handler: la escritura falla con 409
     *   si el caso cambió desde esa lectura (antes escribía sin condición).
     * @param {object} data ya validado por el handler (`validarCompletarFlash`).
     *
     * El reporte flash y los datos del afectado (`trabajador`, con su RUT) viven en la TRAZA
     * (`create`), no en el elemento listado: esta ruta leía `reporteFlash` del listado y por
     * eso nunca encontraba nada. Ahora lee la traza y, al guardar, escribe ahí lo sensible;
     * en el elemento solo queda el nombre y el vínculo por HMAC. El elemento se escribe PRIMERO,
     * porque es el que lleva el bloqueo: quien pierde la carrera no toca la traza.
     */
    async completarFlash(incidente, data) {
        const completo = await conTraza(this.incidentsTable, 'incidentId', incidente);
        const flashActual = completo?.reporteFlash;
        if (!flashActual?.esFlash) {
            throw Object.assign(new Error('El incidente no fue creado como reporte flash'), { statusCode: 400 });
        }
        console.log('[FLASH] incidente', incidente.incidentId, '| campos:', Object.keys(data || {}).join(',') || '-');

        const now = new Date().toISOString();
        const reporteFlash = {
            ...flashActual,
            afectados: data.afectados !== undefined ? data.afectados : flashActual.afectados,
            descripcionBreve: data.descripcionBreve !== undefined ? cortar(data.descripcionBreve, 500) : flashActual.descripcionBreve,
            severidad: data.gravedad || flashActual.severidad,
            ubicacionReferencia: data.ubicacionReferencia !== undefined ? data.ubicacionReferencia : flashActual.ubicacionReferencia,
            esFlash: true,
            segunInformacionDisponible: true,
            editadoEn: now
        };

        // Campos del incidente que se completan con la investigacion.
        const campos = {};
        if (data.descripcion) campos.descripcion = data.descripcion;
        if (data.gravedad) campos.gravedad = data.gravedad;
        if (data.diasPerdidos !== undefined) campos.diasPerdidos = data.diasPerdidos;
        const trabajador = data.trabajador || completo.trabajador || null;
        if (data.trabajador) {
            campos.trabajadorNombre = data.trabajador.nombre;
            campos.afectadoRutHmac = validateRut(data.trabajador.rut || '').valid ? await hmacRut(data.trabajador.rut) : null;
        }

        const actualizado = await this.actualizarCaso(incidente, campos);
        await guardarTraza(this.incidentsTable, 'incidentId', incidente.incidentId, { trabajador, reporteFlash });
        // El elemento de un caso anterior puede traer todavía `reporteFlash` y `trabajador` en claro:
        // la respuesta nunca los devuelve.
        const { reporteFlash: _flash, trabajador: _trabajador, ...visible } = actualizado;
        return { incident: visible };
    }

    // ─── DS44 Art. 71 — Seguimiento del estado de una medida correctiva ─────────
    /**
     * Cambia el estado de una medida. Escribe con la condición de que el incidente no
     * haya cambiado desde que el handler lo leyó (409 si cambió): antes pisaba la lista
     * entera con lo que había leído un instante antes, y dos cambios a la vez se
     * perdían uno al otro (o una medida recién creada). Responde `{ incident, medidas }`
     * como siempre: lo lee `ObraDetalle`.
     */
    async updateMedidaEstado(incidente, numero, estado) {
        const estadosValidos = ['pendiente', 'en_proceso', 'completada', 'verificada'];
        if (!estadosValidos.includes(estado)) {
            throw Object.assign(new Error(`Estado inválido. Válidos: ${estadosValidos.join(', ')}`), { statusCode: 400 });
        }
        const previas = Array.isArray(incidente.medidasCorrectivas) ? incidente.medidasCorrectivas : [];
        if (!previas.some((m) => String(m.numero) === String(numero))) {
            throw Object.assign(new Error('Medida no encontrada'), { statusCode: 404 });
        }

        const now = new Date().toISOString();
        const medidas = previas.map((m) =>
            String(m.numero) === String(numero)
                ? { ...m, estado, fechaActualizacionEstado: now }
                : m
        );
        const todasVerificadas = medidas.length > 0 && medidas.every((m) => m.estado === 'verificada');

        const incident = await this.actualizarCaso(incidente, { medidasCorrectivas: medidas, medidasVerificadas: todasVerificadas });
        return { incident, medidas };
    }

    // GET
    /**
     * Devuelve el incidente CRUDO: sin la parte sensible (`conTraza`, que descifra
     * con KMS) y sin previsualizaciones de evidencia.
     *
     * Existe para comprobar a qué empresa pertenece, si está cerrado y qué papeles
     * lleva antes de responder cualquier cosa sobre él, que es lo que hace toda ruta.
     * `get()` además lee y descifra la traza y arma URLs firmadas de la evidencia, y
     * hacer ese trabajo (y pagar esas llamadas a KMS y a S3) para un incidente que no
     * es de quien pregunta, o solo para comprobar el estado, sería exactamente al revés.
     * Ningún dato de la traza (RUT, género, cargo, reporte flash) se necesita para
     * decidir permisos, estado ni papeles.
     */
    async getItem(incidentId) {
        const result = await this.dynamo.send(new GetCommand({
            TableName: this.incidentsTable,
            Key: { incidentId }
        }));
        // Las medidas antiguas sin número salen numeradas (ver `conMedidasNumeradas`).
        return result.Item ? leido(result.Item) : null;
    }

    /**
     * La ficha completa: el incidente con su parte sensible y las previsualizaciones
     * firmadas de la evidencia. Si quien llama ya leyó el elemento (`getItem`) lo pasa
     * en `itemLeido` y no se lee otra vez.
     */
    async get(id, itemLeido) {
        console.log('[GET] Repo.get called for ID:', id);
        let item = itemLeido;
        if (!item) {
            const result = await this.dynamo.send(new GetCommand({
                TableName: this.incidentsTable,
                Key: { incidentId: id }
            }));
            item = result.Item ? leido(result.Item) : result.Item;
        }

        if (!item) {
            console.error('[GET] Incident not found:', id);
            throw new Error('Incidente no encontrado');
        }

        const incident = await conTraza(this.incidentsTable, 'incidentId', item);
        console.log('[GET] Building evidence previews for', (incident.evidencias || []).length, 'items');
        const evidencePreviews = await this.buildEvidencePreviews(incident.evidencias || []);
        console.log('[GET] Evidence previews built:', evidencePreviews.length);

        return {
            ...incident,
            evidencePreviews
        };
    }

    // UPDATE
    /** El caso a escribir: el elemento ya leído, o el que corresponde a un id (para quien llama solo con el id). */
    async casoParaEscribir(ref) {
        const incidente = typeof ref === 'string' ? await this.getItem(ref) : ref;
        if (!incidente) throw Object.assign(new Error('Incidente no encontrado'), { statusCode: 404 });
        return incidente;
    }

    /**
     * @param {object|string} ref el elemento leído por el handler, o un id (lo usa el cierre de
     *   la investigación de la obra, que no lo lee antes). La escritura exige que el caso no
     *   haya cambiado desde la lectura: 409 si cambió (antes escribía sin condición, y pisaba lo
     *   que otra persona acababa de guardar).
     */
    async update(ref, data) {
        const incidente = await this.casoParaEscribir(ref);
        // Qué campos cambian, nunca sus valores (ver la nota de `create`).
        console.log('[UPDATE] incidente', incidente.incidentId, '| campos:', Object.keys(data || {}).join(',') || '-');
        const now = new Date().toISOString();
        const campos = {};

        if (data.tipo) campos.tipo = data.tipo;
        if (data.clasificacion) campos.clasificacion = data.clasificacion;
        if (data.estado) campos.estado = data.estado;
        const investigaciones = { ...(incidente.investigaciones || {}) };
        let conInvestigacion = false;
        for (const [campoData, campo] of [
            ['investigacionPrevencionista', 'prevencionista'],
            ['investigacionJefeDirecto', 'jefeDirecto'],
            ['investigacionComiteParitario', 'comiteParitario'],
        ]) {
            if (!data[campoData]) continue;
            investigaciones[campo] = { ...data[campoData], fecha: now };
            conInvestigacion = true;
        }
        if (conInvestigacion) campos.investigaciones = investigaciones;
        if (data.diasPerdidos !== undefined) campos.diasPerdidos = data.diasPerdidos;
        // `evidencias` no se edita acá: se agregan con `agregarEvidencias`, que el
        // handler valida clave por clave. Esta función reemplazaba la lista entera.
        if (data.medidasInmediatas !== undefined) campos.medidasInmediatas = textoMedidasInmediatas(data.medidasInmediatas);
        if (data.fechaCierre !== undefined) campos.fechaCierre = data.fechaCierre;
        if (data.informeDocumentId !== undefined) campos.informeDocumentId = data.informeDocumentId;

        const incident = await this.actualizarCaso(incidente, campos);
        return {
            incident,
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
        // Lo que se firma va a un bucket que no deja borrar durante 5 años: solo
        // imágenes, y solo a la carpeta de un incidente (sin id no hay carpeta, y una
        // subida a un prefijo suelto quedaría guardada años sin dueño). El handler ya lo
        // rechaza con 400; esto cubre a quien use el repositorio directo.
        if (!incidentId) throw Object.assign(new Error('incidentId es requerido'), { statusCode: 400 });
        if (!EXTENSION_POR_MIME_FOTO[fileType]) {
            throw Object.assign(new Error('Solo se aceptan fotos (JPG, PNG, WebP o HEIC).'), { statusCode: 400 });
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
        // La extensión sale del tipo validado, no del nombre del archivo.
        const s3Key = `tenants/${tenantId}/incidentes/${incidentId}/${uuidv4()}.${EXTENSION_POR_MIME_FOTO[fileType]}`;

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

        let items = await this.itemsDeLaEmpresa(tenantId);
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
    /** @param {object|string} ref el elemento leído por el handler (la escritura falla con 409 si el caso cambió desde entonces), o un id. */
    async addInvestigation(ref, data) {
        if (!ref) throw new Error('ID de incidente requerido');
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

        const incidente = await this.casoParaEscribir(ref);
        const incident = await this.actualizarCaso(incidente, {
            investigaciones: { ...(incidente.investigaciones || {}), [campoInvestigacion]: investigation },
            estado: 'en_investigacion',
        });

        return {
            incident,
            message: 'Investigación agregada exitosamente',
            investigation
        };
    }

    // ─── CLASIFICACIÓN Y CIERRE (fase 3 del rediseño) ────────────────────────────
    //
    // Todas escriben con la condición de que el incidente no haya cambiado desde
    // que el handler lo leyó (`updatedAt`), como `agregarEvidencias` y
    // `registrarPapel`: las reglas que el handler comprobó (caso abierto, nada
    // pendiente al cerrar) siguen siendo ciertas al guardar aunque lleguen dos
    // peticiones a la vez. Si cambió, 409.

    /** Escribe `campos` en el incidente leído, o 409 si cambió desde la lectura. Devuelve el elemento guardado. */
    async actualizarCaso(incidente, campos) {
        const nombres = {};
        const valores = { ':u': new Date().toISOString(), ':leido': incidente.updatedAt };
        const sets = ['updatedAt = :u'];
        Object.entries(campos).forEach(([campo, valor], i) => {
            nombres[`#c${i}`] = campo;
            valores[`:v${i}`] = valor;
            sets.push(`#c${i} = :v${i}`);
        });
        try {
            const result = await this.dynamo.send(new UpdateCommand({
                TableName: this.incidentsTable,
                Key: { incidentId: incidente.incidentId },
                UpdateExpression: `SET ${sets.join(', ')}`,
                ConditionExpression: 'updatedAt = :leido',
                ExpressionAttributeNames: nombres,
                ExpressionAttributeValues: valores,
                ReturnValues: 'ALL_NEW'
            }));
            return result.Attributes;
        } catch (err) {
            if (err?.name === 'ConditionalCheckFailedException') {
                throw Object.assign(new Error('El caso cambió mientras lo editabas. Recarga e intenta de nuevo.'), { statusCode: 409 });
            }
            throw err;
        }
    }

    /**
     * Clasifica el caso (triaje). Reclasificar reemplaza `tipo`, `clasificacion`,
     * `gravedad` y `altoPotencial` —los campos que lee todo lo demás— y deja en
     * `triaje.anteriores` lo que había: la clasificación anterior, o, la primera vez,
     * lo que declaró quien reportó. La lista se corta en las últimas 20.
     *
     * `datos`: `{ tipo, gravedad, danoMayor, granSusto }` ya validados. Para un
     * hallazgo pueden venir además `responsableId`, `responsableNombre` y
     * `plazoRespuestaISO` (la persona que lo va a corregir).
     */
    async clasificar(incidente, datos, personaId) {
        const ahora = new Date().toISOString();
        const clasificacion = clasificacionDelTipo(datos.tipo);
        const esHallazgoNuevo = clasificacion === 'hallazgo';
        const esIncidentePeligroso = datos.tipo === 'incidente';

        const { anteriores: _historial, ...triajePrevio } = incidente.triaje || {};
        const anterior = incidente.triaje
            ? triajePrevio
            : {
                tipo: incidente.tipo,
                clasificacion: incidente.clasificacion || null,
                gravedad: esHallazgo(incidente) ? null : (incidente.gravedad || null),
                danoMayor: null,
                granSusto: null,
                clasificadoPor: incidente.reportadoPor || null,
                clasificadoEn: incidente.createdAt || null,
                origen: 'reporte',
            };
        const triaje = {
            tipo: datos.tipo,
            clasificacion,
            gravedad: esHallazgoNuevo ? null : datos.gravedad,
            danoMayor: esIncidentePeligroso ? datos.danoMayor : null,
            granSusto: esIncidentePeligroso ? datos.granSusto : null,
            clasificadoPor: personaId,
            clasificadoEn: ahora,
            anteriores: [...(incidente.triaje?.anteriores || []), anterior].slice(-20),
        };

        const campos = {
            tipo: datos.tipo,
            clasificacion,
            // Es lo que lee `papelesRequeridos`: solo un incidente puede ser de alto potencial.
            altoPotencial: esIncidentePeligroso && (datos.danoMayor === true || datos.granSusto === true),
            triaje,
        };
        if (!esHallazgoNuevo) campos.gravedad = datos.gravedad;
        // Un reporte recién llegado pasa a investigación al clasificarlo; el hallazgo
        // lo hace por su gobernanza (no se inventan estados nuevos).
        if (!esHallazgoNuevo && incidente.estado === 'reportado') campos.estado = 'en_investigacion';
        if (esHallazgoNuevo) {
            const gobernanza = { ...(incidente.gobernanza || {
                responsableId: null, responsableNombre: null, plazoRespuestaISO: null,
                estadoCierre: 'abierto', verificadoPor: null, fechaVerificacion: null, comentarioCierre: null,
            }) };
            if (gobernanza.estadoCierre === 'abierto') gobernanza.estadoCierre = 'en_proceso';
            if (datos.responsableId) {
                gobernanza.responsableId = datos.responsableId;
                gobernanza.responsableNombre = datos.responsableNombre || null;
            }
            if (datos.plazoRespuestaISO) gobernanza.plazoRespuestaISO = datos.plazoRespuestaISO;
            campos.gobernanza = gobernanza;
        }

        console.log('[TRIAJE] incidente', incidente.incidentId, '| tipo', datos.tipo, '| altoPotencial', campos.altoPotencial);
        return this.actualizarCaso(incidente, campos);
    }

    /**
     * Cierra el caso. El handler ya comprobó que no falta nada. Un incidente o
     * accidente pasa a `estado = 'cerrado'`; un hallazgo, a `gobernanza.estadoCierre
     * = 'cerrado'` con el comentario, quién verificó y cuándo. En los dos queda
     * `cierre` con el comentario, quién cerró y cuándo. Es la ÚNICA vía de cierre:
     * `PUT /incidents/{id}/cerrar` y `PUT /incidents/{id}/gobernanza` con `estadoCierre =
     * 'cerrado'` llegan acá, así que `cierre` y la reapertura siempre tienen de dónde leer.
     */
    async cerrar(incidente, comentarioCierre, personaId, gobernanzaExtra = {}) {
        const ahora = new Date().toISOString();
        const campos = { cierre: { comentario: comentarioCierre, cerradoPor: personaId, cerradoEn: ahora } };
        if (esHallazgo(incidente)) {
            campos.gobernanza = {
                ...(incidente.gobernanza || {}),
                // Lo que se guardó junto con el cierre (responsable y plazo que vienen en la
                // misma petición de la gobernanza), ya validado por el handler.
                ...gobernanzaExtra,
                estadoCierre: 'cerrado',
                comentarioCierre,
                verificadoPor: personaId,
                fechaVerificacion: ahora,
            };
        } else {
            campos.estado = 'cerrado';
        }
        console.log('[CIERRE] incidente', incidente.incidentId, '| cerrado por', personaId);
        return this.actualizarCaso(incidente, campos);
    }

    /**
     * Reabre un caso cerrado, con el motivo. El cierre anterior no se pierde: queda
     * en `reaperturas` (motivo, quién, cuándo y el cierre que se deshizo).
     */
    async reabrir(incidente, motivo, personaId) {
        const ahora = new Date().toISOString();
        const reapertura = { motivo, reabiertoPor: personaId, reabiertoEn: ahora, cierreAnterior: incidente.cierre || null };
        const campos = { reaperturas: [...(incidente.reaperturas || []), reapertura].slice(-20), cierre: null };
        if (esHallazgo(incidente)) {
            campos.gobernanza = {
                ...(incidente.gobernanza || {}),
                estadoCierre: 'en_proceso',
                verificadoPor: null,
                fechaVerificacion: null,
                // El comentario del cierre anterior queda en `reaperturas[].cierreAnterior`.
                // Dejarlo acá hacía que el papel "Comentario de cierre" siguiera cumplido con
                // el caso abierto, y que el siguiente cierre arrastrara un texto que ya no vale.
                comentarioCierre: null,
            };
            // Un hallazgo cerrado por otra vía pudo dejar `estado = 'cerrado'`.
            if (incidente.estado === 'cerrado') campos.estado = 'en_investigacion';
        } else {
            campos.estado = 'en_investigacion';
        }
        console.log('[REAPERTURA] incidente', incidente.incidentId, '| por', personaId);
        return this.actualizarCaso(incidente, campos);
    }

    // ─── PAPELES DEL CASO (fase 2 del rediseño) ──────────────────────────────────
    //
    // Los papeles de un caso son evidencia de cumplimiento (Arts. 71-72): viven en
    // el bucket con Object Lock, bajo `tenants/{empresa}/incidentes/{id}/papeles/`,
    // un prefijo distinto al de las fotos. En el incidente quedan en `papeles`, una
    // LISTA: cada subida agrega y nada se pisa ni se borra (una segunda DIAT no
    // reemplaza a la primera; el bucket, además, no deja borrar).
    //
    // La subida es en dos pasos: `pedirSubidaPapel` firma la URL y NO escribe nada
    // en el incidente; `registrarPapel` comprueba con HeadObject que el archivo
    // llegó y recién ahí lo registra. Antes el registro se escribía al pedir la URL
    // y quedaba aunque la subida fallara. Sin confirmación no hay registro.

    /** Prefijo de los papeles de un caso. El de las fotos es el mismo sin `papeles/`. */
    prefijoPapeles(tenantId, incidentId) {
        return `tenants/${tenantId}/incidentes/${incidentId}/papeles/`;
    }

    // Paso 1: URL de subida. La huella SHA-256 la calcula el navegador (S3 rechaza
    // escrituras sin huella en el bucket con bloqueo). La extensión sale del tipo
    // MIME validado, no del nombre del archivo, y el nombre no se escribe en logs.
    async pedirSubidaPapel({ incidentId, tenantId, tipo, fileType, checksumSha256 }) {
        console.log('[PAPELES] subida solicitada | incidente', incidentId, '| tipo', tipo);
        if (!HUELLA_SHA256.test(String(checksumSha256 || ''))) {
            throw Object.assign(new Error('Falta la huella SHA-256 del archivo. Recarga la página e intenta de nuevo.'), { statusCode: 400 });
        }
        const papelId = uuidv4();
        const s3Key = `${this.prefijoPapeles(tenantId, incidentId)}${tipo}-${papelId}.${EXTENSION_POR_MIME[fileType]}`;
        const command = new PutObjectCommand({
            Bucket: this.incidentEvidenceBucket,
            Key: s3Key,
            ContentType: fileType,
            ChecksumSHA256: checksumSha256,
        });
        const uploadUrl = await urlDeSubida(command, 3600);
        return { uploadUrl, s3Key, papelId };
    }

    // Paso 2: comprueba que el archivo está en el bucket y lo registra en el caso.
    // `incidente` es el elemento leído por el handler (para el tope y la
    // idempotencia); el agregado se hace con la condición de que no haya cambiado
    // desde esa lectura, como `agregarEvidencias`.
    async registrarPapel(incidente, { s3Key, tipo, papelId, nombreArchivo, fechaDocumento, personaId }) {
        const previos = Array.isArray(incidente.papeles) ? incidente.papeles : [];
        // Confirmar dos veces (un reintento tras un corte) no duplica el papel.
        const yaEsta = previos.find((p) => p.s3Key === s3Key);
        if (yaEsta) return { papel: yaEsta, yaRegistrado: true };

        let cabecera;
        try {
            cabecera = await s3Client.send(new HeadObjectCommand({
                Bucket: almacenamiento.bucketDeClave(s3Key),
                Key: s3Key,
                ChecksumMode: 'ENABLED',
            }));
        } catch (err) {
            if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
                throw Object.assign(new Error('No encontramos el archivo subido. Vuelve a subirlo.'), { statusCode: 400 });
            }
            throw err;
        }
        // Lo que S3 tiene guardado manda sobre lo que diga el cliente.
        const tipoMime = String(cabecera.ContentType || '').split(';')[0].trim();
        if (!MIME_PAPELES.includes(tipoMime)) {
            throw Object.assign(new Error('El archivo subido no es un PDF ni una imagen válida.'), { statusCode: 400 });
        }
        const tamano = Number(cabecera.ContentLength) || 0;
        if (tamano > MAX_BYTES_PAPEL) {
            throw Object.assign(new Error(`El archivo supera el máximo de ${Math.round(MAX_BYTES_PAPEL / (1024 * 1024))} MB.`), { statusCode: 413 });
        }

        const papel = {
            papelId,
            tipo,
            nombreArchivo,
            tipoMime,
            s3Key,
            subidoPor: personaId,
            subidoEn: new Date().toISOString(),
            fechaDocumento: fechaDocumento || null,
            tamano,
            // La huella que S3 verificó al recibir el PUT (lib/huellaArchivo.js).
            huella: cabecera.ChecksumSHA256
                ? { alg: 'sha256', valor: cabecera.ChecksumSHA256, versionId: cabecera.VersionId || null }
                : null,
        };
        try {
            await this.dynamo.send(new UpdateCommand({
                TableName: this.incidentsTable,
                Key: { incidentId: incidente.incidentId },
                UpdateExpression: 'SET papeles = list_append(if_not_exists(papeles, :vacia), :nuevo), updatedAt = :u',
                ConditionExpression: 'updatedAt = :leido',
                ExpressionAttributeValues: { ':vacia': [], ':nuevo': [papel], ':u': new Date().toISOString(), ':leido': incidente.updatedAt },
            }));
        } catch (err) {
            if (err?.name === 'ConditionalCheckFailedException') {
                throw Object.assign(new Error('El reporte cambió mientras se registraba el papel. Intenta de nuevo.'), { statusCode: 409 });
            }
            throw err;
        }
        console.log('[PAPELES] registrado | incidente', incidente.incidentId, '| tipo', tipo, '| papel', papelId);
        return { papel, yaRegistrado: false };
    }

    /**
     * Bucket de un papel. Las claves actuales (`tenants/{empresa}/{carpeta}/…`) lo dicen en
     * su carpeta (`almacenamiento.bucketDeClave`). Las del contrato de diciembre de 2025 a
     * septiembre de 2026 (`{id}/documents/{tipo}-….pdf`, sin empresa) no tienen carpeta: ese
     * segundo tramo es `documents`, y `bucketDeClave` las mandaría al bucket de trabajo.
     * Los papeles de incidentes siempre se guardaron en el bucket de evidencia del módulo,
     * así que ahí se buscan.
     */
    bucketDelPapel(s3Key) {
        return String(s3Key).startsWith('tenants/') ? almacenamiento.bucketDeClave(s3Key) : this.incidentEvidenceBucket;
    }

    // Los papeles del caso con un enlace de descarga FIRMADO de 15 minutos (como
    // las fotos). Nunca una URL directa al bucket: no abre y, si abriera, no
    // dejaría constancia de quién la pidió.
    async getDocuments(incidente) {
        // Incluye los papeles del contrato anterior (`documentos.diat`/`diep`): con
        // la misma firma y la misma auditoría que los demás.
        const papeles = papelesDelCaso(incidente);
        const archivos = await Promise.all(papeles.map(async (p) => {
            const { s3Key, huella, ...visible } = p;
            const url = await getSignedUrl(s3Client, new GetObjectCommand({
                Bucket: this.bucketDelPapel(s3Key),
                Key: s3Key,
                // El navegador descarga con el nombre original, no con la clave.
                ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(p.nombreArchivo || 'documento')}`,
            }), { expiresIn: 900 });
            return { ...visible, contieneSalud: tipoPapelConSalud(p.tipo), url };
        }));
        return { archivos, clavesConSalud: papeles.filter((p) => tipoPapelConSalud(p.tipo)).map((p) => p.s3Key) };
    }

    // GET ANALYTICS
    async getAnalytics({ tenantId, obraId, fechaInicio, fechaFin }) {
        fechaFin = fechaFin || new Date().toISOString().split('T')[0];
        let items = await this.itemsDeLaEmpresa(tenantId);

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

    // MARK AS VIEWED
    // La forma guardada es una lista. Se agrega con `list_append` solo si el campo falta o
    // no lo contiene ya (idempotente) y sin tocar `updatedAt`: el bloqueo optimista del
    // caso no debe fallar por una marca de lectura. Si el campo es un conjunto de texto
    // (casos antiguos), `list_append` falla con ValidationException y se reescribe como lista.
    async markAsViewed(id, userId) {
        if (!id || !userId) return;

        console.log(`[MARK_AS_VIEWED] Incident ${id} by user ${userId}`);

        const base = {
            TableName: this.incidentsTable,
            Key: { incidentId: id },
        };
        try {
            try {
                await this.dynamo.send(new UpdateCommand({
                    ...base,
                    UpdateExpression: 'SET viewedBy = list_append(if_not_exists(viewedBy, :vacia), :uno)',
                    ConditionExpression: 'attribute_exists(incidentId) AND (attribute_not_exists(viewedBy) OR NOT contains(viewedBy, :userId))',
                    ExpressionAttributeValues: { ':vacia': [], ':uno': [userId], ':userId': userId }
                }));
            } catch (error) {
                if (error.name === 'ConditionalCheckFailedException') return;
                if (error.name !== 'ValidationException') throw error;
                const { Item } = await this.dynamo.send(new GetCommand({ ...base }));
                if (!Item) return;
                const previos = Item.viewedBy instanceof Set ? [...Item.viewedBy] : (Array.isArray(Item.viewedBy) ? Item.viewedBy : []);
                if (previos.includes(userId)) return;
                await this.dynamo.send(new UpdateCommand({
                    ...base,
                    UpdateExpression: 'SET viewedBy = :lista',
                    ConditionExpression: 'attribute_exists(incidentId)',
                    ExpressionAttributeValues: { ':lista': [...previos, userId] }
                }));
            }
        } catch (error) {
            if (error.name === 'ConditionalCheckFailedException') return;
            console.error('[ERROR] markAsViewed failed:', error);
        }
    }
}

module.exports = { IncidentsRepository };
