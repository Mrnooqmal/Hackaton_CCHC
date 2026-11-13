#!/usr/bin/env node
/**
 * Siembra datos de ejemplo en **dev** para poder probar interfaces que agregan
 * varias obras, como el inicio de la gestión de empresa.
 *
 * ── Por qué existe, si `sembrar-ambiente.js` se niega a hacer esto ───────────
 *
 * `sembrar-ambiente.js` deja un ambiente listo para producción y no inventa
 * nada, con un argumento que sigue siendo cierto: un ambiente con datos de
 * demostración es uno donde nadie distingue lo real de lo inventado. Este
 * script hace exactamente lo contrario, y por eso está separado y no comparte
 * una línea con él:
 *
 *   - Solo corre con `--stage dev`. Con cualquier otro valor se niega y sale.
 *   - La empresa se llama con la marca `DEMO datos de ejemplo`, visible en toda
 *     la aplicación: nadie la confunde con una empresa real.
 *   - Se borra entera con `--borrar`, con el mismo recorrido que la prueba de
 *     punta a punta: busca por identificador en todas las tablas y los dos
 *     buckets, y solo termina bien con un recorrido completo en cero.
 *
 * La marca y el archivo de pendientes son los del perfil `DEMO` de
 * `e2e/empresa-desechable.js`. Son distintos de los del perfil `E2E` a
 * propósito: la purga de la prueba de punta a punta borra toda empresa de SU
 * marca con más de una hora, y estos datos tienen que sobrevivir a eso.
 *
 * ── Todo se crea por la API, nunca escribiendo en DynamoDB ───────────────────
 *
 * Es más lento y es la única forma correcta. Las invariantes del modelo viven
 * en el código, no en la base: `Persona.toDynamoItem()` lanza si falta
 * `vigilanciaSaludCifrada` ("la salud nunca se escribe en claro"), el RUT no
 * existe en claro (es `rutCifrado` + `rutHmac`), `obraIds` se deriva de las
 * asignaciones y las firmas llevan token con suma de comprobación. Un registro
 * escrito a mano quedaría plausible y corrupto, y una interfaz alimentada con
 * eso mentiría de formas que después se persiguen como errores de la interfaz.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 *
 *   # Ensayo: dice lo que haría y no escribe nada. Es lo que hace por omisión.
 *   AWS_PROFILE=<perfil> node scripts/sembrar-demo-dev.js --stage dev
 *
 *   # Siembra real.
 *   AWS_PROFILE=<perfil> node scripts/sembrar-demo-dev.js --stage dev --confirmar
 *
 *   # Borrar una empresa de ejemplo (solo las de la marca DEMO).
 *   AWS_PROFILE=<perfil> node scripts/sembrar-demo-dev.js --stage dev --borrar <tenantId>
 *
 *   # Borrar lo que haya quedado de una corrida interrumpida.
 *   AWS_PROFILE=<perfil> node scripts/sembrar-demo-dev.js --stage dev --limpiar-pendientes
 *
 * Al terminar imprime el RUT del administrador y la contraseña, que es lo que
 * se necesita para entrar al frontend de dev y mirar las pantallas.
 *
 * ── Qué siembra, y por qué así ───────────────────────────────────────────────
 *
 * Seis obras con dotaciones muy distintas (de 12 a 134 personas), porque la
 * exigibilidad de los ítems del FUF depende de la dotación: una obra de 12 no
 * tiene comité paritario que acreditar, y un panel que la castigue por eso
 * miente. Y documentación **desigual a propósito**, para que se distinga una
 * brecha de obra de una práctica de empresa: hay un tipo que falta en cinco de
 * seis obras, otro en cuatro, otro en tres, otros en dos y uno en una sola.
 */

const crypto = require('crypto');
const path = require('path');
const { ambiente, crearCliente } = require('./e2e/cliente');
const desechable = require('./e2e/empresa-desechable');
const { pdfDeUnaPagina } = require('./e2e/pdf-minimo');

const PERFIL = desechable.PERFILES.DEMO;

// ─── Argumentos ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const valorDe = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const tiene = (flag) => args.includes(flag);

const stage = valorDe('--stage');
const confirmar = tiene('--confirmar');
const borrarSolo = valorDe('--borrar');
const limpiarPendientes = tiene('--limpiar-pendientes');
const PASSWORD = valorDe('--password') || 'Demo.2026';
const PIN = valorDe('--pin') || '4827';

