/**
 * ds44.js — Catálogo de cargos y onboarding por cargo (DS44, PoC EBCO).
 *
 * ESPEJO de Frontend/src/utils/ds44.ts — mantener ambos sincronizados.
 *
 * El catálogo de cargos y la plantilla del kit (tipos de documento exigidos por
 * cargo) viven a nivel TENANT. El archivo/plantilla concreto se resuelve por
 * ALCANCE de cada ítem:
 *   - 'tenant'  → PDF corporativo único para todas las obras (PR-PO, RI, Política)
 *   - 'obra'    → derivado del MIPER de esa obra (IRL, Plan de Emergencias)
 *   - 'persona' → evidencia individual del trabajador (EPP, examen, encuesta)
 */

// ─── Catálogo de cargos ──────────────────────────────────────────────────────
const DS44_CARGOS = [
    { codigo: 'CARPINTERO', label: 'Carpintero' },
    { codigo: 'JORNAL_ASEO', label: 'Jornal de aseo y acarreo' },
    { codigo: 'MAESTRO_TERMINACIONES', label: 'Maestro de Terminaciones' },
    { codigo: 'MAESTRO_ALBANIL', label: 'Maestro Albañil' },
    { codigo: 'TRAZADOR', label: 'Trazador' },
    { codigo: 'OPERARIO', label: 'Operario', legacy: true },
    { codigo: 'SOLDADOR', label: 'Soldador', legacy: true },
    { codigo: 'ELECTRICISTA', label: 'Electricista', legacy: true },
    { codigo: 'MAESTRO_OBRA', label: 'Maestro de Obra', legacy: true },
    { codigo: 'JEFE_CUADRILLA', label: 'Jefe de Cuadrilla', legacy: true },
    { codigo: 'AYUDANTE', label: 'Ayudante', legacy: true },
    { codigo: 'ALBANIL', label: 'Albañil', legacy: true },
    { codigo: 'JORNAL', label: 'Jornal', legacy: true },
    { codigo: 'OTRO', label: 'Otro', legacy: true }
];

// ─── Matrices EPP por cargo (PR-FR-85) ───────────────────────────────────────
const DS44_EPP_MATRIZ = {
    CARPINTERO: [
        { descripcion: 'Casco de seguridad' }, { descripcion: 'Barbiquejo' },
        { descripcion: 'Legionario' }, { descripcion: 'Lentes de seguridad' },
        { descripcion: 'Guantes de cabritilla' }, { descripcion: 'Botines de seguridad' },
        { descripcion: 'Protección auditiva' },
        { descripcion: 'Arnés de cuerpo completo', critico: true },
        { descripcion: 'Doble cabo de vida con amortiguador', critico: true },
        { descripcion: 'Bloqueador solar (PR-FR-121)' }
    ],
    JORNAL_ASEO: [
        { descripcion: 'Casco de seguridad' }, { descripcion: 'Barbiquejo' },
        { descripcion: 'Lentes de seguridad' }, { descripcion: 'Tapones auditivos' },
        { descripcion: 'Guantes multiflex' }, { descripcion: 'Botines de seguridad' },
        { descripcion: 'Bloqueador solar' }
    ],
    MAESTRO_TERMINACIONES: [
        { descripcion: 'Casco de seguridad' }, { descripcion: 'Lentes de seguridad con sello' },
        { descripcion: 'Guantes de seguridad' }, { descripcion: 'Rodilleras' },
        { descripcion: 'Botines de seguridad' }, { descripcion: 'Careta facial' },
        { descripcion: 'Respirador medio rostro (filtro según HDS)', critico: true },
        { descripcion: 'Buzo desechable' }
    ],
    MAESTRO_ALBANIL: [
        { descripcion: 'Casco de seguridad' }, { descripcion: 'Barbiquejo' },
        { descripcion: 'Lentes de seguridad' }, { descripcion: 'Guantes de seguridad' },
        { descripcion: 'Botines de seguridad' }, { descripcion: 'Protección auditiva' },
        { descripcion: 'Arnés de cuerpo completo', critico: true }
    ],
    TRAZADOR: [
        { descripcion: 'Casco de seguridad' }, { descripcion: 'Barbiquejo' },
        { descripcion: 'Lentes de seguridad' }, { descripcion: 'Guantes anticorte' },
        { descripcion: 'Botines de seguridad' },
        { descripcion: 'Arnés de cuerpo completo', critico: true },
        { descripcion: 'Caleros con tapa (EPP sílice)', critico: true },
        { descripcion: 'Bloqueador solar' }
    ]
};

