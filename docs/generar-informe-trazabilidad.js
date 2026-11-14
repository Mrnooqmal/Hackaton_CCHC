/**
 * Genera `actividad_trazabilidad.docx` a partir de este archivo, con el mismo
 * formato que el entregable de la actividad de derechos: portada, tabla de
 * contenido, secciones numeradas, tablas con encabezado azul y pie de página.
 *
 * El contenido de referencia es `docs/actividad-trazabilidad.md`, que es la
 * fuente que se mantiene al día; esto es su presentación para entregar.
 *
 * NO usa las dependencias del backend. Necesita la librería `docx` instalada
 * aparte, en cualquier carpeta temporal:
 *
 *   npm install docx
 *   node docs/generar-informe-trazabilidad.js actividad_trazabilidad.docx
 *
 * La tabla de contenido es un campo de Word con `dirty`, así que Word la llena
 * al abrir el archivo. Si se exporta a PDF sin abrirlo antes, la tabla sale
 * vacía: hay que abrirlo, dejar que actualice los campos, y recién exportar.
 */
const fs = require('fs');
const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, TabStopType,
    Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, Footer,
    PageNumber, ExternalHyperlink, TableOfContents, PageBreak, LevelFormat,
} = require('docx');

const AZUL = '1F3864';        // títulos y encabezado de tabla
const AZUL_CLARO = '2E5395';  // subtítulos
const GRIS = '595959';
const GRIS_CLARO = 'A6A6A6';
const BORDE = 'BFBFBF';
const FUENTE = 'Arial';

const TITULO_DOC = 'Trazabilidad y plan de respuesta';
const ANCHO = 9360; // ancho útil en DXA (Letter con márgenes de 1")

/* ─── Ayudantes ──────────────────────────────────────────────────────────── */

const p = (texto, o = {}) => new Paragraph({
    spacing: { after: o.after ?? 120, line: 276 },
    alignment: o.align,
    indent: o.indent,
    children: [new TextRun({
        text: texto, font: FUENTE, size: o.size ?? 20,
        bold: o.bold, italics: o.italics, color: o.color ?? '000000',
    })],
});

/** Párrafo con tramos: ['texto', {bold:true}] o 'texto'. */
const pr = (tramos, o = {}) => new Paragraph({
    spacing: { after: o.after ?? 120, line: 276 },
    indent: o.indent,
    children: tramos.map((t) => {
        if (typeof t === 'string') return new TextRun({ text: t, font: FUENTE, size: o.size ?? 20 });
        return new TextRun({
            text: t.t, font: t.mono ? 'Consolas' : FUENTE, size: t.mono ? 18 : (o.size ?? 20),
            bold: t.bold, italics: t.italics, color: t.color,
        });
    }),
});

const vinenta = (texto, nivel = 0) => new Paragraph({
    spacing: { after: 80, line: 276 },
    numbering: { reference: 'guiones', level: nivel },
    children: [new TextRun({ text: texto, font: FUENTE, size: 20 })],
});

/** Viñeta con tramos, para poder destacar el comienzo. */
const vinentaR = (tramos) => new Paragraph({
    spacing: { after: 80, line: 276 },
    numbering: { reference: 'guiones', level: 0 },
    children: tramos.map((t) => (typeof t === 'string'
        ? new TextRun({ text: t, font: FUENTE, size: 20 })
        : new TextRun({
            text: t.t, font: t.mono ? 'Consolas' : FUENTE, size: t.mono ? 18 : 20,
            bold: t.bold, italics: t.italics, color: t.color,
        }))),
});

const h1 = (texto) => new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text: texto, font: FUENTE, size: 28, bold: true, color: AZUL })],
});

const h2 = (texto) => new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text: texto, font: FUENTE, size: 22, bold: true, color: AZUL_CLARO })],
});

const celda = (contenido, anchoDxa, o = {}) => new TableCell({
    width: { size: anchoDxa, type: WidthType.DXA },
    shading: o.fondo ? { type: ShadingType.CLEAR, fill: o.fondo, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 108, right: 108 },
    children: (Array.isArray(contenido) ? contenido : [contenido]).map((linea) => new Paragraph({
        spacing: { after: 0, line: 252 },
        children: (Array.isArray(linea) ? linea : [linea]).map((t) => (typeof t === 'string'
            ? new TextRun({ text: t, font: FUENTE, size: 17, bold: o.encabezado, color: o.encabezado ? 'FFFFFF' : '000000' })
            : new TextRun({
                text: t.t, font: t.mono ? 'Consolas' : FUENTE, size: t.mono ? 15 : 17,
                bold: t.bold || o.encabezado, italics: t.italics,
                color: o.encabezado ? 'FFFFFF' : (t.color || '000000'),
            }))),
    })),
});

const bordes = {
    top: { style: BorderStyle.SINGLE, size: 2, color: BORDE },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDE },
    left: { style: BorderStyle.SINGLE, size: 2, color: BORDE },
    right: { style: BorderStyle.SINGLE, size: 2, color: BORDE },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: BORDE },
    insideVertical: { style: BorderStyle.SINGLE, size: 2, color: BORDE },
};

/** Tabla con encabezado azul y filas alternadas, como el entregable anterior. */
const tabla = (encabezados, filas, anchos) => new Table({
    width: { size: ANCHO, type: WidthType.DXA },
    columnWidths: anchos,
    borders: bordes,
    rows: [
        new TableRow({
            tableHeader: true,
            children: encabezados.map((e, i) => celda(e, anchos[i], { encabezado: true, fondo: AZUL })),
        }),
        ...filas.map((fila, n) => new TableRow({
            children: fila.map((c, i) => celda(c, anchos[i], { fondo: n % 2 ? 'F2F5FA' : undefined })),
        })),
    ],
});