/**
 * La guarda que importa: este script inventa datos, así que fuera de dev no
 * tiene nada que hacer. No alcanza con documentarlo.
 */
function exigirDev(stage) {
    if (stage !== 'dev') {
        console.error('');
        console.error('  Este script solo corre en dev.');
        console.error(`  --stage recibió ${stage ? `"${stage}"` : 'nada'}, y solo acepta "dev".`);
        console.error('');
        console.error('  Siembra datos inventados: en producción no se usa nunca. Para dejar un');
        console.error('  ambiente listo para producción, con la empresa y su administrador reales,');
        console.error('  está scripts/sembrar-ambiente.js.');
        console.error('');
        process.exit(2);
    }
}

// ─── Catálogo de lo que se siembra ───────────────────────────────────────────
//
// Es data, no código: se lee de corrido y se cambia sin tocar la lógica.

const OBRAS = [
    { clave: 'condes',  nombre: 'Edificio Las Condes 1420',      codigo: 'LC-1420', dotacion: 86,  region: 'Metropolitana de Santiago', comuna: 'Las Condes', mandante: 'Inmobiliaria Altura SpA',  tieneMaquinaria: true,  faenaCompartida: false },
    { clave: 'pinos',   nombre: 'Obra Los Pinos',                codigo: 'LP-002',  dotacion: 42,  region: 'Coquimbo',                  comuna: 'La Serena',  mandante: 'Inmobiliaria Pacífico Ltda.', tieneMaquinaria: true,  faenaCompartida: false },
    { clave: 'clinica', nombre: 'Ampliación Clínica Maipú',      codigo: 'ACM-07',  dotacion: 134, region: 'Metropolitana de Santiago', comuna: 'Maipú',      mandante: 'Red Salud Maipú S.A.',     tieneMaquinaria: true,  faenaCompartida: true  },
    { clave: 'quilpue', nombre: 'Conjunto Habitacional Quilpué', codigo: 'CHQ-14',  dotacion: 58,  region: 'Valparaíso',                comuna: 'Quilpué',    mandante: 'SERVIU Valparaíso',        tieneMaquinaria: false, faenaCompartida: true  },
    { clave: 'lampa',   nombre: 'Bodega Industrial Lampa',       codigo: 'BIL-03',  dotacion: 23,  region: 'Metropolitana de Santiago', comuna: 'Lampa',      mandante: 'Logística Andes SpA',      tieneMaquinaria: true,  faenaCompartida: false },
    { clave: 'oficina', nombre: 'Oficina Central',               codigo: 'OF-001',  dotacion: 12,  region: 'Los Ríos',                  comuna: 'Valdivia',   mandante: null,                       tieneMaquinaria: false, faenaCompartida: false },
];

/**
 * Documentos por obra, repartidos para que el panel pueda distinguir una brecha
 * de obra de una práctica de empresa. La última columna es la lectura que tiene
 * que salir del dato.
 *
 *   en todas         → base acreditada
 *   falta en 1 de 6  → gestión de obra
 *   falta en 2 de 6  → gestión de obra
 *   falta en 3 de 6  → práctica de empresa (el umbral)
 *   falta en 4 de 6  → práctica de empresa
 *   falta en 5 de 6  → práctica de empresa, y la más urgente
 */
const TODAS = OBRAS.map((o) => o.clave);
const DOCUMENTOS = [
    { tipo: 'POLITICA_SSO',             titulo: 'Política de Seguridad y Salud Ocupacional',  en: TODAS },
    { tipo: 'MIPER',                    titulo: 'Matriz de identificación de peligros',       en: TODAS },
    { tipo: 'MAPA_RIESGOS',             titulo: 'Mapa de riesgos de la faena',                en: TODAS },
    { tipo: 'VIGILANCIA_AMBIENTAL',     titulo: 'Programa de vigilancia ambiental',           en: ['condes', 'pinos', 'clinica', 'quilpue', 'lampa'] },
    { tipo: 'PUBLICACION_MAPA_RIESGOS', titulo: 'Evidencia de publicación del mapa',          en: ['condes', 'pinos', 'clinica', 'quilpue'] },
    { tipo: 'COORDINACION_ENTIDADES',   titulo: 'Procedimiento de coordinación en faena',     en: ['condes', 'pinos', 'clinica', 'quilpue'] },
    { tipo: 'PROCEDIMIENTO_TRABAJO',    titulo: 'Procedimiento de trabajo seguro en altura',  en: ['condes', 'pinos', 'clinica'] },
    { tipo: 'REGLAMENTO_INTERNO',       titulo: 'Reglamento interno de orden, higiene y seguridad', en: ['condes', 'pinos'] },
    { tipo: 'PLAN_EMERGENCIAS',         titulo: 'Plan de gestión y respuesta ante emergencias', en: ['condes'] },
];