const EPP_GENERICO = [
    { descripcion: 'Casco de seguridad' }, { descripcion: 'Lentes de seguridad' },
    { descripcion: 'Guantes de seguridad' }, { descripcion: 'Botines de seguridad' }
];

// ─── Constructores de kit ────────────────────────────────────────────────────
const itemEppDeCargo = (cargo) => ({
    key: 'ENTREGA_EPP', tipo: 'ENTREGA_EPP', codigoEbco: 'PR-FR-85',
    titulo: 'Entrega y capacitación de EPP', articulo: 'Art. 13',
    naturaleza: 'evidencia_individual', alcancePlantilla: 'persona',
    accion: 'ENTREGA_EPP', matrizEpp: DS44_EPP_MATRIZ[cargo] || EPP_GENERICO
});

const kitTransversal = (cargo) => [
    { key: 'RI_76', tipo: 'REGLAMENTO_INTERNO', codigoEbco: 'RI 76', titulo: 'Reglamento Interno (RIHS/RIOHS)', articulo: 'Art. 156 CT', naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'tenant', accion: 'DIFUSION_FIRMA' },
    { key: 'POLITICA_SST', tipo: 'POLITICA_SSO', titulo: 'Política SST', naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'tenant', accion: 'DIFUSION_FIRMA' },
    { key: 'PLAN_EMERGENCIAS', tipo: 'PLAN_EMERGENCIAS', codigoEbco: 'PR-PDO-07.01', titulo: 'Plan de Emergencias de la Obra', articulo: 'Art. 19', naturaleza: 'derivado_miper', alcancePlantilla: 'obra', accion: 'DIFUSION_FIRMA' },
    { key: 'IRL', tipo: 'IRL', titulo: 'IRL — Información de Riesgos Laborales del cargo', articulo: 'Art. 15', naturaleza: 'derivado_miper', alcancePlantilla: 'obra', accion: 'CAPACITACION_EVALUACION', notaMinima: 70, bloqueante: true },
    itemEppDeCargo(cargo),
    { key: 'ENCUESTA_PSICOSOCIAL', tipo: 'ENCUESTA_PSICOSOCIAL', titulo: 'Encuesta Psicosocial CEAL-SM / SUSESO', naturaleza: 'evidencia_individual', alcancePlantilla: 'persona', accion: 'ENCUESTA', protocolo: 'PSICOSOCIAL' }
];

const pp = (key, codigoEbco, titulo, articulo, notaMinima = 70) =>
    ({ key, tipo: key, codigoEbco, titulo, articulo, naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'tenant', accion: 'CAPACITACION_EVALUACION', notaMinima });
const dif = (key, codigoEbco, titulo, articulo) =>
    ({ key, tipo: key, codigoEbco, titulo, articulo, naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'tenant', accion: 'DIFUSION_FIRMA' });
const ext = (key, titulo, articulo, bloqueante = false) =>
    ({ key, tipo: key, titulo, articulo, naturaleza: 'evidencia_individual', alcancePlantilla: 'persona', accion: 'EVIDENCIA_EXTERNA', bloqueante });
const minsal = (protocolo, titulo) =>
    ({ key: `VIGILANCIA_${protocolo}`, tipo: `VIGILANCIA_${protocolo}`, titulo, articulo: 'Protocolo MINSAL', naturaleza: 'evidencia_individual', alcancePlantilla: 'persona', accion: 'INGRESO_VIGILANCIA', protocolo });