const espacio = (alto = 160) => new Paragraph({ spacing: { after: alto }, children: [] });

const pie = (texto) => new Paragraph({
    spacing: { before: 0, after: 0 },
    tabStops: [{ type: TabStopType.RIGHT, position: ANCHO }],
    children: [
        new TextRun({ text: texto, font: FUENTE, size: 16, color: GRIS_CLARO }),
        new TextRun({ text: '\t', font: FUENTE, size: 16 }),
        new TextRun({ text: 'Página ', font: FUENTE, size: 16, color: GRIS_CLARO }),
        new TextRun({ children: [PageNumber.CURRENT], font: FUENTE, size: 16, color: GRIS_CLARO }),
    ],
});

const codigo = (lineas) => new Paragraph({
    spacing: { before: 120, after: 160, line: 240 },
    shading: { type: ShadingType.CLEAR, fill: 'F5F5F5', color: 'auto' },
    indent: { left: 180, right: 180 },
    children: lineas.flatMap((l, i) => [
        ...(i ? [new TextRun({ break: 1 })] : []),
        new TextRun({ text: l, font: 'Consolas', size: 16 }),
    ]),
});

const figuraPie = (texto) => new Paragraph({
    spacing: { before: 60, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: texto, font: FUENTE, size: 16, color: GRIS, italics: true })],
});

/* ─── Portada ────────────────────────────────────────────────────────────── */

const REPO = 'https://github.com/Mrnooqmal/Hackaton_CCHC';

const portada = [
    espacio(2400),
    new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({
            text: 'Actividad: Trazabilidad y plan de respuesta',
            font: FUENTE, size: 44, bold: true, color: AZUL,
        })],
    }),
    new Paragraph({
        spacing: { after: 560 },
        children: [new TextRun({
            text: 'Informe técnico del sistema Build & Serve',
            font: FUENTE, size: 26, color: GRIS,
        })],
    }),
    pr([{ t: 'Integrantes: ', bold: true }, 'Alonso Cárdenas, Benjamín Pinto, Benjamín Sánchez, Adrean Torres'], { after: 60 }),
    pr([{ t: 'Asignatura: ', bold: true }, 'Seguridad y Protección de Datos, Taller Práctico'], { after: 60 }),
    new Paragraph({
        spacing: { after: 60, line: 276 },
        children: [
            new TextRun({ text: 'Repositorio: ', font: FUENTE, size: 20, bold: true }),
            new ExternalHyperlink({
                link: REPO,
                children: [new TextRun({ text: REPO, font: FUENTE, size: 20, color: '0563C1', underline: {} })],
            }),
            new TextRun({ text: ' (rama ', font: FUENTE, size: 20 }),
            new TextRun({ text: 'pruebas', font: 'Consolas', size: 18 }),
            new TextRun({ text: ', commit ', font: FUENTE, size: 20 }),
            new TextRun({ text: 'fc0789a', font: 'Consolas', size: 18 }),
            new TextRun({ text: ')', font: FUENTE, size: 20 }),
        ],
    }),
    pr([{ t: 'Fecha: ', bold: true }, '13 de noviembre de 2026'], { after: 60 }),
    new Paragraph({ children: [new PageBreak()] }),
];

/* ─── Contenido ──────────────────────────────────────────────────────────── */

const contenido = [
    new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: 'Contenido', font: FUENTE, size: 32, bold: true, color: AZUL })],
    }),
    new TableOfContents('Contenido', { hyperlink: true, headingStyleRange: '1-2' }),
    new Paragraph({ children: [new PageBreak()] }),
];

/* ─── Cuerpo ─────────────────────────────────────────────────────────────── */