/**
 * Equipo por obra. Los cargos salen del catálogo del DS 44 que siembra el alta.
 *
 * El ORDEN importa: el supervisor y el prevencionista van antes que los
 * trabajadores, porque una persona trabajadora no se puede asignar a una obra
 * que ya tiene supervisores sin indicar de qué cuadrilla es
 * (`supervisorPersonaId`, handlers/personas-module/handler.js).
 */
const EQUIPO = [
    { rol: 'jefe_obra',      nombre: 'Gabriel',  apellidoPaterno: 'Hinojosa', apellidoMaterno: 'Gutiérrez', cargos: ['JEFE_OBRA'] },
    { rol: 'prevencionista', nombre: 'Esteban',  apellidoPaterno: 'Maldonado', apellidoMaterno: 'Reyes',    cargos: ['PREVENCIONISTA'] },
    { rol: 'supervisor',     nombre: 'Felipe',   apellidoPaterno: 'Flores',   apellidoMaterno: 'Donoso',    cargos: ['SUPERVISOR'] },
    { rol: 'trabajador',     nombre: 'Matías',   apellidoPaterno: 'Neira',    apellidoMaterno: 'Chacón',    cargos: ['CARPINTERO'] },
    { rol: 'trabajador',     nombre: 'Sebastián', apellidoPaterno: 'Osorio',  apellidoMaterno: 'Andrade',   cargos: ['ALBANIL'] },
];

/**
 * Entregas de EPP. `motivo` convierte el dato en un insight: un elemento que se
 * repone seguido por desgaste apunta al proveedor, no al uso. Los motivos
 * válidos son los de `MOTIVOS_REPOSICION` en lib/services/EppService.js.
 *
 * Cada ítem es un objeto, y el nombre del elemento va en `descripcion`: es el
 * único campo que `EppService.crearEntrega` lee de ahí. Una cadena suelta se
 * guarda con descripción vacía, sin error, y la entrega queda inservible como
 * evidencia del Art. 13.
 */
const ENTREGAS_EPP = [
    {
        items: [
            { descripcion: 'Casco de seguridad clase B', cantidad: 1 },
            { descripcion: 'Zapatos de seguridad punta de acero', cantidad: 1, talla: '42' },
            { descripcion: 'Guantes anticorte nivel 5', cantidad: 2 },
        ],
        reposicion: false, motivo: null,
    },
    { items: [{ descripcion: 'Guantes anticorte nivel 5', cantidad: 2 }], reposicion: true, motivo: 'desgaste' },
    { items: [{ descripcion: 'Guantes anticorte nivel 5', cantidad: 2 }], reposicion: true, motivo: 'desgaste' },
    { items: [{ descripcion: 'Lentes de seguridad claros', cantidad: 1 }], reposicion: true, motivo: 'perdida' },
    { items: [{ descripcion: 'Protector auditivo tipo copa', cantidad: 1 }], reposicion: true, motivo: 'desgaste' },
];

/**
 * Accidentes, para que la siniestralidad (Arts. 73-75) deje de ser cero y el
 * cruce "cumple y accidenta" tenga con qué contrastar.
 *
 * Se reparten desigual a propósito: la obra con mejor documentación es la que
 * más días pierde. Es el caso que el panel tiene que saber mostrar — una carpeta
 * impecable no es lo mismo que una obra segura.
 */
const ACCIDENTES = [
    { obra: 'condes',  gravedad: 'grave', diasPerdidos: 21, descripcion: 'Caída desde andamio en fachada norte, fractura de tobillo.' },
    { obra: 'condes',  gravedad: 'leve',  diasPerdidos: 3,  descripcion: 'Corte en mano al manipular perfil metálico sin guantes.' },
    { obra: 'clinica', gravedad: 'leve',  diasPerdidos: 5,  descripcion: 'Golpe en hombro por carga suspendida mal estrobada.' },
    { obra: 'lampa',   gravedad: 'leve',  diasPerdidos: 2,  descripcion: 'Esguince de muñeca al descargar sacos de cemento.' },
];