const ESPECIFICOS = {
    CARPINTERO: [
        ext('EXAMEN_ALTURA', 'Examen de altura física vigente', 'Examen ocupacional', true),
        pp('PR_PO_08', 'PR-PO-08', 'Trabajos en Altura', 'Art. 16', 90),
        pp('PR_PO_11', 'PR-PO-11', 'Moldajes y Descimbre', 'Anexo 8.1', 70),
        pp('PR_PO_23', 'PR-PO-23', 'Instalación de Sistemas de Seguridad', 'Cargo instalador', 70),
        pp('PR_PO_24', 'PR-PO-24', 'Plataformas de Trabajo', 'Art. 16', 70),
        pp('PR_PO_41', 'PR-PO-41', 'SPDC y Protecciones Colectivas', 'Art. 16', 90),
        pp('PR_PO_02', 'PR-PO-02', 'Vehículos y Maquinarias', 'Anexo 8.5', 70),
        dif('PR_PO_14', 'PR-PO-14', 'Orden y Aseo', 'Art. 16'),
        ext('CERT_MOLDAJES', 'Certificado proveedor de moldajes', 'Evidencia externa'),
        ext('CAP_ALZAHOMBRE', 'Capacitación alzahombre (proveedor)', 'Evidencia externa'),
        minsal('PREXOR', 'Vigilancia PREXOR'), minsal('TMERT', 'Vigilancia TMERT'),
        minsal('MMC', 'Vigilancia MMC'), minsal('RUV', 'Vigilancia RUV')
    ],
    JORNAL_ASEO: [
        pp('PR_PO_14', 'PR-PO-14', 'Orden y Aseo', 'Anexo 8.1', 70),
        dif('PR_PO_02', 'PR-PO-02', 'Vehículos y Maquinarias', 'Difusión'),
        dif('PR_PO_24', 'PR-PO-24', 'Plataformas de Trabajo', 'Difusión'),
        pp('PROC_DESCARGA_MIXER', 'PROC. ESPECÍFICO', 'Descarga de mixer', 'Procedimiento específico', 70),
        pp('CAP_LEY_KARIN', 'LEY KARIN', 'Capacitación Ley Karin', 'Ley 21.643', 70),
        minsal('RUV', 'Vigilancia RUV (PR-PMIN-12)'), minsal('TMERT', 'Vigilancia TMERT-MMC')
    ],
    MAESTRO_TERMINACIONES: [
        ext('EXAMEN_ALTURA', 'Examen de altura física vigente', 'Examen ocupacional', true),
        pp('PR_PO_22', 'PR-PO-22', 'Revestimiento', 'Procedimiento del cargo', 70),
        pp('PR_PO_08', 'PR-PO-08', 'Trabajos en Altura', 'SPDC anual', 90),
        pp('PR_PO_24', 'PR-PO-24', 'Plataformas de Trabajo', 'Art. 16', 70),
        pp('PR_PO_41', 'PR-PO-41', 'SPDC y Protecciones Colectivas', 'Art. 16', 90),
        dif('PR_PO_14', 'PR-PO-14', 'Orden y Aseo', 'Art. 16'),
        dif('PR_PO_02', 'PR-PO-02', 'Vehículos y Maquinarias', 'Difusión'),
        dif('HDS_QUIMICOS', 'HDS', 'HDS + ficha técnica por producto químico', 'Crítico: EPP respiratorio'),
        pp('CAP_HERRAMIENTAS', 'CAP. HERRAMIENTAS', 'Herramientas autorizadas (cuchillo retráctil)', 'Capacitación', 70),
        minsal('RUV', 'Vigilancia RUV'), minsal('PSICOSOCIAL', 'Vigilancia Psicosocial')
    ],
    MAESTRO_ALBANIL: [
        ext('EXAMEN_ALTURA', 'Examen de altura física vigente', 'Examen ocupacional', true),
        pp('PR_PO_08', 'PR-PO-08', 'Trabajos en Altura', 'SPDC anual', 90),
        pp('PR_PO_24', 'PR-PO-24', 'Plataformas de Trabajo (banquillos/escala 3 peldaños)', 'Art. 16', 70),
        pp('PR_PO_41', 'PR-PO-41', 'SPDC y Protecciones Colectivas', 'Art. 16', 90),
        pp('PR_PO_02', 'PR-PO-02', 'Vehículos y Maquinarias', 'Distancia con maquinaria', 70),
        dif('PR_PO_23', 'PR-PO-23', 'Instalación de Sistemas de Seguridad (usuario)', 'Usuario de anclajes'),
        dif('PR_PO_14', 'PR-PO-14', 'Orden y Aseo', 'Art. 16'),
        pp('CAP_LEY_KARIN', 'LEY KARIN', 'Capacitación Ley Karin', 'Ley 21.643', 70),
        minsal('PSICOSOCIAL', 'Vigilancia Psicosocial'), minsal('MMC', 'Vigilancia MMC')
    ],
    TRAZADOR: [
        ext('EXAMEN_ALTURA', 'Examen de altura física vigente', 'Examen ocupacional', true),
        pp('PR_PO_08', 'PR-PO-08', 'Trabajos en Altura (montaje pilares)', 'SPDC anual', 90),
        pp('PR_PO_41', 'PR-PO-41', 'SPDC y Protecciones Colectivas', 'Art. 16', 90),
        pp('PR_PO_02', 'PR-PO-02', 'Vehículos y Maquinarias', 'Art. 16', 70),
        dif('PR_PO_23', 'PR-PO-23', 'Instalación de Sistemas de Seguridad (banderas/fase amarilla)', 'Usuario'),
        dif('PR_PO_24', 'PR-PO-24', 'Plataformas de Trabajo', 'Difusión'),
        dif('PR_PO_14', 'PR-PO-14', 'Orden y Aseo', 'Art. 16'),
        pp('FICHA_PORTAESTACAS', 'FICHA N°1', 'Portaestacas / guantes anticorte', 'Capacitación', 70),
        dif('PR_PO_21_36_38', 'PR-PO-21/36/38', 'Vías despejadas, montaje pilares', 'Difusión'),
        minsal('SILICE', 'Vigilancia SÍLICE (candidato PREXOR)'), minsal('RUV', 'Vigilancia RUV')
    ]
};

