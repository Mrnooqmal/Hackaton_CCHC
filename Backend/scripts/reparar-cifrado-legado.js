#!/usr/bin/env node
/**
 * Repara las fichas, empresas y trazas de auditoría (firmas/incidentes) que
 * quedaron en el esquema legado (RUT, salud o traza en claro) tras D-10,
 * escribiéndolas en el formato nuevo.
 *
 * NO es un script de migración batch para producción real: es la reparación
 * puntual de las pocas filas de prueba que ya existían en dev y prod cuando
 * se implementó D-10 (aprobado explícitamente: "sin script de migración
 * batch... con una sola fila real... es más simple"). El sistema no lo
 * necesita para funcionar — "leer y reparar" ya cubre la migración normal,
 * campo por campo, la próxima vez que cada ficha se guarde — esto solo
 * adelanta esa reparación para no dejar datos de prueba en un formato que ya
 * no se escribe.
 *
 * Las trazas de firmas e incidentes son la excepción a "leer y reparar": se
 * escriben una sola vez al crear el registro y no tienen un "próximo
 * guardado" que las migre solas, así que su reparación vive únicamente acá.
 *
 * Uso:
 *   AWS_PROFILE=<perfil> node scripts/reparar-cifrado-legado.js --stage dev [--confirmar]
 */

const args = process.argv.slice(2);
const stage = args[args.indexOf('--stage') + 1];
const confirmar = args.includes('--confirmar');

if (!stage || !['dev', 'prod'].includes(stage)) {
    console.error('\n  Uso: node scripts/reparar-cifrado-legado.js --stage <dev|prod> [--confirmar]\n');
    process.exit(1);
}
if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) {
    console.error('\n  Falta AWS_PROFILE: la autorización es IAM.\n');
    process.exit(1);
}

const SERVICIO = 'BuildAndServe';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.TENANTS_TABLE = `${SERVICIO}-tenants-${stage}`;
process.env.PERSONAS_TABLE = `${SERVICIO}-personas-${stage}`;
process.env.SIGNATURES_TABLE = `${SERVICIO}-signatures-${stage}`;
process.env.INCIDENTS_TABLE = `${SERVICIO}-incidents-${stage}`;
process.env.DOCUMENTS_TABLE = `${SERVICIO}-documents-${stage}`;
process.env.ACTIVITIES_TABLE = `${SERVICIO}-activities-${stage}`;
process.env.SIGNATURE_REQUESTS_TABLE = `${SERVICIO}-signature-requests-${stage}`;
process.env.SURVEYS_TABLE = `${SERVICIO}-surveys-${stage}`;
process.env.CAMPO_HMAC_KEY_PARAM = `/${SERVICIO}/${stage}/campo-hmac-key`;
process.env.CAMPO_CIFRADO_KMS_KEY_ID = stage === 'prod'
    ? '986d852a-f577-4c52-935d-0c418c05e8fd'
    : '06c59eb0-40d9-4328-a07c-c17fbfbf2e89';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const cifradoCampo = require('../lib/cifradoCampo');
const { llaveDeTenant, PROPOSITOS } = require('../lib/llaveTenant');

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const doc = DynamoDBDocumentClient.from(client);