/**
 * Medidas prescritas (Art. 70). El estado lo deriva el servidor del plazo, así
 * que una con plazo pasado y sin implementar queda `Vencida` sin que el script
 * lo diga: se siembran plazos a propósito en el pasado y en el futuro.
 */
const PRESCRIPCIONES = [
    { obra: 'lampa',   origen: 'OrganismoFiscalizador',  diasPlazo: -45, descripcion: 'Instalar barandas en el perímetro del segundo nivel.' },
    { obra: 'quilpue', origen: 'OrganismoAdministrador', diasPlazo: -20, descripcion: 'Habilitar comedor con lavamanos y agua potable.' },
    { obra: 'clinica', origen: 'ComiteParitario',        diasPlazo: -8,  descripcion: 'Señalizar la zona de circulación de maquinaria.' },
    { obra: 'condes',  origen: 'DepartamentoPrevencion', diasPlazo: 25,  descripcion: 'Actualizar el procedimiento de trabajo en altura.' },
    { obra: 'pinos',   origen: 'OrganismoFiscalizador',  diasPlazo: 60,  descripcion: 'Reponer extintores vencidos en bodega de materiales.' },
];

/**
 * Actividades por obra. Se firman para que dejen de ser solo "programadas": una
 * actividad sin asistencia no sirve para calcular la adherencia al programa.
 *
 * `CHARLA_5MIN` y `ART` exigen planificación con tema tratado
 * (`TIPOS_CON_PLANIFICACION` en lib/catalogos-actividad.js). El tema va como
 * texto libre (`tema.otro`) y no como código de catálogo: así no depende de que
 * la empresa tenga cargado un catálogo propio de temas.
 */
const ACTIVIDADES = [
    {
        tipo: 'CHARLA_5MIN', titulo: 'Charla diaria: orden y aseo en la faena',
        planificacion: { tema: { otro: 'Orden y aseo del puesto de trabajo' }, tipoTrabajo: 'interior', condicionClimatica: 'despejado' },
    },
    {
        tipo: 'CHARLA_5MIN', titulo: 'Charla diaria: uso correcto del arnés',
        planificacion: { tema: { otro: 'Uso y revisión del arnés de seguridad' }, tipoTrabajo: 'exterior', condicionClimatica: 'nublado', protectorSolar: true },
    },
    {
        tipo: 'ART', titulo: 'Análisis de riesgos: trabajo en altura',
        planificacion: { tema: { otro: 'Trabajo en altura sobre andamio' }, tipoTrabajo: 'exterior', condicionClimatica: 'parcial', protectorSolar: true },
    },
    { tipo: 'INSPECCION', titulo: 'Inspección de andamios y plataformas' },
];

// ─── Utilidades ──────────────────────────────────────────────────────────────

const log = (...a) => console.log('  ', ...a);
const paso = (t) => console.log(`\n  ${t}`);

/** Falla ruidosamente: a medio sembrar, seguir solo acumula confusión. */
function exigir(ok, que, respuesta) {
    if (ok) return;
    const detalle = respuesta
        ? ` (HTTP ${respuesta.status}: ${JSON.stringify(respuesta.cuerpo).slice(0, 240)})`
        : '';
    throw new Error(`${que}${detalle}`);
}

/**
 * Primer ingreso completo: contraseña inicial (D-13), cambio, PIN y
 * enrolamiento. Es el mismo camino que recorre una persona desde el frontend, y
 * el mismo que comprueba la prueba de punta a punta.
 *
 * El PIN se deja puesto porque sin él no se puede firmar nada, y una actividad
 * sin firmas no sirve para probar el panel.
 */
async function primerIngreso(c, { rut, personaId }) {
    const inicial = desechable.passwordInicial(rut);

    const login = await c.pedir('POST', '/auth/login', { cuerpo: { rut, password: inicial } });
    exigir(login.status === 200 && login.cuerpo?.data?.token, `No se pudo entrar con el RUT ${rut}`, login);
    const tokenInicial = login.cuerpo.data.token;

    const cambio = await c.pedir('POST', '/auth/change-password', {
        token: tokenInicial,
        cuerpo: { passwordNuevo: PASSWORD, confirmarPassword: PASSWORD },
    });
    exigir(cambio.status === 200, `No se pudo cambiar la contraseña de ${rut}`, cambio);
    const token = cambio.cuerpo?.data?.token || tokenInicial;

    // Enseguida, sin esperar: dentro de los 60 s del caché del autorizador.
    const pin = await c.pedir('POST', `/personas/${personaId}/set-pin`, { token, cuerpo: { pin: PIN } });
    exigir(pin.status === 200, `No se pudo poner el PIN de ${rut}`, pin);

    const enrol = await c.pedir('POST', `/personas/${personaId}/enrolamiento`, { token, cuerpo: { pin: PIN } });
    exigir(enrol.status === 200, `No se pudo completar el enrolamiento de ${rut}`, enrol);

    return token;
}