// Kit genérico (cargos legacy / OTRO): equivale al onboarding actual.
const DS44_KIT_GENERICO = [
    { key: 'IRL', tipo: 'IRL', titulo: 'IRL — Información de Riesgos Laborales', articulo: 'Art. 15', naturaleza: 'derivado_miper', alcancePlantilla: 'obra', accion: 'CAPACITACION_EVALUACION', notaMinima: 70, bloqueante: true },
    { key: 'CAPACITACION_SST', tipo: 'CAPACITACION_SST', titulo: 'Capacitación SST 8 horas', articulo: 'Art. 16', naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'obra', accion: 'CAPACITACION_EVALUACION', notaMinima: 70, requiereFirmaRelator: true },
    { key: 'RI_76', tipo: 'REGLAMENTO_INTERNO', titulo: 'Entrega RIHS/RIOHS', articulo: 'Art. 56', naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'tenant', accion: 'DIFUSION_FIRMA' },
    { key: 'PROCEDIMIENTO_TRABAJO', tipo: 'PROCEDIMIENTO_TRABAJO', titulo: 'Procedimientos de Trabajo Seguro', articulo: 'Art. 10', naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'obra', accion: 'DIFUSION_FIRMA' },
    { key: 'ENTREGA_EPP', tipo: 'ENTREGA_EPP', titulo: 'Entrega y Capacitación EPP', articulo: 'Art. 13', naturaleza: 'evidencia_individual', alcancePlantilla: 'persona', accion: 'ENTREGA_EPP', matrizEpp: EPP_GENERICO },
    { key: 'INDUCCION', tipo: 'INDUCCION', titulo: 'Inducción Plan de Emergencia', articulo: 'Art. 19', naturaleza: 'evidencia_individual', alcancePlantilla: 'persona', accion: 'DIFUSION_FIRMA' }
];