(async () => {
    console.log(`\n  Ambiente: ${stage}${confirmar ? '' : '   (ENSAYO, no se escribe nada)'}\n`);

    // ── Empresas ────────────────────────────────────────────────────────────
    const tenants = await doc.send(new ScanCommand({
        TableName: process.env.TENANTS_TABLE,
        FilterExpression: 'begins_with(PK, :pk) AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': 'TENANT#', ':sk': 'METADATA#' },
    }));

    for (const t of tenants.Items || []) {
        if (t.rutEmpresaCifrado) continue; // ya migrada
        console.log(`  Empresa ${t.tenantId} — RUT ${t.rutEmpresa}`);
        if (!confirmar) continue;

        const [rutEmpresaHmac, rutEmpresaCifrado] = await Promise.all([
            cifradoCampo.hmacRut(t.rutEmpresa),
            cifradoCampo.cifrarSobre(t.rutEmpresa),
        ]);
        await doc.send(new UpdateCommand({
            TableName: process.env.TENANTS_TABLE,
            Key: { PK: t.PK, SK: t.SK },
            UpdateExpression: 'SET rutEmpresaHmac = :h, rutEmpresaCifrado = :c REMOVE rutEmpresa',
            ExpressionAttributeValues: { ':h': rutEmpresaHmac, ':c': rutEmpresaCifrado },
        }));
        console.log('    reparada');
    }

    // ── Personas ────────────────────────────────────────────────────────────
    const personas = await doc.send(new ScanCommand({
        TableName: process.env.PERSONAS_TABLE,
        FilterExpression: 'begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':sk': 'PERSONA#' },
    }));

    for (const p of personas.Items || []) {
        if (p.rutCifrado) continue; // ya migrada
        console.log(`  Persona ${p.personaId} (${p.tenantId}) — RUT ${p.rut}`);
        if (!confirmar) continue;

        const [llaveRut, llaveSalud] = await Promise.all([
            llaveDeTenant(p.tenantId, PROPOSITOS.RUT_PERSONAS),
            llaveDeTenant(p.tenantId, PROPOSITOS.SALUD),
        ]);
        const vigilancia = p.vigilanciaSalud || {
            enVigilancia: false, protocolos: [], fechaUltimoExamen: null, aptitudLaboral: null, restricciones: [],
        };
        const restriccion = p.restriccionLaboral !== undefined ? p.restriccionLaboral : null;

        const rutHmac = await cifradoCampo.hmacRut(p.rut);
        const rutCifrado = cifradoCampo.cifrarConLlaveDatos(p.rut, llaveRut);
        const vigilanciaSaludCifrada = cifradoCampo.cifrarConLlaveDatos(vigilancia, llaveSalud);
        const restriccionLaboralCifrada = cifradoCampo.cifrarConLlaveDatosSiempre(restriccion, llaveSalud);

        await doc.send(new UpdateCommand({
            TableName: process.env.PERSONAS_TABLE,
            Key: { PK: p.PK, SK: p.SK },
            UpdateExpression: 'SET rutHmac = :rh, rutCifrado = :rc, vigilanciaSaludCifrada = :vc, '
                + 'restriccionLaboralCifrada = :rlc REMOVE rut, vigilanciaSalud, restriccionLaboral',
            ExpressionAttributeValues: {
                ':rh': rutHmac, ':rc': rutCifrado, ':vc': vigilanciaSaludCifrada, ':rlc': restriccionLaboralCifrada,
            },
        }));
        console.log('    reparada');
    }

    // ── Trazas de firmas e incidentes (D-10 sobre el elemento aparte de D-8) ──
    const trazasPorTabla = [
        { tabla: process.env.SIGNATURES_TABLE, campoClave: 'signatureId', nombre: 'firma' },
        { tabla: process.env.INCIDENTS_TABLE, campoClave: 'incidentId', nombre: 'incidente' },
    ];

    for (const { tabla, campoClave, nombre } of trazasPorTabla) {
        const trazas = await doc.send(new ScanCommand({
            TableName: tabla,
            FilterExpression: 'contains(#clave, :sufijo)',
            ExpressionAttributeNames: { '#clave': campoClave },
            ExpressionAttributeValues: { ':sufijo': '#traza' },
        }));

        for (const t of trazas.Items || []) {
            if (t.cifrado) continue; // ya migrada
            console.log(`  Traza de ${nombre} ${t[campoClave]}`);
            if (!confirmar) continue;

            const { [campoClave]: _clave, creadoEn: _creado, ...datos } = t;
            const cifrado = await cifradoCampo.cifrarSobre(datos);

            const camposAQuitar = Object.keys(datos);
            const nombresAtributos = Object.fromEntries(camposAQuitar.map((k, i) => [`#q${i}`, k]));
            const removeExpr = camposAQuitar.length
                ? ` REMOVE ${camposAQuitar.map((_, i) => `#q${i}`).join(', ')}`
                : '';

            await doc.send(new UpdateCommand({
                TableName: tabla,
                Key: { [campoClave]: t[campoClave] },
                UpdateExpression: `SET cifrado = :c${removeExpr}`,
                ...(camposAQuitar.length ? { ExpressionAttributeNames: nombresAtributos } : {}),
                ExpressionAttributeValues: { ':c': cifrado },
            }));
            console.log('    reparada');
        }
    }

    // ── Arreglos embebidos: documentos, actividades y solicitudes ───────────
    //
    // Acá "leer y reparar" no alcanza igual que en Personas: un documento se
    // vuelve a guardar cuando alguien lo firma o lo reasigna, pero uno que nadie
    // toca puede quedarse años con el RUT en claro. Y los snapshots de
    // `versiones[]` no se reescriben NUNCA, así que arrastrarían el RUT viejo
    // para siempre. Por eso la reparación los recorre explícitamente.
    const conLlaveDe = async (tenantId) => (tenantId ? llaveDeTenant(tenantId, PROPOSITOS.RUT_PERSONAS) : null);

    const cifrarEntradas = (arr, campos, llave) => {
        if (!Array.isArray(arr)) return { valor: arr, cambios: 0 };
        let cambios = 0;
        const valor = arr.map((entrada) => {
            if (!entrada || typeof entrada !== 'object') return entrada;
            const nueva = { ...entrada };
            for (const campo of campos) {
                if (nueva[campo] === undefined || nueva[`${campo}Cifrado`] !== undefined) continue;
                nueva[`${campo}Cifrado`] = cifradoCampo.cifrarConLlaveDatos(nueva[campo], llave);
                delete nueva[campo];
                cambios += 1;
            }
            return nueva;
        });
        return { valor, cambios };
    };

    const cifrarObjeto = (obj, campos, llave) => {
        if (!obj || typeof obj !== 'object') return { valor: obj, cambios: 0 };
        let cambios = 0;
        const valor = { ...obj };
        for (const campo of campos) {
            if (valor[campo] === undefined || valor[`${campo}Cifrado`] !== undefined) continue;
            valor[`${campo}Cifrado`] = cifradoCampo.cifrarConLlaveDatos(valor[campo], llave);
            delete valor[campo];
            cambios += 1;
        }
        return { valor, cambios };
    };

    const TABLAS_EMBEBIDAS = [
        {
            tabla: process.env.DOCUMENTS_TABLE, clave: 'documentId', nombre: 'documento',
            reparar: (item, llave) => {
                const asig = cifrarEntradas(item.asignaciones, ['rut'], llave);
                const firmas = cifrarEntradas(item.firmas, ['rut', 'ip'], llave);
                // Los snapshots archivados llevan su propia copia de los dos.
                let cambiosVersiones = 0;
                const versiones = Array.isArray(item.versiones) ? item.versiones.map((v) => {
                    const fa = cifrarEntradas(v.firmasArchivadas, ['rut', 'ip'], llave);
                    const aa = cifrarEntradas(v.asignacionesArchivadas, ['rut'], llave);
                    const fv = cifrarEntradas(v.firmas, ['rut', 'ip'], llave);
                    cambiosVersiones += fa.cambios + aa.cambios + fv.cambios;
                    return {
                        ...v,
                        ...(v.firmasArchivadas !== undefined ? { firmasArchivadas: fa.valor } : {}),
                        ...(v.asignacionesArchivadas !== undefined ? { asignacionesArchivadas: aa.valor } : {}),
                        ...(v.firmas !== undefined ? { firmas: fv.valor } : {}),
                    };
                }) : item.versiones;

                const cambios = asig.cambios + firmas.cambios + cambiosVersiones;
                if (!cambios) return null;
                return {
                    campos: {
                        ...(item.asignaciones !== undefined ? { asignaciones: asig.valor } : {}),
                        ...(item.firmas !== undefined ? { firmas: firmas.valor } : {}),
                        ...(item.versiones !== undefined ? { versiones } : {}),
                    },
                    cambios,
                };
            },
        },
        {
            tabla: process.env.ACTIVITIES_TABLE, clave: 'activityId', nombre: 'actividad',
            reparar: (item, llave) => {
                const asis = cifrarEntradas(item.asistentes, ['rut'], llave);
                const relator = cifrarObjeto(item.firmaRelator, ['rut'], llave);
                const cambios = asis.cambios + relator.cambios;
                if (!cambios) return null;
                return {
                    campos: {
                        ...(item.asistentes !== undefined ? { asistentes: asis.valor } : {}),
                        ...(item.firmaRelator ? { firmaRelator: relator.valor } : {}),
                    },
                    cambios,
                };
            },
        },
        {
            tabla: process.env.SIGNATURE_REQUESTS_TABLE, clave: 'requestId', nombre: 'solicitud',
            reparar: (item, llave) => {
                const trab = cifrarEntradas(item.trabajadores, ['rut'], llave);
                const solicitante = cifrarObjeto(item, ['solicitanteRut'], llave);
                const cambios = trab.cambios + solicitante.cambios;
                if (!cambios) return null;
                return {
                    campos: {
                        ...(item.trabajadores !== undefined ? { trabajadores: trab.valor } : {}),
                        ...(solicitante.cambios
                            ? { solicitanteRutCifrado: solicitante.valor.solicitanteRutCifrado }
                            : {}),
                    },
                    quitar: solicitante.cambios ? ['solicitanteRut'] : [],
                    cambios,
                };
            },
        },
    ];

    // Encuestas: el RUT con la llave de identificación y las respuestas con la
    // de salud, y las respuestas SIEMPRE, aunque estén vacías.
    TABLAS_EMBEBIDAS.push({
        tabla: process.env.SURVEYS_TABLE, clave: 'surveyId', nombre: 'encuesta',
        reparar: (item, llave, llaveSalud) => {
            let cambios = 0;
            const recipients = Array.isArray(item.recipients) ? item.recipients.map((r) => {
                const nuevo = { ...r };
                if (nuevo.rut !== undefined && nuevo.rutCifrado === undefined) {
                    nuevo.rutCifrado = cifradoCampo.cifrarConLlaveDatos(nuevo.rut, llave);
                    delete nuevo.rut;
                    cambios += 1;
                }
                if (nuevo.responsesCifradas === undefined) {
                    nuevo.responsesCifradas = cifradoCampo.cifrarConLlaveDatosSiempre(
                        nuevo.responses || [], llaveSalud);
                    delete nuevo.responses;
                    cambios += 1;
                }
                return nuevo;
            }) : item.recipients;

            // `audience.ruts` es una copia redundante de la audiencia.
            let audience = item.audience;
            if (Array.isArray(item.audience?.ruts) && item.audience.ruts.some((r) => typeof r === 'string')) {
                audience = {
                    ...item.audience,
                    ruts: item.audience.ruts.map((r) => (typeof r === 'string'
                        ? cifradoCampo.cifrarConLlaveDatos(r, llave) : r)),
                };
                cambios += 1;
            }

            if (!cambios) return null;
            return {
                campos: {
                    ...(item.recipients !== undefined ? { recipients } : {}),
                    ...(item.audience !== undefined ? { audience } : {}),
                },
                cambios,
            };
        },
    });

    for (const { tabla, clave, nombre, reparar } of TABLAS_EMBEBIDAS) {
        const items = await doc.send(new ScanCommand({ TableName: tabla }));

        for (const item of items.Items || []) {
            const llave = await conLlaveDe(item.tenantId);
            if (!llave) continue; // sin empresa no hay llave: no es un registro reparable
            const llaveSalud = await llaveDeTenant(item.tenantId, PROPOSITOS.SALUD);
            const plan = reparar(item, llave, llaveSalud);
            if (!plan) continue;

            console.log(`  ${nombre} ${item[clave]} — ${plan.cambios} valor(es) en claro`);
            if (!confirmar) continue;

            const campos = Object.keys(plan.campos);
            const nombres = Object.fromEntries(campos.map((c, i) => [`#c${i}`, c]));
            const valores = Object.fromEntries(campos.map((c, i) => [`:c${i}`, plan.campos[c]]));
            const quitar = plan.quitar || [];
            quitar.forEach((c, i) => { nombres[`#q${i}`] = c; });

            await doc.send(new UpdateCommand({
                TableName: tabla,
                Key: { [clave]: item[clave] },
                UpdateExpression: `SET ${campos.map((_, i) => `#c${i} = :c${i}`).join(', ')}`
                    + (quitar.length ? ` REMOVE ${quitar.map((_, i) => `#q${i}`).join(', ')}` : ''),
                ExpressionAttributeNames: nombres,
                ExpressionAttributeValues: valores,
            }));
            console.log('    reparado');
        }
    }

    console.log(confirmar ? '\n  Listo.\n' : '\n  Ensayo terminado. Repite con --confirmar para escribir.\n');
})().catch((err) => {
    console.error(`\n  Falló: ${err.message}\n`);
    process.exit(1);
});