/**
 * Sube un PDF y devuelve su clave en S3, por el mismo camino que el navegador:
 * URL prefirmada, PUT con la huella, y confirmación.
 *
 * Sin archivo no hay documento. El motor de completitud lo dice explícito
 * (`tieneArchivo`: "sin archivo no hay documento"), así que un documento sembrado
 * sin adjunto no acredita nada y las pantallas lo muestran como pendiente. La
 * primera corrida de este script sembró 79 documentos sin archivo y el panel
 * quedó sin una sola brecha que mostrar.
 *
 * La huella SHA-256 no es opcional: el bucket de evidencia tiene Object Lock y S3
 * rechaza toda subida que no la traiga, en el header y con el mismo valor con el
 * que el servidor firmó la URL.
 */
async function subirPdf(c, { token, tenantId, titulo, lineas, nombreArchivo }) {
    const archivo = pdfDeUnaPagina(titulo, lineas);
    const huella = crypto.createHash('sha256').update(archivo).digest('base64');

    const pre = await c.pedir('POST', '/uploads/presigned-url', {
        token,
        cuerpo: {
            fileName: nombreArchivo,
            fileType: 'application/pdf',
            fileSize: archivo.length,
            categoria: 'documentos',
            tenantId,
            checksumSha256: huella,
        },
    });
    exigir(pre.status === 200 && pre.cuerpo?.data?.uploadUrl, `No se pudo prefirmar la subida de "${titulo}"`, pre);

    const puesto = await fetch(pre.cuerpo.data.uploadUrl, {
        method: 'PUT',
        body: archivo,
        headers: { 'Content-Type': 'application/pdf', 'x-amz-checksum-sha256': huella },
    });
    exigir(puesto.ok, `S3 rechazó el archivo de "${titulo}" (HTTP ${puesto.status})`);

    const conf = await c.pedir('POST', '/uploads/confirm', {
        token,
        cuerpo: {
            fileKey: pre.cuerpo.data.fileKey,
            fileName: nombreArchivo,
            fileType: 'application/pdf',
            fileSize: archivo.length,
        },
    });
    exigir(conf.status === 200, `No se pudo confirmar la subida de "${titulo}"`, conf);

    return { s3Key: pre.cuerpo.data.fileKey, archivoNombre: nombreArchivo };
}

// ─── Siembra ─────────────────────────────────────────────────────────────────