const DS44_CARGO_KITS = {
    CARPINTERO: [...kitTransversal('CARPINTERO'), ...ESPECIFICOS.CARPINTERO],
    JORNAL_ASEO: [...kitTransversal('JORNAL_ASEO'), ...ESPECIFICOS.JORNAL_ASEO],
    MAESTRO_TERMINACIONES: [...kitTransversal('MAESTRO_TERMINACIONES'), ...ESPECIFICOS.MAESTRO_TERMINACIONES],
    MAESTRO_ALBANIL: [...kitTransversal('MAESTRO_ALBANIL'), ...ESPECIFICOS.MAESTRO_ALBANIL],
    TRAZADOR: [...kitTransversal('TRAZADOR'), ...ESPECIFICOS.TRAZADOR]
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const CARGO_LABEL_INDEX = DS44_CARGOS.reduce((acc, c) => { acc[c.codigo] = c.label; return acc; }, {});

const getCargoLabel = (codigo) => (codigo ? (CARGO_LABEL_INDEX[codigo] || codigo) : '');

const normalizeCargoCodigo = (input) => {
    if (!input) return 'OTRO';
    const raw = String(input).trim();
    if (CARGO_LABEL_INDEX[raw]) return raw;
    const n = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (n.includes('carpintero')) return 'CARPINTERO';
    if (n.includes('jornal') && (n.includes('aseo') || n.includes('acarreo'))) return 'JORNAL_ASEO';
    if (n.includes('terminacion') || n.includes('pintor') || n.includes('revestimiento')) return 'MAESTRO_TERMINACIONES';
    if (n.includes('albanil') || (n.includes('maestro') && n.includes('alban'))) return 'MAESTRO_ALBANIL';
    if (n.includes('trazador') || n.includes('topograf')) return 'TRAZADOR';
    const byLabel = DS44_CARGOS.find((c) => c.label.toLowerCase() === n);
    if (byLabel) return byLabel.codigo;
    if (n.includes('jornal')) return 'JORNAL';
    if (n.includes('operario')) return 'OPERARIO';
    if (n.includes('soldador')) return 'SOLDADOR';
    if (n.includes('electricista')) return 'ELECTRICISTA';
    if (n.includes('ayudante')) return 'AYUDANTE';
    return 'OTRO';
};

const isCargoLegacy = (codigo) => Boolean((DS44_CARGOS.find((x) => x.codigo === codigo) || {}).legacy);

const resolveCargoKit = (codigo) => (codigo && DS44_CARGO_KITS[codigo]) ? DS44_CARGO_KITS[codigo] : DS44_KIT_GENERICO;

// ─── Catálogo editable por tenant (constructor de cargos) ────────────────────
// El catálogo se persiste en Tenant.reglas.cargos. Esta función produce la
// SEMILLA con la que se siembra un tenant nuevo (o uno que aún no lo tiene):
// cada cargo lleva su kit embebido para que el tenant pueda editarlo.
const buildDefaultCargoCatalog = () => DS44_CARGOS.map((c) => ({
    codigo: c.codigo,
    label: c.label,
    legacy: Boolean(c.legacy),
    seed: true,                              // proviene de la semilla EBCO
    kit: (DS44_CARGO_KITS[c.codigo] || DS44_KIT_GENERICO).map((it) => ({ ...it }))
}));

// Resuelve el kit de un cargo desde el catálogo del TENANT (si existe), con
// fallback a la constante/genérico. Tenant-aware: lo usará runOnboarding.
const resolveCargoKitFromCatalog = (catalog, codigo) => {
    if (Array.isArray(catalog) && catalog.length) {
        const found = catalog.find((c) => c.codigo === codigo);
        if (found && Array.isArray(found.kit) && found.kit.length) return found.kit;
    }
    return resolveCargoKit(codigo);
};

// Saneo/validación mínima de un catálogo recibido del cliente (PUT cargos).
// Garantiza forma consistente y evita persistir basura. Lanza Error si inválido.
const sanitizeCargoCatalog = (catalog) => {
    if (!Array.isArray(catalog)) throw new Error('cargos debe ser una lista');
    const codigos = new Set();
    return catalog.map((c, i) => {
        const codigo = String(c?.codigo || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const label = String(c?.label || '').trim();
        if (!codigo) throw new Error(`Cargo ${i + 1}: código requerido`);
        if (!label) throw new Error(`Cargo ${i + 1}: nombre requerido`);
        if (codigos.has(codigo)) throw new Error(`Código duplicado: ${codigo}`);
        codigos.add(codigo);
        const kit = Array.isArray(c?.kit) ? c.kit : [];
        const keys = new Set();
        const kitSan = kit.map((it, j) => {
            const key = String(it?.key || it?.tipo || `ITEM_${j}`).trim();
            if (keys.has(key)) throw new Error(`${codigo}: ítem duplicado ${key}`);
            keys.add(key);
            return {
                key,
                tipo: String(it?.tipo || key).trim(),
                titulo: String(it?.titulo || '').trim() || key,
                articulo: it?.articulo ? String(it.articulo) : undefined,
                codigoEbco: it?.codigoEbco ? String(it.codigoEbco) : undefined,
                naturaleza: ['procedimiento_corporativo', 'derivado_miper', 'evidencia_individual'].includes(it?.naturaleza) ? it.naturaleza : 'procedimiento_corporativo',
                alcancePlantilla: ['tenant', 'obra', 'persona', 'ninguno'].includes(it?.alcancePlantilla) ? it.alcancePlantilla : 'tenant',
                accion: ['DIFUSION_FIRMA', 'CAPACITACION_EVALUACION', 'ENTREGA_EPP', 'EVIDENCIA_EXTERNA', 'INGRESO_VIGILANCIA', 'ENCUESTA'].includes(it?.accion) ? it.accion : 'DIFUSION_FIRMA',
                bloqueante: Boolean(it?.bloqueante),
                notaMinima: it?.notaMinima === 90 ? 90 : (it?.notaMinima === 70 ? 70 : undefined),
                requiereFirmaRelator: it?.requiereFirmaRelator ? true : undefined,
                matrizEpp: Array.isArray(it?.matrizEpp) ? it.matrizEpp.map((e) => ({ descripcion: String(e?.descripcion || '').trim(), critico: Boolean(e?.critico) })).filter((e) => e.descripcion) : undefined,
                protocolo: it?.protocolo ? String(it.protocolo) : undefined
            };
        });
        return { codigo, label, legacy: Boolean(c?.legacy), seed: Boolean(c?.seed), kit: kitSan };
    });
};

module.exports = {
    DS44_CARGOS,
    DS44_EPP_MATRIZ,
    DS44_CARGO_KITS,
    DS44_KIT_GENERICO,
    getCargoLabel,
    normalizeCargoCodigo,
    isCargoLegacy,
    resolveCargoKit,
    buildDefaultCargoCatalog,
    resolveCargoKitFromCatalog,
    sanitizeCargoCatalog
};