const cuerpo = [
    h1('0. Contexto del sistema y alcance'),
    p('Build & Serve es una plataforma SaaS multiempresa que ayuda a las constructoras a cumplir el DS 44 de 2024 (gestión preventiva de riesgos laborales): personal de cada obra, capacitaciones, entregas de EPP, documentos firmados, incidentes, fichas de salud ocupacional y encuestas. Maneja datos personales de trabajadores, incluidos datos de salud, y está en producción con datos reales desde octubre de 2026.'),
    pr([{ t: 'Roles legales. ', bold: true }, 'Cada constructora es la responsable del tratamiento de los datos de sus trabajadores y la plataforma es la encargada (decisión D-15). Esa distinción no la cambia ningún acuerdo y decide quién notifica una brecha y quién responde ante la Agencia.']),
    pr([{ t: 'Marco normativo. ', bold: true }, 'Ley 19.628 modificada por la Ley 21.719, artículo 14 sexies (reporte de vulneraciones y registro de ellas). La Ley 21.663 de ciberseguridad no aplica: sus plazos son para servicios esenciales u operadores de importancia vital, y Build & Serve no está calificada como tal.']),
    h2('Punto de partida'),
    p('Esta actividad continúa dos decisiones anteriores: D-31 (registro de auditoría y detección) y D-32 (plan de respuesta a incidentes). Lo que se agregó ahora nació del punto 6: el simulacro midió qué se podía reconstruir, no salió bien, y lo que falló se corrigió.'),
    espacio(80),
    tabla(
        ['Requisito', 'Qué había', 'Qué se agregó o se verificó'],
        [
            ['1. Eventos y campos', 'Catálogo cerrado de operaciones con 15 campos por registro.', 'Tres operaciones de lectura y una categoría propia para ellas.'],
            ['2. Sin guardar los datos', 'Saneo del detalle; el RUT de un ingreso fallido va como HMAC.', 'Se verificó que las lecturas nuevas tampoco llevan datos.'],
            ['3. Protección', 'Permiso, IAM de solo agregar, TTL por categoría, sello HMAC.', 'Plazo propio para la categoría de acceso, configurable.'],
            ['4. Alertas', 'Cinco reglas de detección.', 'Una sexta, posible solo desde que las lecturas dejan rastro.'],
            ['5. Plan de respuesta', 'Plan con criterios, fases y notificación.', 'Versión 2: la plataforma notifica por mandato y los plazos se miden desde la primera señal (D-38).'],
            ['6. Simulacro', 'El plan lo prescribía; nunca se había corrido.', 'Herramienta, primera corrida (5 de 8) y corrección del hueco (D-39).'],
        ],
        [1900, 3500, 3960],
    ),
    espacio(),

    /* 1 */
    h1('1. Qué eventos se auditan y qué campos tiene cada registro'),
    h2('1.1 Catálogo cerrado'),
    pr([
        'El módulo ', { t: 'lib/gobernanza/auditoria.js', mono: true },
        ' define 37 operaciones en 9 categorías. El catálogo es cerrado: una operación que no está en él ',
        { t: 'no se puede registrar', bold: true },
        ', lanza un error de programación. Eso evita que cada módulo invente su propio nombre y que la auditoría termine siendo un registro de texto libre imposible de consultar.',
    ]),
    espacio(80),
    tabla(
        ['Categoría', 'N°', 'Qué cubre'],
        [
            [[{ t: 'seguridad', mono: true }], '4', 'Ingresos, ingresos fallidos, verificación de identidad y su fallo'],
            [[{ t: 'consentimiento', mono: true }], '3', 'Otorgado, revocado, denegado'],
            [[{ t: 'derechos', mono: true }], '11', 'Solicitud, verificación, prórroga, respuesta, exportación, rectificación, oposición, supresión'],
            [[{ t: 'datos', mono: true }], '1', 'Modificación de una ficha'],
            [[{ t: 'acceso', mono: true, bold: true }], '3', 'Lectura del directorio, de una ficha ajena y descarga de un documento firmado'],
            [[{ t: 'administracion', mono: true }], '2', 'Cambio de rol, cambio de los permisos de los roles'],
            [[{ t: 'contencion', mono: true }], '5', 'Revocar sesiones, suspender y reactivar cuenta, revocar vales, preservar evidencia'],
            [[{ t: 'auditoria', mono: true }], '2', 'Consulta de la auditoría, verificación de sellos'],
            [[{ t: 'alerta', mono: true }], '6', 'Una por regla de detección, derivada automáticamente'],
        ],
        [1900, 620, 6840],
    ),
    espacio(80),
    p('La categoría de alertas no se escribe a mano: se deriva de las reglas. Si mañana se agrega una regla, su operación existe sin tocar el catálogo.'),

    h2('1.2 Campos de cada registro'),
    p('Quince campos, elegidos por lo que aportan a una investigación y no por completitud:'),
    espacio(80),
    tabla(
        ['Campo', 'Para qué sirve en una investigación'],
        [
            [[{ t: 'tenantId', mono: true }, ' + ', { t: 'sk', mono: true }], 'Clave: la empresa y el instante. La clave de orden es EV#<fecha ISO>#<uuid>, así que la partición queda ordenada en el tiempo sin un índice extra'],
            [[{ t: 'eventoId', mono: true }], 'Identificador único; es lo que permite deduplicar al evaluar las reglas'],
            [[{ t: 'en', mono: true }], 'Fecha y hora ISO'],
            [[{ t: 'categoria', mono: true }, ', ', { t: 'operacion', mono: true }], 'Qué pasó, del catálogo cerrado'],
            [[{ t: 'resultado', mono: true }], 'Éxito, denegado o fallido. Un acceso denegado es tan informativo como uno exitoso'],
            [[{ t: 'actorId', mono: true }, ', ', { t: 'actorTipo', mono: true }, ', ', { t: 'actorRol', mono: true }], 'Quién. El tipo puede ser persona, cuenta, sistema u operador: un ingreso fallido no tiene sesión, así que el actor es la cuenta'],
            [[{ t: 'recurso', mono: true }], 'Sobre qué, como tipo e identificador'],
            [[{ t: 'titulares', mono: true }], 'De quién eran los datos. Es el campo que convierte un registro técnico en un informe de brecha'],
            [[{ t: 'origen', mono: true }], 'IP y canal'],
            [[{ t: 'detalle', mono: true }], 'Lo acotado y saneado (sección 2.2)'],
            [[{ t: 'ttl', mono: true }], 'Vencimiento, derivado de la categoría (sección 3.2)'],
            [[{ t: 'sello', mono: true }], 'HMAC del registro canónico (sección 3.3)'],
        ],
        [2300, 7060],
    ),
    espacio(80),
    pr(['El índice ', { t: 'actorId-en-index', mono: true }, ' ordena por actor y fecha. Esa es exactamente la consulta de un incidente: qué hizo esta cuenta entre tal hora y tal otra.']),

    /* 2 */
    h1('2. El registro, sin guardar los datos'),
    h2('2.1 Qué se registra'),
    espacio(80),
    tabla(
        ['Operación', 'Dónde se emite', 'Qué guarda'],
        [
            [[{ t: 'auth.ingreso', mono: true }, ', ', { t: 'auth.ingreso_fallido', mono: true }], 'handlers/auth', 'El fallido se identifica por el HMAC del RUT, nunca el RUT ni la contraseña probada'],
            [[{ t: 'datos.lectura_directorio', mono: true }], 'handlers/personas-module', 'Cuántas personas y si el listado fue completo o recortado'],
            [[{ t: 'datos.lectura_ficha', mono: true }], 'handlers/personas-module', 'El identificador del titular, y si se llegó por RUT'],
            [[{ t: 'datos.descarga_documento', mono: true }], 'handlers/documents', 'Los firmantes cuyos RUT van en el anexo del PDF'],
            [[{ t: 'datos.modificacion', mono: true }], 'handlers/personas-module', 'Qué campos cambiaron, no sus valores'],
            [[{ t: 'admin.*', mono: true }], 'tenants-module, personas-module', 'El rol nuevo'],
            [[{ t: 'derechos.*', mono: true }, ' (11)'], 'handlers/gobernanza', 'El flujo completo de una solicitud del titular'],
            [[{ t: 'contencion.*', mono: true }, ' (5)'], 'lib/gobernanza/contencion.js', 'Operador, motivo y alcance'],
            [[{ t: 'auditoria.consulta', mono: true }], 'handlers/gobernanza/auditoria.js', 'Quien investiga también deja rastro, con los filtros que usó'],
        ],
        [2600, 2700, 4060],
    ),
    espacio(80),
    pr(['Los accesos a ', { t: 'datos de salud', bold: true }, ' tienen su propio camino desde antes (decisión D-18) y no llevan vencimiento: no caducan.']),

    h2('2.2 Cómo se impide que entren datos personales'),
    p('La función de saneo rechaza el registro completo —lanza— si el detalle trae:'),
    vinentaR([{ t: 'una clave con nombre prohibido: ', bold: true }, 'contraseña, PIN, token, secreto, llave, RUT, correo, teléfono, fecha de nacimiento, dirección, salud, diagnóstico, respuesta, relato, descripción, texto, valor, contenido, nombre o cifrado;']),
    vinentaR([{ t: 'un valor que parece un RUT o un correo', bold: true }, ', aunque la clave se llame de otra forma;']),
    vinentaR([{ t: 'un texto de más de 120 caracteres', bold: true }, ', porque un campo largo es donde se cuela un relato con datos adentro.']),
    espacio(60),
    p('Que lance en vez de limpiar en silencio es deliberado: un dato prohibido en la auditoría es un error de programación, y tiene que verse en las pruebas, no en una fiscalización.'),

    h2('2.3 Qué se guarda de un listado, y por qué'),
    p('Cuando alguien lista el personal, el registro guarda cuántas personas y el alcance, pero no los identificadores uno por uno. El alcance es "el personal de esta empresa", y el informe de brecha lo resuelve desde la empresa y la fecha; guardar cientos de identificadores en cada listado abultaría el registro sin decir nada nuevo.'),
    p('En cambio, abrir una ficha sí guarda el identificador de esa persona: ahí la precisión importa y el volumen no es problema. Y leer la ficha propia no se registra: no es un acceso de un tercero, y registrarlo llenaría la auditoría de ruido justo donde hay que buscar los accesos ajenos.'),

    /* 3 */
    h1('3. Protección de los registros'),
    h2('3.1 Acceso restringido'),
    espacio(80),
    tabla(
        ['Capa', 'Cómo'],
        [
            ['Permiso de aplicación', [[{ t: 'empresa.auditoria', mono: true }, ', que por omisión solo tiene el administrador. Se puede delegar, por ejemplo a quien responde por la seguridad de la información']]],
            ['Aislamiento entre empresas', 'La consulta filtra por la empresa de la sesión, nunca por una que venga en la petición'],
            ['La consulta se audita', 'Cada consulta se registra en modo estricto: si ese registro no se puede escribir, la auditoría no se muestra (503). Quien mira el registro de los demás queda registrado, o no mira'],
            ['IAM: solo agregar y leer', [[{ t: 'Query', mono: true }, ' y ', { t: 'PutItem', mono: true }, ' sobre la tabla. No hay actualización ni borrado, y eso incluye al rol de supresión. La garantía está en el permiso, no en la disciplina del código']]],
        ],
        [2600, 6760],
    ),

    h2('3.2 Plazo de conservación'),
    espacio(80),
    tabla(
        ['Categoría', 'Plazo', 'Por qué'],
        [
            ['Seguridad', '1 año', 'Sirve para investigar un incidente reciente'],
            ['Acceso', '1 año', 'Igual: responde quién leyó qué'],
            ['Alertas', '2 años', 'Una alerta es el inicio de una historia que puede volver'],
            ['Derechos, datos, consentimiento, contención, administración', '5 años', 'Acredita cómo se trataron los datos de una persona; es el plazo de la evidencia (D-2)'],
            ['Accesos a salud (D-18)', 'Sin vencimiento', 'No caducan'],
        ],
        [3200, 1500, 4660],
    ),
    espacio(80),
    p('La categoría de acceso se creó aparte justamente por esto: si una lectura del directorio durara cinco años, cada listado multiplicaría el almacenamiento sin aportar nada que el plan de incidentes use. Es configurable por variable de entorno.'),

    h2('3.3 Integridad: el sello'),
    p('Cada registro lleva un HMAC de su forma canónica, con una llave que las funciones usan pero que no está en la tabla. Al consultar, el servidor verifica cada sello y responde íntegro, alterado o sin sello, más un resumen.'),
    p('Para qué sirve: el control de permisos impide borrar y modificar desde la aplicación, pero alguien con acceso a la consola de AWS podría editar la tabla. El sello hace que esa edición se vea. Un registro alterado es, por sí mismo, un incidente confirmado en el plan.'),
    p('Además, la tabla se conserva aunque se borre la infraestructura y tiene recuperación a un punto en el tiempo.'),

    /* 4 */
    h1('4. Alertas de acceso anómalo'),
    p('Seis reglas. La actividad pedía al menos tres; las seis son propias de este sistema y no de un catálogo genérico.'),
    espacio(80),
    tabla(
        ['Regla', 'Qué la dispara', 'Ventana', 'Umbral', 'Acción automática'],
        [
            [[{ t: 'fuerza_bruta_cuenta', mono: true }], 'Ingresos fallidos contra la misma cuenta', '15 min', '5', '—'],
            [[{ t: 'verificacion_reiterada', mono: true }], 'Contraseña incorrecta al confirmar identidad para exportar o rectificar', '15 min', '3', 'Cierra todas las sesiones de la cuenta'],
            [[{ t: 'exportacion_reiterada', mono: true }], 'Exportación de datos sobre el límite diario', '24 h', '1', '—'],
            [[{ t: 'acceso_masivo_salud', mono: true }], 'Datos de salud de muchas personas distintas', '60 min', '30', '—'],
            [[{ t: 'lectura_masiva_fichas', mono: true, bold: true }], 'La ficha de muchas personas distintas', '60 min', '30', '—'],
            [[{ t: 'escalamiento_privilegios', mono: true }], 'Se otorga el rol de administrador o se cambian los permisos de los roles', '60 min', '1', '—'],
        ],
        [2300, 3300, 900, 760, 2100],
    ),
    espacio(80),
    p('Cuatro decisiones de diseño:'),
    vinentaR([{ t: 'La segunda regla contiene sola. ', bold: true }, 'Tres contraseñas incorrectas al confirmar identidad no es alguien que olvidó su clave: es el patrón de una sesión robada intentando adivinarla para exportar datos. Cerrar las sesiones no molesta a la persona legítima, que vuelve a entrar con su contraseña, y sí detiene a quien solo tenía la sesión.']),
    vinentaR([{ t: 'Las dos reglas masivas cuentan titulares, no peticiones. ', bold: true }, 'Abrir diez veces la misma ficha no alerta; abrir treinta fichas distintas sí. La diferencia es la que separa gestionar un equipo de recorrer un padrón.']),
    vinentaR([{ t: 'El escalamiento alerta sin umbral. ', bold: true }, 'Otorgar el rol de administrador una sola vez ya es un evento que alguien debe mirar.']),
    vinentaR([{ t: 'Una alerta por ventana. ', bold: true }, 'Una cuenta bajo ataque produce una alerta, no doscientas.']),
    espacio(60),
    p('Cada alerta queda en la misma auditoría, avisa en la bandeja de quien tiene el permiso de auditoría en la empresa afectada y emite una métrica con su alarma de CloudWatch.'),

    /* 5 */
    h1('5. Plan de respuesta a incidentes'),
    pr(['El plan completo es ', { t: 'docs/plan-respuesta-incidentes.md', mono: true }, ' (versión 2, 317 líneas). Acá va lo que la actividad pide: criterios, responsables, fases y contenido de la notificación.']),
    h2('5.1 Criterios y niveles'),
    p('Tres niveles, para no tratar igual una contraseña olvidada y una filtración:'),
    vinentaR([{ t: 'Alerta: ', bold: true }, 'una regla cruzó su umbral, o alguien reportó algo.']),
    vinentaR([{ t: 'Evento sospechoso: ', bold: true }, 'revisada la auditoría, no hay explicación legítima, pero no se ha comprobado acceso a datos.']),
    vinentaR([{ t: 'Incidente confirmado: ', bold: true }, 'hay evidencia de destrucción, pérdida, alteración, comunicación o acceso no autorizado, o de credenciales comprometidas.']),
    espacio(60),
    p('La gravedad es alta si hubo datos de salud, RUT en claro, credenciales o llaves, o más de 50 titulares, o si la integridad de la evidencia del DS 44 quedó comprometida.'),

    h2('5.2 Responsables'),
    espacio(80),
    tabla(
        ['Función', 'Responsable', 'Suplente'],
        [
            ['Coordinación del incidente y seguridad', 'Adrean Torres', 'Benjamín Sánchez'],
            ['Desarrollo (análisis, erradicación)', 'Benjamín Sánchez', 'Alonso Cárdenas'],
            ['Administración del sistema (AWS)', 'Adrean Torres (perfil operador)', 'Benjamín Pinto'],
            ['Comunicación', 'Benjamín Pinto', 'Alonso Cárdenas'],
            ['Verificación', 'Daniel (QA)', '—'],
            ['Evaluación de riesgo y decisión de notificar', 'Adrean Torres', 'Benjamín Sánchez'],
            ['Contraparte en la constructora', 'Su administración o su delegado de protección de datos', '—'],
        ],
        [4000, 3200, 2160],
    ),
    espacio(80),
    p('La decisión de notificar está en el equipo y no en la constructora a propósito: necesita los hechos técnicos (auditoría, informe de brecha, línea de tiempo) y el criterio para leerlos. Un jefe de obra no puede evaluar si una lectura masiva de fichas significó acceso efectivo a datos sensibles. Dejar la decisión donde está el dato acorta el plazo y evita que el mismo hecho se notifique de dos formas distintas.'),
    p('Ninguna acción irreversible la ejecuta una sola persona: la supresión exige dos (D-17) y la notificación a la Agencia también, quien firma y quien revisa.'),

    h2('5.3 Fases'),
    vinentaR([{ t: '1. Preparación. ', bold: true }, 'Responsables, canales (alarma automática, correo, teléfono), herramientas y un simulacro trimestral.']),
    vinentaR([{ t: '2. Detección y análisis. ', bold: true }, 'Las reglas, los tres niveles y la evaluación de alcance con el informe de brecha.']),
    vinentaR([{ t: '3. Contención. ', bold: true }, 'Preservar evidencia con su huella, cerrar sesiones, suspender la cuenta, revocar los vales de firma. Exigen operador y motivo, y quedan en la auditoría.']),
    vinentaR([{ t: '4. Erradicación y recuperación. ', bold: true }, 'Corregir, verificar en el ambiente de pruebas, desplegar, restaurar si hizo falta.']),
    vinentaR([{ t: '5. Notificación. ', bold: true }, 'Ver 5.4.']),
    vinentaR([{ t: '6. Lecciones aprendidas. ', bold: true }, 'A los 10 días hábiles, con causa raíz, línea de tiempo contra los plazos, medidas, y una prueba nueva que falle si la falla vuelve.']),
    vinentaR([{ t: '7. Registro y cierre. ', bold: true }, 'Identificador por caso y condiciones explícitas para cerrar.']),

    h2('5.4 Quién notifica, y los plazos'),
    pr([{ t: 'La plataforma notifica', bold: true }, ', a la Agencia y a los titulares, en nombre y representación de la constructora responsable, por mandato expreso del contrato de encargo (D-38).']),
    p('Lo que ese mandato no mueve: la obligación de reportar del artículo 14 sexies es del responsable, y ningún contrato se la quita. Lo que se delega es el acto material de notificar, que sí se puede delegar. La constructora recibe el informe y el borrador antes, puede objetar o notificar ella misma, y su decisión queda documentada. Si no responde dentro del plazo, se notifica igual: el silencio de la responsable no suspende el plazo de la ley.'),
    espacio(80),
    tabla(
        ['Hito', 'Plazo interno'],
        [
            ['Clasificar una alerta de severidad alta', '1 hora hábil'],
            ['Declarar o descartar un incidente de gravedad alta', '24 horas corridas desde la primera señal; pasado el tope, se declara confirmado'],
            ['Contener un incidente confirmado', 'El mismo día'],
            ['Informar a la constructora', '24 horas desde la confirmación'],
            ['Notificar a la Agencia y a los titulares', '72 horas corridas desde la primera señal'],
            ['Informe de lecciones aprendidas', '10 días hábiles desde el cierre'],
        ],
        [4600, 4760],
    ),
    espacio(80),
    pr([{ t: 'Por qué estos plazos. ', bold: true }, 'La Ley 21.719 no fija horas: exige notificar "por los medios más expeditos posibles y sin dilaciones indebidas". Fijar plazos propios no inventa una obligación, demuestra diligencia, que es lo que la responsabilidad proactiva exige poder acreditar. Las 72 horas se eligen porque son la referencia del reglamento europeo, que es con lo que la Agencia —nueva y sin jurisprudencia— va a juzgar si una demora fue indebida; llegar antes de ese número sin estar obligado deja al responsable en la mejor posición posible.']),
    pr([{ t: 'Por qué desde la primera señal. ', bold: true }, 'La versión 1 del plan medía todo desde la confirmación, y la confirmación la declara el coordinador: un incidente que tardaba una semana en declararse cumplía el plan y era, igual, una dilación indebida. El tope de 24 horas para declarar o descartar cierra ese hueco.']),

    h2('5.5 Contenido de la notificación'),
    p('Siete puntos, que se arman con el informe de brecha, que trae categorías y conteos, no datos:'),
    vinenta('Descripción clara de lo ocurrido.'),
    vinenta('Fecha de detección y, si se conoce, el período en que ocurrió.'),
    vinenta('Tipos de datos afectados y número aproximado de titulares.'),
    vinenta('Posibles consecuencias para los titulares.'),
    vinenta('Medidas de contención y mitigación adoptadas.'),
    vinenta('Recomendaciones concretas (cambiar la contraseña, desconfiar de quien pida el PIN por teléfono).'),
    vinenta('Canal de contacto.'),
    espacio(60),
    p('El plan incluye una plantilla para los titulares en lenguaje claro, porque una notificación que nadie entiende no cumple su propósito aunque cumpla el plazo. El registro de brechas que el artículo 14 sexies exige al responsable lo lleva la plataforma por cada constructora y se le entrega cuando lo pida o al terminar el encargo.'),

    /* 6 */
    h1('6. Simulacro: ¿los registros permiten reconstruir lo ocurrido?'),
    p('Esta es la parte que cambió el resultado de la actividad, así que la contamos como ocurrió y no como nos habría gustado.'),
    h2('6.1 La herramienta'),
    pr([{ t: 'scripts/simulacro-incidente.js', mono: true }, ' ejecuta un incidente de cuenta comprometida de punta a punta y, sobre todo, contrasta lo que hizo contra lo que quedó registrado. No explota ninguna falla: entra con una contraseña que el operador le da, así que es un generador de rastro conocido y no una herramienta de ataque.']),
    p('Corre solo en el ambiente de pruebas (sale con error en cualquier otro: genera ingresos fallidos y cambia un rol, y en producción eso contamina la auditoría real y dispara alertas verdaderas). Revierte el escalamiento de rol al terminar y avisa si no pudo.'),
    codigo([
        'node scripts/simulacro-incidente.js --stage dev \\',
        '    --rut <cuenta> --password <clave> --confirmar',
    ]),
    p('Las cinco fases: reconocimiento (ingresos fallidos), acceso, exfiltración (directorio, fichas, repositorio), escalamiento (rol de administrador) y reconstrucción.'),

    h2('6.2 Primera corrida: 5 de 8'),
    p('Corrido el 13 de noviembre de 2026 contra una empresa de ejemplo con 6 obras, 31 personas y 79 documentos:'),
    espacio(80),
    tabla(
        ['Acción del incidente', '¿Reconstruible?'],
        [
            ['6 ingresos fallidos', [[{ t: 'Sí', bold: true }, ' — auth.ingreso_fallido']]],
            ['Alerta de fuerza bruta', [[{ t: 'Sí', bold: true }, ' — disparó al quinto, sola']]],
            ['Ingreso con éxito', [[{ t: 'Sí', bold: true }, ' — auth.ingreso, con actor']]],
            [[{ t: 'Listar el directorio (31 personas)', bold: true }], [[{ t: 'NO — no se auditaba', bold: true, color: 'C00000' }]]],
            [[{ t: 'Leer 3 fichas individuales', bold: true }], [[{ t: 'NO — no se auditaba', bold: true, color: 'C00000' }]]],
            [[{ t: 'Listar el repositorio (79 documentos)', bold: true }], [[{ t: 'NO — no se auditaba', bold: true, color: 'C00000' }]]],
            ['Otorgar el rol de administrador', [[{ t: 'Sí', bold: true }, ' — admin.cambio_rol + datos.modificacion']]],
            ['Alerta de escalamiento', [[{ t: 'Sí', bold: true }, ' — disparó siempre, sin umbral']]],
        ],
        [4600, 4760],
    ),
    espacio(80),
    p('Los 12 registros de la ventana verificaron su sello: 12 íntegros, 0 alterados.'),
    pr([{ t: 'El diagnóstico. ', bold: true }, 'El catálogo no tenía ninguna operación de lectura. Solo los accesos a datos de salud dejaban rastro, por el camino aparte de D-18. Una cuenta robada podía llevarse el directorio completo con RUT, correo y fecha de nacimiento, y la auditoría solo decía que había iniciado sesión. El propio informe de brecha lo admitía: lo confirmado eran los accesos a salud y el resto era una cota superior de lo que esa cuenta podía leer.']),

    h2('6.3 Lo que se corrigió'),
    p('Se auditan las tres lecturas que importan —el directorio, la ficha ajena y la descarga de un documento firmado—, más la regla de lectura masiva de fichas, que antes no era posible porque no existía el evento que detectar. Dos criterios se fijaron con pruebas para que no se pierdan:'),
    vinentaR([{ t: 'Registrar una lectura no puede impedirla. ', bold: true }, 'Para los datos de salud la regla es la opuesta: lo que no se puede registrar no se entrega (D-18). Aplicar eso al listado del personal dejaría la aplicación inutilizable por un problema de la auditoría, en pantallas que se usan en terreno. Hay una prueba que fija cada uno de los dos criterios, para que no se uniformen por descuido.']),
    vinentaR([{ t: 'La escritura se espera. ', bold: true }, 'Al implementarlo se escribió primero como "lanzar y seguir", y una prueba lo atrapó: cuando el handler responde, Lambda puede congelar la ejecución antes de que la escritura llegue, y el registro se pierde en silencio. Una auditoría que pierde registros al azar es peor que no tenerla, porque se confía en ella.']),

    h2('6.4 Verificación de la reconstrucción'),
    pr([{ t: 'tests/auditoria-lecturas.test.js', mono: true }, ' incluye la contraparte automatizada del simulacro: recorre el padrón, abre dos fichas (una por identificador y otra por RUT), consulta la auditoría por el endpoint real y verifica que:']),
    vinenta('aparezcan todas las operaciones del recorrido;'),
    vinenta('se sepa de quién eran los datos;'),
    vinenta('la secuencia venga ordenada en el tiempo, para poder narrarla;'),
    vinenta('todos los registros sean del mismo actor;'),
    vinenta('ningún sello esté alterado.'),

    h2('6.5 Lo que sigue siendo cota superior'),
    p('Actividades, incidentes y obras se leen sin registro. De una cuenta comprometida se puede decir qué podía ver de esos módulos, no qué vio. Se decidió no auditarlos ahora: no llevan datos identificatorios de terceros como el directorio y la ficha, y auditar toda lectura costaría una escritura por petición. Queda declarado, acá y en el plan, en vez de dar por completa una reconstrucción que no lo está.'),

    /* 7 */
    h1('7. Pruebas'),
    h2('7.1 Ejecución'),
    pr(['Las pruebas llaman a la misma función que corre en Lambda, con un evento de API Gateway armado como lo entrega el autorizador, contra un doble de DynamoDB en memoria. Ninguna toca AWS (', { t: 'tests/sin-aws.js', mono: true }, ' lo impide).']),
    codigo([
        'cd Backend',
        'npm test        # suite completa del backend',
        '# tests 1407   pass 1407   fail 0',
    ]),
    p('El despliegue repite esta suite en una copia limpia del commit antes de publicar, y compara después archivo por archivo el paquete de la Lambda con el commit.'),
    h2('7.2 Cada control se probó saboteándolo'),
    p('Siguiendo la regla del equipo, cada control se rompió en una copia aparte del código para comprobar que alguna prueba falla, y luego se restauró. Se agregaron 14 pruebas y se aplicaron 13 sabotajes.'),
    p('Dos de los sabotajes no hicieron fallar ninguna prueba la primera vez. Al revisarlos resultaron ser sabotajes débiles: no rompían de verdad la garantía, porque otra fila del mismo conjunto la seguía cumpliendo. Rehechos correctamente, las pruebas fallaron. De paso, uno de ellos reveló que la búsqueda por RUT no tenía prueba propia, y se le agregó.'),

    /* 8 */
    h1('8. Conclusiones'),
    p('Los seis puntos quedan cubiertos por código, documentación y pruebas. La mayor parte del registro de auditoría ya existía; la actividad sirvió para comprobarlo contra un incidente concreto y para cerrar dos faltas reales: las lecturas de datos personales no dejaban rastro, y los plazos del plan se medían desde un momento que el propio equipo declaraba.'),
    h2('Decisiones principales'),
    vinentaR([{ t: 'El simulacro primero, la conclusión después. ', bold: true }, 'Medir qué se podía reconstruir antes de afirmar que se podía. El resultado (5 de 8) es lo que hizo visible el hueco.']),
    vinentaR([{ t: 'Categoría propia para las lecturas. ', bold: true }, 'Responder quién leyó qué es distinto de acreditar cómo se trataron los datos, y su volumen también: un año en vez de cinco.']),
    vinentaR([{ t: 'Criterios distintos según el dato. ', bold: true }, 'La salud no se entrega si no se puede auditar; el directorio sí se entrega. Uniformar los dos habría empeorado uno de los dos.']),
    vinentaR([{ t: 'Notificar desde donde están los hechos. ', bold: true }, 'La plataforma firma por mandato, con la responsable informada y con derecho a objetar.']),
    vinentaR([{ t: 'Los relojes corren desde que se supo. ', bold: true }, 'No desde que se admitió.']),
    h2('Pendientes declarados'),
    vinenta('Desplegar la auditoría de lecturas al ambiente de pruebas y repetir el simulacro, que debería dar 8 de 8.'),
    vinenta('La cláusula de mandato en el contrato de encargo con cada constructora: sin ella, la plataforma puede informar y redactar, pero no firmar por la responsable.'),
    vinenta('La validación legal de los plazos y los responsables, que confirma un abogado y no el equipo.'),
    vinenta('La auditoría de lecturas en los módulos restantes, si se decide que la cota superior no alcanza.'),
    espacio(60),
    p('Los tres últimos no son código, y por eso están acá: nos parece más sólido declarar el límite entre lo que resuelve el sistema y lo que resuelve un contrato, que presentar una certeza que no tenemos.'),

    /* 9 */
    h1('9. Referencias'),
    vinenta('Ley N° 19.628, sobre Protección de la Vida Privada, modificada por la Ley N° 21.719 (Diario Oficial, 13 de diciembre de 2024), artículo 14 sexies.'),
    vinenta('Ley N° 21.663, marco de ciberseguridad e infraestructura crítica de la información, y su reglamento de reporte de incidentes.'),
    vinenta('Decreto Supremo N° 44 de 2024, Ministerio del Trabajo y Previsión Social. Reglamento sobre gestión preventiva de los riesgos laborales.'),
    vinenta('Ley N° 16.744, sobre accidentes del trabajo y enfermedades profesionales.'),
    vinenta('Reglamento (UE) 2016/679, artículo 33, como referencia del plazo de 72 horas.'),
    vinenta('Amazon DynamoDB Developer Guide: Time to Live, y recuperación a un punto en el tiempo.'),
    vinenta('Repositorio del proyecto: docs/gobernanza-y-seguridad-de-datos.md (decisiones D-15, D-17, D-18, D-31, D-32, D-38 y D-39), docs/plan-respuesta-incidentes.md y docs/actividad-trazabilidad.md.'),
];