async function sembrar(stage) {
    const { api, origen } = ambiente(stage);
    const c = crearCliente({ api, origen });
    log(`API:    ${api}`);
    log(`Origen: ${origen}`);

    paso('Empresa y administrador');
    const empresa = await desechable.crearEmpresa(stage, {
        perfil: PERFIL,
        nombreEmpresa: 'Constructora Panorama',
        admin: { nombre: 'Lucía', apellidoPaterno: 'Vergara', apellidoMaterno: 'Soto' },
    });
    log(`Empresa: ${empresa.nombre}`);
    log(`tenantId: ${empresa.tenantId}`);

    const creadas = [empresa.adminPersonaId];
    const tokenAdmin = await primerIngreso(c, { rut: empresa.adminRut, personaId: empresa.adminPersonaId });
    log(`Administrador listo: ${empresa.adminRut}`);

    paso(`Obras (${OBRAS.length})`);
    const obraPorClave = {};
    for (const o of OBRAS) {
        const r = await c.pedir('POST', '/obras', {
            token: tokenAdmin,
            cuerpo: {
                nombre: o.nombre,
                codigo: o.codigo,
                comuna: o.comuna,
                region: o.region,
                mandante: o.mandante,
                // Número, no bandera: es la dotación que declara la entidad
                // empleadora, y de ella depende qué ítems del FUF son exigibles.
                dotacionDeclarada: o.dotacion,
                dotacionObservacion: 'Dotación de ejemplo para probar interfaces.',
                tieneMaquinaria: o.tieneMaquinaria,
                faenaCompartida: o.faenaCompartida,
            },
        });
        const obraId = r.cuerpo?.data?.obra?.obraId || r.cuerpo?.data?.obraId;
        exigir((r.status === 201 || r.status === 200) && obraId, `No se pudo crear la obra "${o.nombre}"`, r);
        obraPorClave[o.clave] = obraId;
        log(`${o.nombre} — dotación ${o.dotacion} — ${obraId}`);
    }

    paso(`Personal (${EQUIPO.length} por obra)`);
    const personasPorObra = {};
    for (const o of OBRAS) {
        personasPorObra[o.clave] = [];
        // Se llenan al crear al supervisor y al prevencionista de esta obra, y se
        // usan para la cuadrilla de los trabajadores que vienen después.
        let supervisorId = null;
        let prevencionistaId = null;
        for (const miembro of EQUIPO) {
            const rut = desechable.rutAlAzar(10_000_000, 25_000_000);
            const alta = await c.pedir('POST', '/personas', {
                token: tokenAdmin,
                cuerpo: {
                    rut,
                    nombre: miembro.nombre,
                    apellidoPaterno: miembro.apellidoPaterno,
                    apellidoMaterno: miembro.apellidoMaterno,
                    email: desechable.CORREO_PRUEBAS,
                    rol: miembro.rol,
                    tieneAccesoWeb: true,
                },
            });
            const personaId = alta.cuerpo?.data?.persona?.personaId;
            exigir(alta.status === 201 && personaId, `No se pudo dar de alta a ${miembro.nombre} en ${o.nombre}`, alta);
            creadas.push(personaId);

            if (miembro.rol === 'supervisor') supervisorId = personaId;
            if (miembro.rol === 'prevencionista') prevencionistaId = personaId;

            const asig = await c.pedir('POST', `/personas/${personaId}/asignaciones`, {
                token: tokenAdmin,
                cuerpo: {
                    obraId: obraPorClave[o.clave],
                    cargos: miembro.cargos,
                    // Solo la persona trabajadora pertenece a una cuadrilla.
                    ...(miembro.rol === 'trabajador'
                        ? { supervisorPersonaId: supervisorId, prevencionistaPersonaId: prevencionistaId }
                        : {}),
                },
            });
            exigir(asig.status === 200 || asig.status === 201, `No se pudo asignar a ${miembro.nombre} a ${o.nombre}`, asig);

            const token = await primerIngreso(c, { rut, personaId });
            personasPorObra[o.clave].push({ personaId, rut, token, rol: miembro.rol });
        }
        log(`${o.nombre}: ${personasPorObra[o.clave].length} personas`);
    }

    paso('Documentos con archivo, desiguales a propósito');
    for (const doc of DOCUMENTOS) {
        for (const clave of doc.en) {
            const obra = OBRAS.find((o) => o.clave === clave);
            const adjunto = await subirPdf(c, {
                token: tokenAdmin,
                tenantId: empresa.tenantId,
                titulo: doc.titulo,
                lineas: [
                    `Obra: ${obra.nombre}`,
                    `Tipo: ${doc.tipo}`,
                    'Datos de ejemplo del ambiente de desarrollo. No es un documento real.',
                ],
                nombreArchivo: `${doc.tipo.toLowerCase()}-${clave}.pdf`,
            });
            const r = await c.pedir('POST', '/documents', {
                token: tokenAdmin,
                cuerpo: {
                    tipo: doc.tipo,
                    titulo: doc.titulo,
                    obraId: obraPorClave[clave],
                    descripcion: 'Documento de ejemplo para probar interfaces.',
                    clasificacion: 'obra',
                    s3Key: adjunto.s3Key,
                    archivoNombre: adjunto.archivoNombre,
                },
            });
            exigir(r.status === 201 || r.status === 200, `No se pudo crear ${doc.tipo} en ${clave}`, r);
        }
        const faltan = OBRAS.length - doc.en.length;
        const lectura = faltan === 0 ? 'en todas'
            : faltan >= 3 ? `falta en ${faltan} de ${OBRAS.length} — práctica de empresa`
                : `falta en ${faltan} de ${OBRAS.length} — gestión de obra`;
        log(`${doc.tipo}: ${lectura}`);
    }

    paso('Entregas de EPP');
    let entregas = 0;
    for (const o of OBRAS) {
        const trabajadores = personasPorObra[o.clave].filter((p) => p.rol === 'trabajador');
        for (const [i, entrega] of ENTREGAS_EPP.entries()) {
            const quien = trabajadores[i % trabajadores.length];
            if (!quien) continue;
            const r = await c.pedir('POST', `/personas/${quien.personaId}/epp`, {
                token: tokenAdmin,
                cuerpo: {
                    obraId: obraPorClave[o.clave],
                    itemsEntregados: entrega.items,
                    esReposicion: entrega.reposicion,
                    motivoReposicion: entrega.motivo,
                },
            });
            exigir(r.status === 201 || r.status === 200, `No se pudo registrar la entrega de EPP en ${o.nombre}`, r);
            entregas += 1;
        }
    }
    log(`${entregas} entregas, con reposiciones y su motivo`);

    paso('Actividades, con asistencia firmada');
    let firmas = 0;
    for (const o of OBRAS) {
        const equipo = personasPorObra[o.clave];
        const relator = equipo.find((p) => p.rol === 'prevencionista') || equipo[0];
        for (const act of ACTIVIDADES) {
            const r = await c.pedir('POST', '/activities', {
                token: tokenAdmin,
                cuerpo: {
                    tipo: act.tipo,
                    titulo: act.titulo,
                    relatorId: relator.personaId,
                    obraId: obraPorClave[o.clave],
                    fecha: new Date().toISOString().slice(0, 10),
                    duracion: 15,
                    ...(act.planificacion ? { planificacion: act.planificacion } : {}),
                },
            });
            const activityId = r.cuerpo?.data?.activity?.activityId || r.cuerpo?.data?.activityId;
            exigir((r.status === 201 || r.status === 200) && activityId, `No se pudo crear la actividad "${act.titulo}" en ${o.nombre}`, r);

            // La firma con PIN es individual: una persona por llamada, con su
            // propio PIN. Así la actividad deja de estar solo "programada" y la
            // adherencia al programa se puede calcular.
            for (const quien of equipo) {
                const f = await c.pedir('POST', `/activities/${activityId}/attendance`, {
                    token: quien.token,
                    cuerpo: { personaId: quien.personaId, pin: PIN },
                });
                if (f.status === 200 || f.status === 201) firmas += 1;
                else log(`aviso: no firmó ${quien.rut} en "${act.titulo}" (HTTP ${f.status})`);
            }
        }
        log(`${o.nombre}: ${ACTIVIDADES.length} actividades`);
    }
    log(`${firmas} asistencias firmadas`);

    paso('Accidentes');
    for (const acc of ACCIDENTES) {
        const equipo = personasPorObra[acc.obra];
        const quien = equipo.find((x) => x.rol === 'trabajador') || equipo[0];
        const r = await c.pedir('POST', '/incidents', {
            token: tokenAdmin,
            cuerpo: {
                tipo: 'accidente',
                obraId: obraPorClave[acc.obra],
                centroTrabajo: OBRAS.find((o) => o.clave === acc.obra).nombre,
                trabajador: { nombre: 'Trabajador de ejemplo', rut: quien.rut, genero: 'masculino', cargo: 'Carpintero' },
                fecha: new Date().toISOString().slice(0, 10),
                hora: '10:30',
                descripcion: acc.descripcion,
                gravedad: acc.gravedad,
                diasPerdidos: acc.diasPerdidos,
            },
        });
        exigir(r.status === 201 || r.status === 200, `No se pudo reportar el accidente en ${acc.obra}`, r);
    }
    log(`${ACCIDENTES.length} accidentes, con gravedad y días perdidos`);

    paso('Medidas prescritas (Art. 70)');
    const hoy = Date.now();
    let vencidas = 0;
    for (const pr of PRESCRIPCIONES) {
        const plazo = new Date(hoy + pr.diasPlazo * 86_400_000).toISOString().slice(0, 10);
        const r = await c.pedir('POST', `/estructura/prescripciones?tenantId=${empresa.tenantId}`, {
            token: tokenAdmin,
            cuerpo: {
                obraId: obraPorClave[pr.obra],
                origen: pr.origen,
                // Prescrita bastante antes del plazo, como en la realidad.
                fechaPrescripcion: new Date(hoy + (pr.diasPlazo - 30) * 86_400_000).toISOString().slice(0, 10),
                descripcion: pr.descripcion,
                plazoImplementacion: plazo,
            },
        });
        exigir(r.status === 201 || r.status === 200, `No se pudo registrar la prescripción en ${pr.obra}`, r);
        if (pr.diasPlazo < 0) vencidas += 1;
    }
    log(`${PRESCRIPCIONES.length} medidas, ${vencidas} con el plazo ya cumplido`);

    return { empresa, creadas, obraPorClave };
}

// ─── Ensayo ──────────────────────────────────────────────────────────────────

function ensayar() {
    log(`Marca de la empresa: "${PERFIL.marca}"`);
    log('');
    log(`Obras: ${OBRAS.length}`);
    for (const o of OBRAS) log(`   ${o.nombre} — dotación ${o.dotacion} — ${o.comuna}`);
    log('');
    log(`Personal: ${EQUIPO.length} por obra, ${EQUIPO.length * OBRAS.length} en total`);
    log(`   roles: ${[...new Set(EQUIPO.map((m) => m.rol))].join(', ')}`);
    log('');
    log('Documentos, para que se distinga la brecha de obra de la práctica de empresa:');
    for (const d of DOCUMENTOS) {
        const faltan = OBRAS.length - d.en.length;
        log(`   ${d.tipo.padEnd(26)} ${faltan === 0 ? 'en todas' : `falta en ${faltan} de ${OBRAS.length}`}`);
    }
    log('');
    log(`Entregas de EPP: ${ENTREGAS_EPP.length} por obra, con reposiciones y motivo`);
    log(`Actividades: ${ACTIVIDADES.length} por obra, con asistencia firmada`);
    log(`Accidentes: ${ACCIDENTES.length}, ${ACCIDENTES.reduce((n, a) => n + a.diasPerdidos, 0)} días perdidos en total`);
    log(`Medidas prescritas: ${PRESCRIPCIONES.length}, ${PRESCRIPCIONES.filter((x) => x.diasPlazo < 0).length} con plazo cumplido`);
    log('');
    log('No se escribió nada. Para sembrar de verdad, agrega --confirmar.');
}