/* ─── Documento ──────────────────────────────────────────────────────────── */

const doc = new Document({
    creator: 'Alonso Cárdenas, Benjamín Pinto, Benjamín Sánchez, Adrean Torres',
    title: 'Actividad: Trazabilidad y plan de respuesta',
    description: 'Informe técnico del sistema Build & Serve',
    styles: {
        default: {
            document: { run: { font: FUENTE, size: 20 } },
            heading1: {
                run: { font: FUENTE, size: 28, bold: true, color: AZUL },
                paragraph: { spacing: { before: 360, after: 160 }, keepNext: true },
            },
            heading2: {
                run: { font: FUENTE, size: 22, bold: true, color: AZUL_CLARO },
                paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
            },
        },
    },
    numbering: {
        config: [{
            reference: 'guiones',
            levels: [
                {
                    level: 0, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT,
                    style: { paragraph: { indent: { left: 360, hanging: 180 } } },
                },
            ],
        }],
    },
    sections: [{
        properties: {
            page: {
                size: { width: 12240, height: 15840 },
                margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
            },
        },
        footers: {
            default: new Footer({ children: [pie(`Build & Serve — ${TITULO_DOC}`)] }),
        },
        children: [...portada, ...contenido, ...cuerpo],
    }],
});

Packer.toBuffer(doc).then((buf) => {
    fs.writeFileSync(process.argv[2] || 'informe.docx', buf);
    console.log('escrito:', process.argv[2] || 'informe.docx', buf.length, 'bytes');
});