// ─── Entrada ─────────────────────────────────────────────────────────────────

async function main() {
    console.log('\n  Datos de ejemplo para dev\n');
    exigirDev(stage);

    if (borrarSolo) {
        paso(`Borrando la empresa de ejemplo ${borrarSolo}`);
        await desechable.borrarEmpresa(stage, borrarSolo, [], { perfil: PERFIL });
        console.log('');
        return;
    }

    if (limpiarPendientes) {
        paso('Borrando lo que quedó de corridas anteriores');
        await desechable.borrarPendientes(stage, { perfil: PERFIL });
        console.log('');
        return;
    }

    if (!confirmar) {
        paso('Ensayo: esto es lo que haría');
        ensayar();
        console.log('');
        return;
    }

    let sembrado = null;
    try {
        sembrado = await sembrar(stage);
    } catch (err) {
        console.error(`\n  Falló la siembra: ${err.message}`);
        const pendientes = desechable.leerPendientes(stage, PERFIL);
        if (pendientes.length) {
            console.error('');
            console.error('  Quedó una empresa a medio sembrar. Para borrarla:');
            console.error(`    node ${path.relative(process.cwd(), __filename)} --stage ${stage} --limpiar-pendientes`);
        }
        process.exitCode = 1;
        return;
    }

    const { empresa, obraPorClave } = sembrado;
    console.log('\n  Listo.\n');
    log(`Empresa:  ${empresa.nombre}`);
    log(`tenantId: ${empresa.tenantId}`);
    log('');
    log('Para entrar al frontend de dev:');
    log(`   RUT:         ${empresa.adminRut}`);
    log(`   Contraseña:  ${PASSWORD}`);
    log(`   PIN de firma: ${PIN}`);
    log('');
    log('Todas las personas sembradas usan la misma contraseña y el mismo PIN.');
    log(`Obras creadas: ${Object.keys(obraPorClave).length}`);
    log('');
    log('Para borrar todo esto cuando ya no sirva:');
    log(`   node ${path.relative(process.cwd(), __filename)} --stage ${stage} --borrar ${empresa.tenantId}`);
    console.log('');
}

if (require.main === module) {
    main().catch((err) => {
        console.error(`\n  Error: ${err.message}\n`);
        process.exit(1);
    });
}

module.exports = { exigirDev, OBRAS, DOCUMENTOS, EQUIPO, ENTREGAS_EPP, ACTIVIDADES, ACCIDENTES, PRESCRIPCIONES, PERFIL };
