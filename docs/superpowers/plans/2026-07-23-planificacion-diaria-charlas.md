# Planificación Diaria de Charlas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cumplir el checklist de 8 puntos de charlas/planificación diaria: catálogos configurables por tenant (temas/recursos/riesgos/medidas), bloque `planificacion` en la actividad, protector solar por trabajo exterior, observaciones (Comité Paritario), formularios estructurados de permisos de trabajo y reporte post-charla con descarga.

**Architecture:** La charla diaria (`CHARLA_5MIN`) y el ART son la planificación diaria; todos los campos nuevos viven en el ítem de actividad (DynamoDB, schemaless, retrocompatible). Los catálogos se guardan en `tenant.reglas.catalogosActividad` imitando el patrón existente de `reglas.cargos` (`GET/PUT /tenants/{id}/cargos`). Toda la lógica de validación es pura y vive en `Backend/lib/catalogos-actividad.js`, testeada con `node --test`; los handlers solo orquestan.

**Tech Stack:** Node.js (Lambda + serverless.yml), DynamoDB via `@aws-sdk/lib-dynamodb`, React + TypeScript (Vite), `node --test` para tests backend (nuevo — el repo no tenía tests).

**Spec:** `docs/superpowers/specs/2026-07-23-planificacion-diaria-charlas-design.md`

## Global Constraints

- Todo el texto visible al usuario en español de Chile; código y claves en el estilo existente (`MAYUSCULA_SNAKE` para códigos, camelCase para campos).
- No agregar dependencias nuevas (ni backend ni frontend). Tests backend con `node --test` nativo.
- Retrocompatibilidad: actividades existentes no tienen `planificacion` ni `permisosTrabajo`; todo render y validación debe tolerar su ausencia.
- Las firmas y asistencias son intocables: ningún endpoint nuevo puede modificar `asistentes` ni `firmaRelator`.
- Comentarios solo para restricciones que el código no muestra (estilo del repo: explican el "por qué" normativo/de negocio).
- Verificación frontend: `npx tsc --noEmit -p Frontend/` sin errores. Verificación backend: `node --test Backend/tests/` y `node --check` de cada handler tocado.
- Commits frecuentes, mensajes en español (estilo del repo), con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

### Deviaciones menores respecto del spec (decididas al planificar)

1. El frontend obtiene los catálogos vía `GET /tenants/{id}/catalogos-actividad` (endpoint que existe de todos modos para administración) en vez de inflar la respuesta de `GET /activities`. Un solo origen de verdad y el list no carga al tenant en cada llamada.
2. La respuesta de ese GET incluye también `permisosTrabajoDef` (definición de los 3 permisos con sus checklists) para que el frontend no duplique esa definición.
3. La descarga del reporte se implementa abriendo una ventana con el HTML del reporte y `window.print()` (patrón más robusto que `@media print` sobre el modal; mismo resultado para el usuario).

---

### Task 1: Lógica pura — `catalogos-actividad.js` + tests

**Files:**
- Create: `Backend/lib/catalogos-actividad.js`
- Create: `Backend/tests/catalogos-actividad.test.js`
- Modify: `Backend/package.json` (agregar script `test`)

**Interfaces:**
- Consumes: nada (módulo hoja, sin dependencias).
- Produces (usado por Tasks 2 y 3):
  - `DEFAULT_CATALOGOS: { temas, recursos, riesgos, medidas }` — cada uno `Array<{codigo: string, label: string}>`
  - `PERMISOS_TRABAJO_DEF: { ALTURA|ESPACIO_CONFINADO|TRABAJO_CALIENTE: { label: string, checklist: Array<{key: string, label: string}> } }`
  - `sanitizeCatalogosActividad(input) → catalogos` (throws `Error` con mensaje claro si inválido)
  - `resolveCatalogos(tenant) → catalogos` (tenant puede ser null)
  - `validatePlanificacion(input, catalogos, tipoActividad) → { value: object|null, errores: string[] }`
  - `validatePermisosTrabajo(input, responsablesValidos: Set<string>) → { value: Array, errores: string[] }`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `Backend/tests/catalogos-actividad.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_CATALOGOS,
    PERMISOS_TRABAJO_DEF,
    sanitizeCatalogosActividad,
    resolveCatalogos,
    validatePlanificacion,
    validatePermisosTrabajo,
} = require('../lib/catalogos-actividad');

// ── Defaults ──
test('DEFAULT_CATALOGOS trae las 4 listas no vacías con codigo+label', () => {
    for (const key of ['temas', 'recursos', 'riesgos', 'medidas']) {
        assert.ok(Array.isArray(DEFAULT_CATALOGOS[key]) && DEFAULT_CATALOGOS[key].length > 0, key);
        for (const item of DEFAULT_CATALOGOS[key]) {
            assert.match(item.codigo, /^[A-Z0-9_]+$/);
            assert.ok(item.label.trim().length > 0);
        }
    }
});

test('PERMISOS_TRABAJO_DEF define los 3 permisos con checklist de 5 ítems', () => {
    assert.deepEqual(Object.keys(PERMISOS_TRABAJO_DEF).sort(), ['ALTURA', 'ESPACIO_CONFINADO', 'TRABAJO_CALIENTE']);
    for (const def of Object.values(PERMISOS_TRABAJO_DEF)) {
        assert.equal(def.checklist.length, 5);
    }
});

// ── sanitizeCatalogosActividad ──
test('sanitize acepta un catálogo válido y normaliza códigos', () => {
    const out = sanitizeCatalogosActividad({
        temas: [{ codigo: ' fraguado ', label: ' Fraguado ' }],
        recursos: [], riesgos: [], medidas: [],
    });
    assert.deepEqual(out.temas, [{ codigo: 'FRAGUADO', label: 'Fraguado' }]);
    assert.deepEqual(out.recursos, []);
});

test('sanitize rechaza códigos duplicados y labels vacíos', () => {
    assert.throws(() => sanitizeCatalogosActividad({
        temas: [{ codigo: 'X', label: 'a' }, { codigo: 'X', label: 'b' }],
        recursos: [], riesgos: [], medidas: [],
    }), /duplicado/i);
    assert.throws(() => sanitizeCatalogosActividad({
        temas: [{ codigo: 'X', label: '  ' }],
        recursos: [], riesgos: [], medidas: [],
    }), /label/i);
});

test('sanitize rechaza estructuras que no son listas', () => {
    assert.throws(() => sanitizeCatalogosActividad({ temas: 'no', recursos: [], riesgos: [], medidas: [] }));
});

// ── resolveCatalogos ──
test('resolveCatalogos usa el default si el tenant no tiene catálogo', () => {
    assert.deepEqual(resolveCatalogos(null), DEFAULT_CATALOGOS);
    assert.deepEqual(resolveCatalogos({ reglas: {} }), DEFAULT_CATALOGOS);
});

test('resolveCatalogos usa la lista del tenant cuando existe, y default por lista vacía', () => {
    const tenant = { reglas: { catalogosActividad: { temas: [{ codigo: 'PROPIO', label: 'Propio' }], recursos: [] } } };
    const out = resolveCatalogos(tenant);
    assert.deepEqual(out.temas, [{ codigo: 'PROPIO', label: 'Propio' }]);
    assert.deepEqual(out.recursos, DEFAULT_CATALOGOS.recursos);
});

// ── validatePlanificacion ──
const CAT = DEFAULT_CATALOGOS;

test('planificacion válida completa se normaliza', () => {
    const { value, errores } = validatePlanificacion({
        tema: { codigo: 'FRAGUADO' },
        recursos: { codigos: ['BETONERA'], otro: '' },
        riesgos: { codigos: ['CAIDA_DESNIVEL'], otro: 'otro riesgo' },
        medidas: { codigos: ['USO_EPP'] },
        tipoTrabajo: 'exterior',
        condicionClimatica: 'despejado',
        protectorSolar: true,
        observaciones: ' ok ',
    }, CAT, 'CHARLA_5MIN');
    assert.deepEqual(errores, []);
    assert.equal(value.tema.codigo, 'FRAGUADO');
    assert.equal(value.protectorSolar, true);
    assert.equal(value.observaciones, 'ok');
    assert.equal(value.riesgos.otro, 'otro riesgo');
});

test('tema es obligatorio (codigo u otro) en CHARLA_5MIN y ART, no en otros tipos', () => {
    assert.ok(validatePlanificacion({}, CAT, 'CHARLA_5MIN').errores.length > 0);
    assert.ok(validatePlanificacion(undefined, CAT, 'ART').errores.length > 0);
    assert.deepEqual(validatePlanificacion({ observaciones: 'acta' }, CAT, 'REUNION_COMITE').errores, []);
    // Sin planificación en tipos que no la requieren → value null, sin errores.
    assert.deepEqual(validatePlanificacion(undefined, CAT, 'REUNION_COMITE'), { value: null, errores: [] });
    assert.deepEqual(validatePlanificacion({ tema: { otro: 'tema libre' } }, CAT, 'ART').errores, []);
});

test('códigos fuera del catálogo → error', () => {
    const { errores } = validatePlanificacion({
        tema: { codigo: 'NO_EXISTE' },
    }, CAT, 'CHARLA_5MIN');
    assert.ok(errores.some(e => /NO_EXISTE/.test(e)));
});

test('protectorSolar se anula si el trabajo no es exterior', () => {
    const { value } = validatePlanificacion({
        tema: { codigo: 'ASEO_ORDEN' }, tipoTrabajo: 'interior', protectorSolar: true,
    }, CAT, 'CHARLA_5MIN');
    assert.equal(value.protectorSolar, null);
});

test('enums inválidos y largos excedidos → error', () => {
    const { errores } = validatePlanificacion({
        tema: { otro: 'x'.repeat(201) }, tipoTrabajo: 'submarino', condicionClimatica: 'granizo',
        observaciones: 'x'.repeat(4001),
    }, CAT, 'CHARLA_5MIN');
    assert.ok(errores.length >= 3);
});

// ── validatePermisosTrabajo ──
const RESP = new Set(['p-1']);
const permisoBase = {
    tipo: 'ALTURA', responsableId: 'p-1', horaInicio: '08:00', horaFin: '13:00',
    ubicacion: 'Piso 4', checklist: {
        arnes_inspeccionado: 'si', anclajes_definidos: 'si', plataformas_revisadas: 'si',
        examen_altura_vigente: 'si', area_delimitada: 'na',
    },
};

test('permiso completo válido: completo=true', () => {
    const { value, errores } = validatePermisosTrabajo([permisoBase], RESP);
    assert.deepEqual(errores, []);
    assert.equal(value[0].completo, true);
});

test('checklist incompleto → completo=false pero sin error', () => {
    const p = { ...permisoBase, checklist: { arnes_inspeccionado: 'si' } };
    const { value, errores } = validatePermisosTrabajo([p], RESP);
    assert.deepEqual(errores, []);
    assert.equal(value[0].completo, false);
});

test('tipo inválido, responsable desconocido, hora malformada y tipo duplicado → errores', () => {
    assert.ok(validatePermisosTrabajo([{ ...permisoBase, tipo: 'BUCEO' }], RESP).errores.length > 0);
    assert.ok(validatePermisosTrabajo([{ ...permisoBase, responsableId: 'nadie' }], RESP).errores.length > 0);
    assert.ok(validatePermisosTrabajo([{ ...permisoBase, horaInicio: '8am' }], RESP).errores.length > 0);
    assert.ok(validatePermisosTrabajo([permisoBase, permisoBase], RESP).errores.length > 0);
});

test('claves de checklist ajenas a la definición → error; lista vacía/undefined → []', () => {
    const p = { ...permisoBase, checklist: { ...permisoBase.checklist, sabotaje: 'si' } };
    assert.ok(validatePermisosTrabajo([p], RESP).errores.length > 0);
    assert.deepEqual(validatePermisosTrabajo(undefined, RESP), { value: [], errores: [] });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test Backend/tests/`
Expected: FAIL — `Cannot find module '../lib/catalogos-actividad'`

- [ ] **Step 3: Implementar `Backend/lib/catalogos-actividad.js`**

```js
// Catálogos de la planificación diaria (charlas/ART) y permisos de trabajo
// especiales. Los catálogos son configurables por tenant
// (tenant.reglas.catalogosActividad); estos son los valores de fábrica.
// Los checklists de permisos son fijos (no configurables) en esta fase.

const DEFAULT_CATALOGOS = {
    temas: [
        { codigo: 'ASEO_ORDEN', label: 'Aseo y orden' },
        { codigo: 'CARPINTERIA', label: 'Carpintería' },
        { codigo: 'FRAGUADO', label: 'Fraguado' },
        { codigo: 'HORMIGONADO', label: 'Hormigonado' },
        { codigo: 'EXCAVACIONES', label: 'Excavaciones' },
        { codigo: 'ENFIERRADURA', label: 'Enfierradura' },
        { codigo: 'ANDAMIOS', label: 'Armado y uso de andamios' },
        { codigo: 'INST_ELECTRICAS', label: 'Instalaciones eléctricas' },
        { codigo: 'TRABAJO_ALTURA', label: 'Trabajos en altura' },
        { codigo: 'IZAJE', label: 'Izaje y maniobras' },
        { codigo: 'DEMOLICION', label: 'Demolición' },
        { codigo: 'SOLDADURA', label: 'Soldadura' },
        { codigo: 'PINTURA', label: 'Pintura y terminaciones' },
        { codigo: 'MANEJO_CARGAS', label: 'Manejo manual de cargas' },
    ],
    recursos: [
        { codigo: 'BETONERA', label: 'Betonera' },
        { codigo: 'ANDAMIO', label: 'Andamio' },
        { codigo: 'ESMERIL', label: 'Esmeril angular' },
        { codigo: 'TALADRO', label: 'Taladro' },
        { codigo: 'SOLDADORA', label: 'Soldadora' },
        { codigo: 'GRUA', label: 'Grúa / equipo de izaje' },
        { codigo: 'HERRAMIENTAS_MANO', label: 'Herramientas de mano' },
        { codigo: 'PLATAFORMA_ELEVADORA', label: 'Plataforma elevadora' },
        { codigo: 'GENERADOR', label: 'Generador' },
        { codigo: 'COMPRESOR', label: 'Compresor' },
    ],
    riesgos: [
        { codigo: 'CAIDA_DESNIVEL', label: 'Caída a desnivel' },
        { codigo: 'CAIDA_NIVEL', label: 'Caída a nivel' },
        { codigo: 'GOLPES', label: 'Golpes por o contra objetos' },
        { codigo: 'ATRAPAMIENTO', label: 'Atrapamiento' },
        { codigo: 'CONTACTO_ELECTRICO', label: 'Contacto eléctrico' },
        { codigo: 'PROYECCION_PARTICULAS', label: 'Proyección de partículas' },
        { codigo: 'SOBREESFUERZO', label: 'Sobreesfuerzo' },
        { codigo: 'RUIDO', label: 'Exposición a ruido' },
        { codigo: 'POLVO_SILICE', label: 'Exposición a polvo / sílice' },
        { codigo: 'RADIACION_UV', label: 'Exposición a radiación UV' },
        { codigo: 'INCENDIO_EXPLOSION', label: 'Incendio o explosión' },
        { codigo: 'ATROPELLO', label: 'Atropello por maquinaria' },
    ],
    medidas: [
        { codigo: 'USO_EPP', label: 'Uso de EPP' },
        { codigo: 'REVISION_PLATAFORMAS', label: 'Revisión de plataformas' },
        { codigo: 'PROTOCOLOS_PTS', label: 'Aplicación de protocolos / PTS' },
        { codigo: 'CHEQUEO_HERRAMIENTAS', label: 'Chequeo de herramientas' },
        { codigo: 'SENALIZACION', label: 'Señalización y segregación de áreas' },
        { codigo: 'BLOQUEO_ENERGIAS', label: 'Bloqueo de energías (LOTO)' },
        { codigo: 'ORDEN_ASEO', label: 'Orden y aseo' },
        { codigo: 'HIDRATACION', label: 'Hidratación y pausas' },
        { codigo: 'VENTILACION', label: 'Ventilación' },
        { codigo: 'SUPERVISION', label: 'Supervisión permanente' },
    ],
};

const CATALOGO_KEYS = ['temas', 'recursos', 'riesgos', 'medidas'];
const TIPOS_TRABAJO = ['interior', 'exterior'];
const CONDICIONES_CLIMATICAS = ['despejado', 'parcial', 'nublado', 'lluvia'];
// Tipos de actividad cuya planificación diaria exige tema tratado.
const TIPOS_CON_PLANIFICACION = ['CHARLA_5MIN', 'ART'];

const PERMISOS_TRABAJO_DEF = {
    ALTURA: {
        label: 'Trabajo en altura',
        checklist: [
            { key: 'arnes_inspeccionado', label: 'Arnés y cabo de vida inspeccionados' },
            { key: 'anclajes_definidos', label: 'Puntos de anclaje / línea de vida definidos' },
            { key: 'plataformas_revisadas', label: 'Plataformas y andamios revisados' },
            { key: 'examen_altura_vigente', label: 'Examen de altura vigente del personal' },
            { key: 'area_delimitada', label: 'Delimitación del área bajo el trabajo' },
        ],
    },
    ESPACIO_CONFINADO: {
        label: 'Espacio confinado',
        checklist: [
            { key: 'medicion_gases', label: 'Medición de gases realizada' },
            { key: 'ventilacion', label: 'Ventilación asegurada' },
            { key: 'vigia_exterior', label: 'Vigía asignado en el exterior' },
            { key: 'comunicacion_rescate', label: 'Medios de comunicación y rescate disponibles' },
            { key: 'energias_bloqueadas', label: 'Energías bloqueadas (LOTO)' },
        ],
    },
    TRABAJO_CALIENTE: {
        label: 'Trabajo en caliente',
        checklist: [
            { key: 'extintor_area', label: 'Extintor disponible en el área' },
            { key: 'combustibles_retirados', label: 'Combustibles retirados o cubiertos' },
            { key: 'pantallas_instaladas', label: 'Biombos o pantallas instalados' },
            { key: 'vigia_fuego', label: 'Vigía de fuego durante y después del trabajo' },
            { key: 'chequeo_final', label: 'Chequeo del área al finalizar' },
        ],
    },
};

const MAX_ITEMS_POR_LISTA = 100;
const MAX_LABEL = 80;
const MAX_OTRO = 200;
const MAX_UBICACION = 200;
const MAX_OBSERVACIONES = 4000;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const normalizeCodigo = (raw) => String(raw || '')
    .trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Valida y normaliza el catálogo enviado por el tenant. Lanza Error con
 * mensaje descriptivo si la estructura es inválida (el handler lo devuelve
 * como 400).
 */
const sanitizeCatalogosActividad = (input) => {
    if (!input || typeof input !== 'object') throw new Error('Catálogo inválido: se espera un objeto con temas, recursos, riesgos y medidas');
    const out = {};
    for (const key of CATALOGO_KEYS) {
        const lista = input[key];
        if (!Array.isArray(lista)) throw new Error(`Catálogo inválido: "${key}" debe ser una lista`);
        if (lista.length > MAX_ITEMS_POR_LISTA) throw new Error(`Catálogo inválido: "${key}" supera el máximo de ${MAX_ITEMS_POR_LISTA} ítems`);
        const vistos = new Set();
        out[key] = lista.map((item) => {
            const codigo = normalizeCodigo(item?.codigo || item?.label);
            const label = String(item?.label || '').trim();
            if (!codigo) throw new Error(`Catálogo inválido: ítem de "${key}" sin código`);
            if (!label) throw new Error(`Catálogo inválido: el ítem "${codigo}" de "${key}" no tiene label`);
            if (label.length > MAX_LABEL) throw new Error(`Catálogo inválido: label de "${codigo}" supera ${MAX_LABEL} caracteres`);
            if (vistos.has(codigo)) throw new Error(`Catálogo inválido: código duplicado "${codigo}" en "${key}"`);
            vistos.add(codigo);
            return { codigo, label };
        });
    }
    return out;
};

/**
 * Catálogos efectivos de un tenant: su lista si existe y no está vacía,
 * el default de fábrica en caso contrario (lista por lista).
 */
const resolveCatalogos = (tenant) => {
    const propios = tenant?.reglas?.catalogosActividad || {};
    const out = {};
    for (const key of CATALOGO_KEYS) {
        out[key] = (Array.isArray(propios[key]) && propios[key].length) ? propios[key] : DEFAULT_CATALOGOS[key];
    }
    return out;
};

const validarSeleccion = (nombre, input, catalogo, errores) => {
    const codigos = [];
    for (const c of (Array.isArray(input?.codigos) ? input.codigos : [])) {
        const cod = String(c || '').trim();
        if (!catalogo.some((i) => i.codigo === cod)) errores.push(`${nombre}: código desconocido "${cod}"`);
        else if (!codigos.includes(cod)) codigos.push(cod);
    }
    let otro = input?.otro == null ? null : String(input.otro).trim() || null;
    if (otro && otro.length > MAX_OTRO) { errores.push(`${nombre}: "otro" supera ${MAX_OTRO} caracteres`); otro = null; }
    return { codigos, otro };
};

/**
 * Valida y normaliza el bloque de planificación diaria de una actividad.
 * El tema tratado (código del catálogo u "otro" libre) es obligatorio para
 * CHARLA_5MIN y ART; el resto de campos es opcional. protectorSolar solo
 * tiene sentido en trabajo exterior: en cualquier otro caso queda null.
 */
const validatePlanificacion = (input, catalogos, tipoActividad) => {
    const errores = [];
    const requiereTema = TIPOS_CON_PLANIFICACION.includes(tipoActividad);
    if (input == null) {
        if (requiereTema) errores.push('La planificación con tema tratado es obligatoria para este tipo de actividad');
        return { value: null, errores };
    }
    if (typeof input !== 'object') return { value: null, errores: ['planificacion debe ser un objeto'] };

    const temaCodigo = input.tema?.codigo ? String(input.tema.codigo).trim() : null;
    let temaOtro = input.tema?.otro ? String(input.tema.otro).trim() : null;
    if (temaCodigo && !catalogos.temas.some((t) => t.codigo === temaCodigo)) {
        errores.push(`Tema tratado: código desconocido "${temaCodigo}"`);
    }
    if (temaOtro && temaOtro.length > MAX_OTRO) { errores.push(`Tema tratado: "otro" supera ${MAX_OTRO} caracteres`); temaOtro = null; }
    if (requiereTema && !temaCodigo && !temaOtro) errores.push('El tema tratado es obligatorio (elige uno del listado o escribe otro)');

    const recursos = validarSeleccion('Recursos', input.recursos, catalogos.recursos, errores);
    const riesgos = validarSeleccion('Riesgos', input.riesgos, catalogos.riesgos, errores);
    const medidas = validarSeleccion('Medidas de prevención', input.medidas, catalogos.medidas, errores);

    const tipoTrabajo = input.tipoTrabajo == null ? null : String(input.tipoTrabajo);
    if (tipoTrabajo && !TIPOS_TRABAJO.includes(tipoTrabajo)) errores.push(`Tipo de trabajo inválido: "${tipoTrabajo}"`);
    const condicionClimatica = input.condicionClimatica == null ? null : String(input.condicionClimatica);
    if (condicionClimatica && !CONDICIONES_CLIMATICAS.includes(condicionClimatica)) errores.push(`Condición climática inválida: "${condicionClimatica}"`);

    const protectorSolar = tipoTrabajo === 'exterior' && typeof input.protectorSolar === 'boolean'
        ? input.protectorSolar : null;

    const observaciones = String(input.observaciones || '').trim();
    if (observaciones.length > MAX_OBSERVACIONES) errores.push(`Observaciones supera ${MAX_OBSERVACIONES} caracteres`);

    return {
        errores,
        value: errores.length ? null : {
            tema: { codigo: temaCodigo, otro: temaOtro },
            recursos, riesgos, medidas,
            tipoTrabajo: TIPOS_TRABAJO.includes(tipoTrabajo) ? tipoTrabajo : null,
            condicionClimatica: CONDICIONES_CLIMATICAS.includes(condicionClimatica) ? condicionClimatica : null,
            protectorSolar,
            observaciones,
        },
    };
};

/**
 * Valida y normaliza los permisos de trabajo especiales embebidos en una
 * actividad. `responsablesValidos` es el set de personaIds del tenant ya
 * verificados por el handler. `completo` lo calcula SIEMPRE el backend:
 * checklist íntegramente respondido + responsable + horario.
 */
const validatePermisosTrabajo = (input, responsablesValidos) => {
    const errores = [];
    if (input == null) return { value: [], errores };
    if (!Array.isArray(input)) return { value: [], errores: ['permisosTrabajo debe ser una lista'] };
    const tiposVistos = new Set();
    const value = [];
    for (const p of input) {
        const tipo = String(p?.tipo || '');
        const def = PERMISOS_TRABAJO_DEF[tipo];
        if (!def) { errores.push(`Permiso de trabajo desconocido: "${tipo}"`); continue; }
        if (tiposVistos.has(tipo)) { errores.push(`Permiso duplicado: "${tipo}"`); continue; }
        tiposVistos.add(tipo);

        const responsableId = String(p?.responsableId || '').trim();
        if (!responsableId) errores.push(`${def.label}: falta el responsable`);
        else if (!responsablesValidos.has(responsableId)) errores.push(`${def.label}: el responsable no pertenece a la empresa`);

        const horaInicio = String(p?.horaInicio || '').trim();
        const horaFin = String(p?.horaFin || '').trim();
        if (horaInicio && !HORA_RE.test(horaInicio)) errores.push(`${def.label}: hora de inicio inválida`);
        if (horaFin && !HORA_RE.test(horaFin)) errores.push(`${def.label}: hora de término inválida`);

        const ubicacion = String(p?.ubicacion || '').trim();
        if (ubicacion.length > MAX_UBICACION) errores.push(`${def.label}: ubicación supera ${MAX_UBICACION} caracteres`);

        const checklist = {};
        const keysDef = def.checklist.map((i) => i.key);
        for (const [k, v] of Object.entries(p?.checklist || {})) {
            if (!keysDef.includes(k)) { errores.push(`${def.label}: ítem de checklist desconocido "${k}"`); continue; }
            if (!['si', 'no', 'na'].includes(v)) { errores.push(`${def.label}: respuesta inválida en "${k}"`); continue; }
            checklist[k] = v;
        }

        const completo = Boolean(
            responsableId && responsablesValidos.has(responsableId)
            && HORA_RE.test(horaInicio) && HORA_RE.test(horaFin)
            && keysDef.every((k) => checklist[k])
        );

        value.push({
            tipo, responsableId,
            responsableNombre: String(p?.responsableNombre || '').trim(),
            horaInicio, horaFin, ubicacion, checklist, completo,
        });
    }
    return { value: errores.length ? [] : value, errores };
};

module.exports = {
    DEFAULT_CATALOGOS,
    PERMISOS_TRABAJO_DEF,
    TIPOS_CON_PLANIFICACION,
    sanitizeCatalogosActividad,
    resolveCatalogos,
    validatePlanificacion,
    validatePermisosTrabajo,
};
```

- [ ] **Step 4: Agregar el script de test y correr**

En `Backend/package.json`, dentro de `"scripts"`, agregar:

```json
"test": "node --test tests/"
```

Run: `cd Backend && npm test`
Expected: PASS — todos los tests en verde.

- [ ] **Step 5: Commit**

```bash
git add Backend/lib/catalogos-actividad.js Backend/tests/catalogos-actividad.test.js Backend/package.json
git commit -m "feat: catálogos de planificación diaria y validación de permisos de trabajo (con tests node --test)"
```

---

### Task 2: Endpoints de catálogos en tenants-module

**Files:**
- Modify: `Backend/handlers/tenants-module/handler.js` (junto a los endpoints de cargos, ~línea 265)

**Interfaces:**
- Consumes: `sanitizeCatalogosActividad`, `resolveCatalogos`, `PERMISOS_TRABAJO_DEF` de `../../lib/catalogos-actividad` (Task 1).
- Produces:
  - `GET /tenants/{id}/catalogos-actividad` → `{ catalogos: {temas,recursos,riesgos,medidas}, permisosTrabajoDef, sembrado: boolean }`
  - `PUT /tenants/{id}/catalogos-actividad` body `{ catalogos }` → `{ message, catalogos }`
- El routing por `{proxy+}` de `/tenants` ya existe: NO se toca `serverless.yml`.

- [ ] **Step 1: Implementar ambos endpoints**

Agregar el require junto a los existentes (línea ~10):

```js
const { sanitizeCatalogosActividad, resolveCatalogos, PERMISOS_TRABAJO_DEF } = require('../../lib/catalogos-actividad');
```

Inmediatamente después del bloque `PUT /tenants/{id}/cargos` (buscar `action === 'cargos'`), agregar:

```js
        // GET /tenants/{id}/catalogos-actividad — Catálogos de la planificación
        // diaria (temas/recursos/riesgos/medidas). Si el tenant no los ha
        // personalizado devuelve la semilla de fábrica sin persistirla.
        if (method === 'GET' && tenantId && action === 'catalogos-actividad') {
            const tenant = await tenantService.getById(tenantId);
            if (!tenant) return error('Tenant no encontrado', 404);
            return success({
                catalogos: resolveCatalogos(tenant),
                permisosTrabajoDef: PERMISOS_TRABAJO_DEF,
                sembrado: !(tenant.reglas?.catalogosActividad),
            });
        }

        // PUT /tenants/{id}/catalogos-actividad — Guarda los catálogos.
        // Mergea en reglas.catalogosActividad sin pisar el resto de reglas.
        if (method === 'PUT' && tenantId && action === 'catalogos-actividad') {
            const body = JSON.parse(event.body || '{}');
            let catalogos;
            try {
                catalogos = sanitizeCatalogosActividad(body.catalogos);
            } catch (validationErr) {
                return error(validationErr.message, 400);
            }
            const tenant = await tenantService.getById(tenantId);
            if (!tenant) return error('Tenant no encontrado', 404);
            const reglas = { ...(tenant.reglas || {}), catalogosActividad: catalogos };
            await tenantService.updateConfig(tenantId, { reglas });
            return success({ message: 'Catálogos guardados', catalogos });
        }
```

- [ ] **Step 2: Verificar sintaxis y tests**

Run: `node --check Backend/handlers/tenants-module/handler.js && cd Backend && npm test`
Expected: sin errores de sintaxis; tests PASS.

- [ ] **Step 3: Commit**

```bash
git add Backend/handlers/tenants-module/handler.js
git commit -m "feat: GET/PUT /tenants/{id}/catalogos-actividad (catálogos de planificación diaria por tenant)"
```

---

### Task 3: Backend de actividades — `planificacion` + `permisosTrabajo` en create, y `PATCH /activities/{id}`

**Files:**
- Modify: `Backend/handlers/activities/handler.js`
- Modify: `Backend/serverless.yml` (ruta PATCH, junto a los endpoints de activities ~línea 332)

**Interfaces:**
- Consumes: `resolveCatalogos`, `validatePlanificacion`, `validatePermisosTrabajo` (Task 1); `TenantService`, `PersonaService`, `personaPuede`/`PERMISSIONS` de `../../lib/permissions`.
- Produces:
  - `POST /activities` acepta `planificacion` y `permisosTrabajo` (validados; 400 con detalle si inválidos). El ítem guardado incluye ambos campos (o `null`/`[]`).
  - `PATCH /activities/{id}` body `{ planificacion?, permisosTrabajo?, solicitanteId? }` → actividad actualizada. Solo modifica esos dos campos + `updatedAt`. 403 si el solicitante no es el relator ni tiene `ACTIVIDADES_CREAR`.

- [ ] **Step 1: Imports y helper de validación compartido**

En `Backend/handlers/activities/handler.js`, agregar a los requires:

```js
const { TenantService } = require('../../lib/services/TenantService');
const { PERMISSIONS, personaPuede } = require('../../lib/permissions');
const { resolveCatalogos, validatePlanificacion, validatePermisosTrabajo } = require('../../lib/catalogos-actividad');
```

Debajo de `MAX_OCURRENCIAS`, agregar el helper que usan create y patch:

```js
/**
 * Valida planificacion + permisosTrabajo de un body contra el catálogo del
 * tenant y las personas reales. Devuelve { planificacion, permisosTrabajo }
 * o lanza un Error cuyo message es apto para responder 400.
 */
const validarBloquesActividad = async ({ tenantId, tipo, planificacion, permisosTrabajo }) => {
    const tenantService = new TenantService();
    const personaService = new PersonaService();
    const tenant = await tenantService.getById(tenantId).catch(() => null);
    const catalogos = resolveCatalogos(tenant);

    const rPlan = validatePlanificacion(planificacion, catalogos, tipo);
    if (rPlan.errores.length) throw new Error(`Planificación inválida: ${rPlan.errores.join('; ')}`);

    // Responsables de permisos: deben ser personas existentes del tenant.
    const responsablesValidos = new Set();
    const nombres = {};
    for (const p of (Array.isArray(permisosTrabajo) ? permisosTrabajo : [])) {
        const rid = String(p?.responsableId || '').trim();
        if (!rid || responsablesValidos.has(rid)) continue;
        const persona = await personaService.getById(rid).catch(() => null);
        if (persona && persona.tenantId === tenantId) {
            responsablesValidos.add(rid);
            nombres[rid] = `${persona.nombre} ${persona.apellidoPaterno || persona.apellido || ''}`.trim();
        }
    }
    const rPerm = validatePermisosTrabajo(permisosTrabajo, responsablesValidos);
    if (rPerm.errores.length) throw new Error(`Permisos de trabajo inválidos: ${rPerm.errores.join('; ')}`);
    // Nombre denormalizado para el reporte (fuente: la persona real, no el cliente).
    for (const p of rPerm.value) p.responsableNombre = nombres[p.responsableId] || p.responsableNombre;

    return { planificacion: rPlan.value, permisosTrabajo: rPerm.value };
};
```

- [ ] **Step 2: Integrar en `create`**

En `module.exports.create`, después del bloque de validación de subtipo (línea ~86) y antes de `const now = ...`, agregar:

```js
        let bloques;
        try {
            bloques = await validarBloquesActividad({
                tenantId, tipo: body.tipo,
                planificacion: body.planificacion,
                permisosTrabajo: body.permisosTrabajo,
            });
        } catch (validationErr) {
            return error(validationErr.message, 400);
        }
```

Y en `baseActivity`, junto a `kitItemKey`, agregar:

```js
            planificacion: bloques.planificacion,
            permisosTrabajo: bloques.permisosTrabajo,
```

- [ ] **Step 3: Implementar `patch`**

Al final del archivo, agregar:

```js
/**
 * PATCH /activities/{id} - Completar el registro post-charla.
 * SOLO puede modificar planificacion y permisosTrabajo: las asistencias y
 * firmas son registro de auditoría y no se tocan por esta vía. Autorizado:
 * el relator de la actividad o quien tenga el permiso de crear actividades.
 */
module.exports.patch = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        if (!id) return error('ID de actividad requerido');
        const body = JSON.parse(event.body || '{}');

        const actResult = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { activityId: id } }));
        if (!actResult.Item) return error('Actividad no encontrada', 404);
        const activity = actResult.Item;

        const solicitanteId = body.solicitanteId || event.requestContext?.authorizer?.claims?.sub || null;
        if (!solicitanteId) return error('solicitanteId es requerido', 400);
        const personaService = new PersonaService();
        const solicitante = await personaService.getById(solicitanteId).catch(() => null);
        if (!solicitante || solicitante.tenantId !== activity.tenantId) {
            return error('No autorizado para editar esta actividad', 403);
        }
        if (solicitante.personaId !== activity.relatorId) {
            const tenant = await new TenantService().getById(activity.tenantId).catch(() => null);
            if (!personaPuede(solicitante, tenant, PERMISSIONS.ACTIVIDADES_CREAR)) {
                return error('No autorizado para editar esta actividad', 403);
            }
        }

        let bloques;
        try {
            bloques = await validarBloquesActividad({
                tenantId: activity.tenantId, tipo: activity.tipo,
                planificacion: body.planificacion !== undefined ? body.planificacion : activity.planificacion,
                permisosTrabajo: body.permisosTrabajo !== undefined ? body.permisosTrabajo : activity.permisosTrabajo,
            });
        } catch (validationErr) {
            return error(validationErr.message, 400);
        }

        const now = new Date().toISOString();
        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { activityId: id },
            UpdateExpression: 'SET planificacion = :p, permisosTrabajo = :pt, updatedAt = :u',
            ExpressionAttributeValues: { ':p': bloques.planificacion, ':pt': bloques.permisosTrabajo, ':u': now },
        }));

        return success({ ...activity, planificacion: bloques.planificacion, permisosTrabajo: bloques.permisosTrabajo, updatedAt: now });
    } catch (err) {
        console.error('Error patching activity:', err);
        return error(err.message, 500);
    }
};
```

- [ ] **Step 4: Ruta en serverless.yml**

Junto a los endpoints de activities (después de `getActivityStats`), agregar:

```yaml
  patchActivity:
    handler: handlers/activities/handler.patch
    events:
      - httpApi:
          path: /activities/{id}
          method: PATCH
```

- [ ] **Step 5: Verificar**

Run: `node --check Backend/handlers/activities/handler.js && cd Backend && npm test && npx serverless print > /dev/null && echo YAML_OK`
Expected: sin errores; tests PASS; `YAML_OK`.

(Nota: `serverless print` puede requerir credenciales; si falla por credenciales y no por sintaxis YAML, validar con `node -e "require('js-yaml')"` no está disponible — basta revisar la indentación contra el bloque `getActivityStats` vecino.)

- [ ] **Step 6: Commit**

```bash
git add Backend/handlers/activities/handler.js Backend/serverless.yml
git commit -m "feat: planificación diaria y permisos de trabajo en actividades (create validado + PATCH acotado)"
```

---

### Task 4: Tipos y métodos de API en el frontend

**Files:**
- Modify: `Frontend/src/api/activities.api.ts`
- Modify: `Frontend/src/api/tenants.api.ts`

**Interfaces:**
- Consumes: endpoints de Tasks 2 y 3; `apiRequest` de `./client` (mismo patrón que los métodos existentes del archivo).
- Produces (usado por Tasks 5–7):
  - Tipos: `PlanificacionActividad`, `SeleccionCatalogo`, `PermisoTrabajo`, `CatalogoItem`, `CatalogosActividad`, `PermisosTrabajoDef`
  - `activitiesApi.patch(id, data)` y campos nuevos en `Activity`/`CreateActivityData`
  - `tenantsApi.getCatalogosActividad(id)` / `tenantsApi.saveCatalogosActividad(id, catalogos)`

- [ ] **Step 1: Tipos en `activities.api.ts`**

Después de la interfaz `Attendee`, agregar:

```ts
export interface SeleccionCatalogo {
    codigos: string[];
    otro?: string | null;
}

export interface PlanificacionActividad {
    tema?: { codigo?: string | null; otro?: string | null } | null;
    recursos?: SeleccionCatalogo | null;
    riesgos?: SeleccionCatalogo | null;
    medidas?: SeleccionCatalogo | null;
    tipoTrabajo?: 'interior' | 'exterior' | null;
    condicionClimatica?: 'despejado' | 'parcial' | 'nublado' | 'lluvia' | null;
    /** Solo aplica cuando tipoTrabajo === 'exterior'; null en otro caso. */
    protectorSolar?: boolean | null;
    /** "Observaciones o participación y consulta" (Comité Paritario). */
    observaciones?: string;
}

export type PermisoTrabajoTipo = 'ALTURA' | 'ESPACIO_CONFINADO' | 'TRABAJO_CALIENTE';

export interface PermisoTrabajo {
    tipo: PermisoTrabajoTipo;
    responsableId: string;
    responsableNombre?: string;
    horaInicio: string;
    horaFin: string;
    ubicacion?: string;
    checklist: Record<string, 'si' | 'no' | 'na'>;
    /** Lo calcula el backend; el cliente solo lo muestra. */
    completo?: boolean;
}
```

En `Activity`, agregar (junto a `estado`):

```ts
    planificacion?: PlanificacionActividad | null;
    permisosTrabajo?: PermisoTrabajo[];
```

En `Attendee`, agregar `personaId?: string;` (el backend escribe `personaId`; `workerId` es legacy).

En `CreateActivityData`, agregar:

```ts
    planificacion?: PlanificacionActividad;
    permisosTrabajo?: PermisoTrabajo[];
```

En el objeto `activitiesApi`, agregar (mismo estilo que los métodos vecinos):

```ts
    /** Completar registro post-charla: SOLO planificacion y permisosTrabajo. */
    patch: (id: string, data: { planificacion?: PlanificacionActividad; permisosTrabajo?: PermisoTrabajo[]; solicitanteId?: string }) =>
        apiRequest<Activity>(`/activities/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
```

(Si `apiRequest` del archivo usa otra forma de pasar método/body — imitar exactamente la de `documentsApi.update` en `documents.api.ts`.)

- [ ] **Step 2: Tipos y métodos en `tenants.api.ts`**

Después de los tipos existentes, agregar:

```ts
export interface CatalogoItem { codigo: string; label: string; }

export interface CatalogosActividad {
    temas: CatalogoItem[];
    recursos: CatalogoItem[];
    riesgos: CatalogoItem[];
    medidas: CatalogoItem[];
}

export type PermisosTrabajoDef = Record<string, { label: string; checklist: { key: string; label: string }[] }>;
```

En el objeto `tenantsApi`, junto a `getCargos`/`saveCargos`:

```ts
    // Catálogos de planificación diaria (temas/recursos/riesgos/medidas).
    // Devuelve la semilla de fábrica si el tenant no los ha personalizado.
    getCatalogosActividad: (id: string) =>
        apiRequest<{ catalogos: CatalogosActividad; permisosTrabajoDef: PermisosTrabajoDef; sembrado: boolean }>(`/tenants/${id}/catalogos-actividad`),

    saveCatalogosActividad: (id: string, catalogos: CatalogosActividad) =>
        apiRequest<{ message: string; catalogos: CatalogosActividad }>(`/tenants/${id}/catalogos-actividad`, {
            method: 'PUT',
            body: JSON.stringify({ catalogos }),
        }),
```

(Igual que arriba: imitar la forma exacta de `saveCargos` para method/body.)

- [ ] **Step 3: Verificar y commitear**

Run: `cd Frontend && npx tsc --noEmit -p .`
Expected: sin errores.

```bash
git add Frontend/src/api/activities.api.ts Frontend/src/api/tenants.api.ts
git commit -m "feat: tipos y métodos de API para planificación diaria, permisos y catálogos"
```

---

### Task 5: Página de administración de catálogos

**Files:**
- Create: `Frontend/src/pages/CatalogosActividad.tsx`
- Modify: `Frontend/src/App.tsx` (ruta, junto a `/cargos-onboarding` línea ~141)
- Modify: `Frontend/src/components/Sidebar.tsx` (entrada de menú, sección Sistema línea ~71)

**Interfaces:**
- Consumes: `tenantsApi.getCatalogosActividad` / `saveCatalogosActividad`, tipos `CatalogosActividad`/`CatalogoItem` (Task 4); `useAuth` (tenantId), `useToast`, `PageHeader` de `../components/ui`, permiso `PERMISSIONS.CARGOS_GESTIONAR`.
- Produces: página en `/catalogos-actividad`.

- [ ] **Step 1: Crear la página**

`Frontend/src/pages/CatalogosActividad.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { FiPlus, FiTrash2, FiSave } from 'react-icons/fi';
import { tenantsApi, type CatalogosActividad as Catalogos, type CatalogoItem } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/ui';

const SECCIONES: { key: keyof Catalogos; titulo: string; hint: string }[] = [
    { key: 'temas', titulo: 'Temas tratados', hint: 'Temas estandarizados de la charla diaria (aseo, carpintería, fraguado…).' },
    { key: 'recursos', titulo: 'Recursos y equipos', hint: 'Equipos/herramientas utilizados en la planificación diaria.' },
    { key: 'riesgos', titulo: 'Riesgos comunes', hint: 'Riesgos identificables (caída a desnivel, golpes…).' },
    { key: 'medidas', titulo: 'Medidas de prevención', hint: 'Medidas aplicables (uso de EPP, revisión de plataformas…).' },
];

// El código se deriva del label solo al CREAR un ítem; después es estable
// (las actividades ya creadas lo referencian).
const codigoDesdeLabel = (label: string) => label
    .trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export default function CatalogosActividad() {
    const { user } = useAuth();
    const tenantId = user?.tenantId || '';
    const { toast } = useToast();
    const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [nuevos, setNuevos] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!tenantId) return;
        tenantsApi.getCatalogosActividad(tenantId).then((res) => {
            if (res.success && res.data) setCatalogos(res.data.catalogos);
            else toast.error(res.error || 'No se pudieron cargar los catálogos');
        }).finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId]);

    const codigosUsados = useMemo(() => {
        const s = new Set<string>();
        if (catalogos) for (const sec of SECCIONES) for (const i of catalogos[sec.key]) s.add(`${sec.key}:${i.codigo}`);
        return s;
    }, [catalogos]);

    const agregar = (key: keyof Catalogos) => {
        const label = (nuevos[key] || '').trim();
        if (!label || !catalogos) return;
        const codigo = codigoDesdeLabel(label);
        if (!codigo) return;
        if (codigosUsados.has(`${key}:${codigo}`)) { toast.error('Ya existe un ítem equivalente en esta lista'); return; }
        setCatalogos({ ...catalogos, [key]: [...catalogos[key], { codigo, label }] });
        setNuevos({ ...nuevos, [key]: '' });
    };

    const renombrar = (key: keyof Catalogos, idx: number, label: string) => {
        if (!catalogos) return;
        const lista = catalogos[key].map((it, i) => (i === idx ? { ...it, label } : it));
        setCatalogos({ ...catalogos, [key]: lista });
    };

    const eliminar = (key: keyof Catalogos, idx: number) => {
        if (!catalogos) return;
        setCatalogos({ ...catalogos, [key]: catalogos[key].filter((_, i) => i !== idx) });
    };

    const guardar = async () => {
        if (!catalogos || saving) return;
        setSaving(true);
        try {
            const res = await tenantsApi.saveCatalogosActividad(tenantId, catalogos);
            if (res.success && res.data) {
                setCatalogos(res.data.catalogos);
                toast.success('Catálogos guardados');
            } else toast.error(res.error || 'Error al guardar');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="flex items-center justify-center" style={{ height: '60vh' }}><div className="spinner" /></div>;

    return (
        <div className="page-content">
            <PageHeader
                banner
                scope={{ label: 'Empresa' }}
                title="Catálogos de actividades"
                description="Listados desplegables de la planificación diaria: temas tratados, recursos, riesgos y medidas de prevención. Aplican a todas las obras de la empresa."
                actions={
                    <button className="btn btn-save" disabled={saving || !catalogos} onClick={guardar}>
                        <FiSave /> {saving ? 'Guardando…' : 'Guardar cambios'}
                    </button>
                }
            />

            {catalogos && (
                <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)', alignItems: 'start' }}>
                    {SECCIONES.map(({ key, titulo, hint }) => (
                        <div key={key} className="card">
                            <div className="card-header">
                                <div>
                                    <h2 className="card-title">{titulo}</h2>
                                    <p className="card-subtitle">{hint}</p>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                {catalogos[key].map((item: CatalogoItem, idx: number) => (
                                    <div key={item.codigo} className="flex items-center gap-2">
                                        <input
                                            className="form-input"
                                            value={item.label}
                                            onChange={(e) => renombrar(key, idx, e.target.value)}
                                            aria-label={`Label de ${item.codigo}`}
                                        />
                                        <button
                                            className="btn btn-ghost btn-icon btn-sm"
                                            title="Eliminar"
                                            onClick={() => eliminar(key, idx)}
                                        >
                                            <FiTrash2 />
                                        </button>
                                    </div>
                                ))}
                                <div className="flex items-center gap-2">
                                    <input
                                        className="form-input"
                                        placeholder="Agregar ítem…"
                                        value={nuevos[key] || ''}
                                        onChange={(e) => setNuevos({ ...nuevos, [key]: e.target.value })}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(key); } }}
                                    />
                                    <button className="btn btn-secondary btn-sm" onClick={() => agregar(key)}>
                                        <FiPlus /> Agregar
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
```

Nota: si `CatalogosActividad`/`CatalogoItem` no se re-exportan desde `../api/client`, importarlos de `../api/tenants.api` (revisar cómo re-exporta `client.ts` y seguir ese patrón).

- [ ] **Step 2: Ruta y menú**

En `Frontend/src/App.tsx`, junto a la ruta de `/cargos-onboarding` (línea ~141):

```tsx
      <Route path="/catalogos-actividad" element={<ProtectedRoute requiredPermission={PERMISSIONS.CARGOS_GESTIONAR}><CatalogosActividad /></ProtectedRoute>} />
```

con su import `import CatalogosActividad from './pages/CatalogosActividad';`.

En `Frontend/src/components/Sidebar.tsx`, sección `Sistema`, después de la entrada Onboarding:

```tsx
            { path: '/catalogos-actividad', icon: FiList, label: 'Catálogos', permission: PERMISSIONS.CARGOS_GESTIONAR },
```

(agregar `FiList` al import de `react-icons/fi`).

- [ ] **Step 3: Verificar y commitear**

Run: `cd Frontend && npx tsc --noEmit -p .`
Expected: sin errores.

```bash
git add Frontend/src/pages/CatalogosActividad.tsx Frontend/src/App.tsx Frontend/src/components/Sidebar.tsx
git commit -m "feat: página de administración de catálogos de actividades (/catalogos-actividad)"
```

---

### Task 6: Formulario "Nueva Actividad" — planificación diaria y permisos

**Files:**
- Create: `Frontend/src/components/actividades/PlanificacionDiariaForm.tsx`
- Create: `Frontend/src/components/actividades/PermisosTrabajoForm.tsx`
- Modify: `Frontend/src/pages/Activities.tsx`

**Interfaces:**
- Consumes: tipos de Task 4; `tenantsApi.getCatalogosActividad`; `Select` de `../ui`.
- Produces:
  - `<PlanificacionDiariaForm value onChange catalogos tipoActividad />` — `value: PlanificacionActividad`, `onChange(next: PlanificacionActividad)`
  - `<PermisosTrabajoForm value onChange permisosDef workers />` — `value: PermisoTrabajo[]`, `onChange(next)`, `workers: {personaId, nombre, apellido?, cargo?}[]`
  - `Activities.tsx` envía `planificacion`/`permisosTrabajo` en el create y muestra `REUNION_COMITE`/`SIMULACRO` como tipos.

- [ ] **Step 1: `PlanificacionDiariaForm.tsx`**

```tsx
import { FiSun } from 'react-icons/fi';
import type { CatalogosActividad, CatalogoItem } from '../../api/client';
import type { PlanificacionActividad } from '../../api/client';
import { Select } from '../ui';

interface Props {
    value: PlanificacionActividad;
    onChange: (next: PlanificacionActividad) => void;
    catalogos: CatalogosActividad;
    /** Los campos de planificación completa solo aplican a CHARLA_5MIN y ART. */
    tipoActividad: string;
}

const OTRO = '__OTRO__';

// Temporada de alta radiación UV en Chile: 1 sep – 31 mar. Solo condiciona el
// AVISO; el campo de protector solar aparece siempre que el trabajo sea exterior.
const esTemporadaUV = () => {
    const mes = new Date().getMonth() + 1;
    return mes >= 9 || mes <= 3;
};

const opciones = (items: CatalogoItem[], conOtro: boolean) => [
    ...items.map((i) => ({ value: i.codigo, label: i.label })),
    ...(conOtro ? [{ value: OTRO, label: 'Otro…' }] : []),
];

/** Desplegable multi-selección simple sobre checkboxes (lista corta). */
function MultiCatalogo({ label, items, seleccion, otro, onToggle, onOtro, requerido = false }: {
    label: string; items: CatalogoItem[]; seleccion: string[]; otro: string | null | undefined;
    onToggle: (codigo: string) => void; onOtro: (texto: string | null) => void; requerido?: boolean;
}) {
    return (
        <div className="form-group">
            <label className="form-label">{label}{requerido ? ' *' : ''}</label>
            <div className="flex flex-col gap-1" style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2)' }}>
                {items.map((i) => (
                    <label key={i.codigo} className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
                        <input type="checkbox" checked={seleccion.includes(i.codigo)} onChange={() => onToggle(i.codigo)} />
                        {i.label}
                    </label>
                ))}
                <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={otro != null} onChange={() => onOtro(otro != null ? null : '')} />
                    Otro…
                </label>
                {otro != null && (
                    <input className="form-input" placeholder="Especificar…" maxLength={200} value={otro} onChange={(e) => onOtro(e.target.value)} />
                )}
            </div>
        </div>
    );
}

export default function PlanificacionDiariaForm({ value, onChange, catalogos, tipoActividad }: Props) {
    const set = (patch: Partial<PlanificacionActividad>) => onChange({ ...value, ...patch });
    const completa = tipoActividad === 'CHARLA_5MIN' || tipoActividad === 'ART';
    const esComite = tipoActividad === 'REUNION_COMITE';

    const toggleEn = (key: 'recursos' | 'riesgos' | 'medidas') => (codigo: string) => {
        const actual = value[key]?.codigos || [];
        const codigos = actual.includes(codigo) ? actual.filter((c) => c !== codigo) : [...actual, codigo];
        set({ [key]: { ...(value[key] || { codigos: [] }), codigos } });
    };
    const otroEn = (key: 'recursos' | 'riesgos' | 'medidas') => (texto: string | null) => {
        set({ [key]: { codigos: value[key]?.codigos || [], otro: texto } });
    };

    const temaValor = value.tema?.otro != null ? OTRO : (value.tema?.codigo || '');

    return (
        <>
            {completa && (
                <>
                    <div className="form-group">
                        <label className="form-label">Tema tratado *</label>
                        <Select
                            ariaLabel="Tema tratado"
                            placeholder="Seleccione el tema"
                            searchable
                            value={temaValor}
                            onChange={(v) => set({ tema: v === OTRO ? { otro: '' } : { codigo: v } })}
                            options={opciones(catalogos.temas, true)}
                        />
                        {value.tema?.otro != null && (
                            <input
                                className="form-input" style={{ marginTop: 'var(--space-2)' }}
                                placeholder="Escribe el tema no listado…" maxLength={200}
                                value={value.tema.otro} onChange={(e) => set({ tema: { otro: e.target.value } })}
                                required
                            />
                        )}
                    </div>

                    <MultiCatalogo label="Recursos utilizados" items={catalogos.recursos}
                        seleccion={value.recursos?.codigos || []} otro={value.recursos?.otro}
                        onToggle={toggleEn('recursos')} onOtro={otroEn('recursos')} />

                    <MultiCatalogo label="Riesgos identificados" items={catalogos.riesgos}
                        seleccion={value.riesgos?.codigos || []} otro={value.riesgos?.otro}
                        onToggle={toggleEn('riesgos')} onOtro={otroEn('riesgos')} />

                    <MultiCatalogo label="Medidas de prevención" items={catalogos.medidas}
                        seleccion={value.medidas?.codigos || []} otro={value.medidas?.otro}
                        onToggle={toggleEn('medidas')} onOtro={otroEn('medidas')} />

                    <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                        <div className="form-group">
                            <label className="form-label">Tipo de trabajo</label>
                            <Select
                                ariaLabel="Tipo de trabajo"
                                placeholder="Interior / exterior"
                                value={value.tipoTrabajo || ''}
                                onChange={(v) => set({
                                    tipoTrabajo: (v || null) as PlanificacionActividad['tipoTrabajo'],
                                    // Al pasar a exterior el protector solar parte activado.
                                    protectorSolar: v === 'exterior' ? (value.protectorSolar ?? true) : null,
                                })}
                                options={[
                                    { value: 'interior', label: 'Interior' },
                                    { value: 'exterior', label: 'Exterior' },
                                ]}
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Condición climática</label>
                            <Select
                                ariaLabel="Condición climática"
                                placeholder="Seleccione"
                                value={value.condicionClimatica || ''}
                                onChange={(v) => set({ condicionClimatica: (v || null) as PlanificacionActividad['condicionClimatica'] })}
                                options={[
                                    { value: 'despejado', label: 'Despejado' },
                                    { value: 'parcial', label: 'Parcialmente nublado' },
                                    { value: 'nublado', label: 'Nublado' },
                                    { value: 'lluvia', label: 'Lluvia' },
                                ]}
                            />
                        </div>
                    </div>

                    {value.tipoTrabajo === 'exterior' && (
                        <div className="form-group">
                            <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={value.protectorSolar ?? true}
                                    onChange={(e) => set({ protectorSolar: e.target.checked })}
                                />
                                <span className="form-label" style={{ margin: 0 }}>Aplicación de protector solar</span>
                            </label>
                            {esTemporadaUV() && (
                                <p className="text-xs" style={{ color: 'var(--warning-600, #b45309)', margin: 'var(--space-1) 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <FiSun size={12} /> Temporada de alta radiación UV (septiembre–marzo)
                                </p>
                            )}
                        </div>
                    )}
                </>
            )}

            <div className="form-group">
                <label className="form-label">{esComite ? 'Participación y consulta' : 'Observaciones'}</label>
                <textarea
                    className="form-input" rows={3} maxLength={4000} style={{ resize: 'vertical' }}
                    placeholder={esComite
                        ? 'Acuerdos, consultas y participación de los trabajadores en la reunión del Comité Paritario…'
                        : 'Observaciones, participación y consultas de los asistentes…'}
                    value={value.observaciones || ''}
                    onChange={(e) => set({ observaciones: e.target.value })}
                />
            </div>
        </>
    );
}
```

- [ ] **Step 2: `PermisosTrabajoForm.tsx`**

```tsx
import type { PermisoTrabajo, PermisoTrabajoTipo, PermisosTrabajoDef } from '../../api/client';
import { Select } from '../ui';

interface WorkerOption { personaId: string; nombre: string; apellido?: string; cargo?: string; }

interface Props {
    value: PermisoTrabajo[];
    onChange: (next: PermisoTrabajo[]) => void;
    permisosDef: PermisosTrabajoDef;
    workers: WorkerOption[];
}

const RESPUESTAS: { value: 'si' | 'no' | 'na'; label: string }[] = [
    { value: 'si', label: 'Sí' },
    { value: 'no', label: 'No' },
    { value: 'na', label: 'N/A' },
];

export default function PermisosTrabajoForm({ value, onChange, permisosDef, workers }: Props) {
    const tipos = Object.keys(permisosDef) as PermisoTrabajoTipo[];

    const permisoDe = (tipo: PermisoTrabajoTipo) => value.find((p) => p.tipo === tipo);

    const toggle = (tipo: PermisoTrabajoTipo) => {
        const existente = permisoDe(tipo);
        if (existente) {
            const tieneDatos = existente.responsableId || Object.keys(existente.checklist).length > 0;
            if (tieneDatos && !window.confirm('Se descartarán los datos de este permiso. ¿Continuar?')) return;
            onChange(value.filter((p) => p.tipo !== tipo));
        } else {
            onChange([...value, { tipo, responsableId: '', horaInicio: '', horaFin: '', ubicacion: '', checklist: {} }]);
        }
    };

    const actualizar = (tipo: PermisoTrabajoTipo, patch: Partial<PermisoTrabajo>) => {
        onChange(value.map((p) => (p.tipo === tipo ? { ...p, ...patch } : p)));
    };

    return (
        <div className="form-group">
            <label className="form-label">Permisos de trabajo especiales</label>
            <div className="flex flex-col gap-2">
                {tipos.map((tipo) => {
                    const def = permisosDef[tipo];
                    const permiso = permisoDe(tipo);
                    return (
                        <div key={tipo} style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                            <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                                <input type="checkbox" checked={!!permiso} onChange={() => toggle(tipo)} />
                                <span className="font-bold">{def.label}</span>
                            </label>

                            {permiso && (
                                <div className="flex flex-col gap-3" style={{ marginTop: 'var(--space-3)' }}>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">Responsable del permiso *</label>
                                        <Select
                                            ariaLabel={`Responsable ${def.label}`}
                                            placeholder="Seleccione responsable"
                                            searchable
                                            value={permiso.responsableId}
                                            onChange={(v) => actualizar(tipo, { responsableId: v })}
                                            options={workers.map((w) => ({
                                                value: w.personaId,
                                                label: `${w.nombre} ${w.apellido || ''}`.trim(),
                                                description: w.cargo,
                                            }))}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2" style={{ gap: 'var(--space-3)' }}>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label className="form-label">Válido desde *</label>
                                            <input type="time" className="form-input" value={permiso.horaInicio}
                                                onChange={(e) => actualizar(tipo, { horaInicio: e.target.value })} />
                                        </div>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label className="form-label">Válido hasta *</label>
                                            <input type="time" className="form-input" value={permiso.horaFin}
                                                onChange={(e) => actualizar(tipo, { horaFin: e.target.value })} />
                                        </div>
                                    </div>
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">Ubicación específica</label>
                                        <input className="form-input" maxLength={200} placeholder="Ej: losa piso 4, cámara de alcantarillado norte…"
                                            value={permiso.ubicacion || ''} onChange={(e) => actualizar(tipo, { ubicacion: e.target.value })} />
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted" style={{ marginBottom: 'var(--space-1)' }}>Lista de verificación *</div>
                                        {def.checklist.map((item) => (
                                            <div key={item.key} className="flex items-center justify-between gap-2" style={{ padding: '4px 0' }}>
                                                <span className="text-sm">{item.label}</span>
                                                <div className="flex gap-1">
                                                    {RESPUESTAS.map((r) => (
                                                        <button
                                                            key={r.value} type="button"
                                                            className={`btn btn-sm ${permiso.checklist[item.key] === r.value ? 'btn-primary' : 'btn-secondary'}`}
                                                            onClick={() => actualizar(tipo, { checklist: { ...permiso.checklist, [item.key]: r.value } })}
                                                        >
                                                            {r.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Integrar en `Activities.tsx`**

Cambios puntuales:

1. **Tipos nuevos en el selector** — en `ACTIVITY_TYPES` (línea ~26) agregar:

```tsx
    REUNION_COMITE: { label: 'Reunión Comité Paritario', color: 'var(--secondary-500, #7c3aed)', icon: <FiUsers /> },
    SIMULACRO: { label: 'Simulacro de Emergencia', color: 'var(--danger-500, #dc2626)', icon: <FiAlertTriangle /> },
```

2. **Estado y carga de catálogos** — junto a los `useState` existentes:

```tsx
    const [catalogos, setCatalogos] = useState<CatalogosActividad | null>(null);
    const [permisosDef, setPermisosDef] = useState<PermisosTrabajoDef>({});
```

y en `loadData`, agregar al `Promise.all` (o en un `useEffect` propio dependiente de `user?.tenantId`):

```tsx
    useEffect(() => {
        if (!user?.tenantId) return;
        tenantsApi.getCatalogosActividad(user.tenantId).then((res) => {
            if (res.success && res.data) {
                setCatalogos(res.data.catalogos);
                setPermisosDef(res.data.permisosTrabajoDef);
            }
        }).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.tenantId]);
```

3. **`emptyActivity`** — agregar:

```tsx
        planificacion: { observaciones: '' } as PlanificacionActividad,
        permisosTrabajo: [] as PermisoTrabajo[],
```

4. **Payload del create** — en `handleCreateActivity`, tras armar `payload`:

```tsx
            // La planificación completa solo aplica a charlas/ART; para el resto
            // solo viajan las observaciones (si las hay).
            if (!['CHARLA_5MIN', 'ART'].includes(payload.tipo)) {
                const obs = payload.planificacion?.observaciones?.trim();
                payload.planificacion = obs ? { observaciones: obs } : undefined;
                payload.permisosTrabajo = undefined;
            }
```

5. **Render en el form** — dentro del `<form id="create-activity-form">`, después del campo Ubicación y antes de Asistentes requeridos:

```tsx
                        {catalogos && (
                            <PlanificacionDiariaForm
                                value={newActivity.planificacion}
                                onChange={(planificacion) => setNewActivity({ ...newActivity, planificacion })}
                                catalogos={catalogos}
                                tipoActividad={newActivity.tipo}
                            />
                        )}

                        {['CHARLA_5MIN', 'ART'].includes(newActivity.tipo) && Object.keys(permisosDef).length > 0 && (
                            <PermisosTrabajoForm
                                value={newActivity.permisosTrabajo}
                                onChange={(permisosTrabajo) => setNewActivity({ ...newActivity, permisosTrabajo })}
                                permisosDef={permisosDef}
                                workers={workers}
                            />
                        )}
```

con los imports correspondientes (`PlanificacionDiariaForm`, `PermisosTrabajoForm`, `tenantsApi`, tipos).

- [ ] **Step 4: Verificar y commitear**

Run: `cd Frontend && npx tsc --noEmit -p .`
Expected: sin errores.

```bash
git add Frontend/src/components/actividades/ Frontend/src/pages/Activities.tsx
git commit -m "feat: planificación diaria y permisos de trabajo en el formulario de actividades"
```

---

### Task 7: Reporte post-charla + Completar registro

**Files:**
- Create: `Frontend/src/utils/reporteActividad.ts`
- Create: `Frontend/src/components/actividades/ReporteActividad.tsx`
- Modify: `Frontend/src/pages/Activities.tsx` (modal de detalle + modal "Completar registro")

**Interfaces:**
- Consumes: `Activity`, `Worker`, `CatalogosActividad`, `PermisosTrabajoDef` (Task 4); `activitiesApi.patch` (Task 4); componentes de Task 6 (reutilizados en el modal de edición).
- Produces:
  - `construirFilasAsistencia(activity, workers) → { filas: {personaId, nombre, cargo, asistio: boolean, hora: string|null, convocado: boolean}[], requeridos: number, asistieron: number, porcentaje: number }`
  - `abrirReporteImpresion(activity, filas, catalogos, permisosDef)` — abre ventana imprimible
  - `<ReporteActividad activity workers catalogos permisosDef />` — sección de reporte del detalle

- [ ] **Step 1: `reporteActividad.ts` — cruce de asistencia + impresión**

```ts
import type { Activity, Worker, CatalogosActividad, PermisosTrabajoDef } from '../api/client';

export interface FilaAsistencia {
    personaId: string;
    nombre: string;
    cargo: string;
    asistio: boolean;
    hora: string | null;
    convocado: boolean;
}

/**
 * Cruza asistentesRequeridos × asistentes: cada requerido sale Sí/No; quien
 * firmó sin estar convocado aparece igual (asistió = sí, convocado = false).
 * Los asistentes guardan personaId (o workerId legacy).
 */
export function construirFilasAsistencia(activity: Activity, workers: Worker[]) {
    const firmadoPor = new Map<string, { hora: string | null; nombre: string; cargo: string }>();
    for (const a of activity.asistentes || []) {
        const id = (a as any).personaId || a.workerId;
        if (id) firmadoPor.set(id, { hora: a.firma?.horario || null, nombre: a.nombre, cargo: a.cargo || '' });
    }

    const filas: FilaAsistencia[] = [];
    const requeridosIds = activity.asistentesRequeridos || [];
    for (const id of requeridosIds) {
        const w = workers.find((x) => x.personaId === id);
        const firma = firmadoPor.get(id);
        filas.push({
            personaId: id,
            nombre: firma?.nombre || (w ? `${w.nombre} ${w.apellido || ''}`.trim() : id),
            cargo: firma?.cargo || w?.cargo || '',
            asistio: !!firma,
            hora: firma?.hora || null,
            convocado: true,
        });
    }
    for (const [id, firma] of firmadoPor) {
        if (requeridosIds.includes(id)) continue;
        filas.push({ personaId: id, nombre: firma.nombre, cargo: firma.cargo, asistio: true, hora: firma.hora, convocado: false });
    }

    const requeridos = requeridosIds.length;
    const asistieron = filas.filter((f) => f.asistio).length;
    const porcentaje = requeridos > 0
        ? Math.round((filas.filter((f) => f.convocado && f.asistio).length / requeridos) * 100)
        : (asistieron > 0 ? 100 : 0);
    return { filas, requeridos, asistieron, porcentaje };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const labelDe = (items: { codigo: string; label: string }[], codigo: string) =>
    items.find((i) => i.codigo === codigo)?.label || codigo;

const listaSeleccion = (sel: { codigos?: string[]; otro?: string | null } | null | undefined, items: { codigo: string; label: string }[]) => {
    const parts = (sel?.codigos || []).map((c) => labelDe(items, c));
    if (sel?.otro) parts.push(`Otro: ${sel.otro}`);
    return parts;
};

/**
 * Abre una ventana con el acta post-charla completa y lanza el diálogo de
 * impresión (el usuario la guarda como PDF desde el navegador).
 */
export function abrirReporteImpresion(
    activity: Activity,
    filas: ReturnType<typeof construirFilasAsistencia>,
    catalogos: CatalogosActividad | null,
    permisosDef: PermisosTrabajoDef,
) {
    const p = activity.planificacion;
    const seccionCatalogo = (titulo: string, valores: string[]) => valores.length
        ? `<h3>${esc(titulo)}</h3><ul>${valores.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : '';

    const clima: Record<string, string> = { despejado: 'Despejado', parcial: 'Parcialmente nublado', nublado: 'Nublado', lluvia: 'Lluvia' };

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Reporte — ${esc(activity.titulo)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 32px; color: #111; }
  h1 { font-size: 20px; margin-bottom: 2px; } h2 { font-size: 15px; margin: 18px 0 6px; }
  h3 { font-size: 13px; margin: 12px 0 4px; } .muted { color: #555; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; margin-top: 6px; font-size: 13px; }
  th, td { border: 1px solid #bbb; padding: 5px 8px; text-align: left; }
  th { background: #f0f0f0; } ul { margin: 4px 0; padding-left: 20px; font-size: 13px; }
  .si { color: #15803d; font-weight: 700; } .no { color: #b91c1c; font-weight: 700; }
  .pie { margin-top: 28px; font-size: 11px; color: #777; }
  @media print { body { margin: 12mm; } }
</style></head><body>
<h1>Reporte de actividad — ${esc(activity.titulo)}</h1>
<div class="muted">${esc(activity.tipoDescripcion || activity.tipo)} · ${esc(activity.fecha)} · ${esc(activity.horaInicio)}${activity.horaFin ? ' – ' + esc(activity.horaFin) : ''}${activity.ubicacion ? ' · ' + esc(activity.ubicacion) : ''}</div>

<h2>Asistencia</h2>
<div>Convocados: <b>${filas.requeridos}</b> · Participantes: <b>${filas.asistieron}</b> · Asistencia: <b>${filas.porcentaje}%</b></div>
<table><thead><tr><th>Nombre</th><th>Cargo</th><th>Asistió</th><th>Hora firma</th></tr></thead><tbody>
${filas.filas.map((f) => `<tr><td>${esc(f.nombre)}${f.convocado ? '' : ' <span class="muted">(no convocado)</span>'}</td><td>${esc(f.cargo)}</td><td class="${f.asistio ? 'si' : 'no'}">${f.asistio ? 'Sí' : 'No'}</td><td>${esc(f.hora || '—')}</td></tr>`).join('')}
</tbody></table>

${p ? `<h2>Planificación diaria</h2>
${p.tema?.codigo && catalogos ? `<div><b>Tema tratado:</b> ${esc(labelDe(catalogos.temas, p.tema.codigo))}</div>` : ''}
${p.tema?.otro ? `<div><b>Tema tratado:</b> ${esc(p.tema.otro)}</div>` : ''}
${catalogos ? seccionCatalogo('Recursos utilizados', listaSeleccion(p.recursos, catalogos.recursos)) : ''}
${catalogos ? seccionCatalogo('Riesgos identificados', listaSeleccion(p.riesgos, catalogos.riesgos)) : ''}
${catalogos ? seccionCatalogo('Medidas de prevención', listaSeleccion(p.medidas, catalogos.medidas)) : ''}
${p.tipoTrabajo ? `<div><b>Tipo de trabajo:</b> ${p.tipoTrabajo === 'exterior' ? 'Exterior' : 'Interior'}${p.condicionClimatica ? ' · ' + esc(clima[p.condicionClimatica] || p.condicionClimatica) : ''}</div>` : ''}
${p.tipoTrabajo === 'exterior' && p.protectorSolar != null ? `<div><b>Aplicación de protector solar:</b> ${p.protectorSolar ? 'Sí' : 'No'}</div>` : ''}
${p.observaciones ? `<h3>${activity.tipo === 'REUNION_COMITE' ? 'Participación y consulta' : 'Observaciones'}</h3><div style="white-space:pre-wrap;font-size:13px">${esc(p.observaciones)}</div>` : ''}` : ''}

${(activity.permisosTrabajo || []).map((permiso) => {
        const def = permisosDef[permiso.tipo];
        if (!def) return '';
        return `<h2>Permiso de trabajo — ${esc(def.label)} ${permiso.completo ? '' : '(incompleto)'}</h2>
<div><b>Responsable:</b> ${esc(permiso.responsableNombre || permiso.responsableId)} · <b>Vigencia:</b> ${esc(permiso.horaInicio || '—')} – ${esc(permiso.horaFin || '—')}${permiso.ubicacion ? ' · ' + esc(permiso.ubicacion) : ''}</div>
<table><thead><tr><th>Verificación</th><th>Respuesta</th></tr></thead><tbody>
${def.checklist.map((i) => `<tr><td>${esc(i.label)}</td><td>${({ si: 'Sí', no: 'No', na: 'N/A' } as Record<string, string>)[permiso.checklist[i.key]] || '—'}</td></tr>`).join('')}
</tbody></table>`;
    }).join('')}

<div class="pie">Generado por PrevencionApp · ${new Date().toLocaleString('es-CL')}</div>
<script>window.onload = () => window.print();</script>
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
}
```

- [ ] **Step 2: `ReporteActividad.tsx` — sección del detalle**

```tsx
import { FiDownload, FiUsers } from 'react-icons/fi';
import type { Activity, Worker, CatalogosActividad, PermisosTrabajoDef } from '../../api/client';
import { construirFilasAsistencia, abrirReporteImpresion } from '../../utils/reporteActividad';

interface Props {
    activity: Activity;
    workers: Worker[];
    catalogos: CatalogosActividad | null;
    permisosDef: PermisosTrabajoDef;
}

export default function ReporteActividad({ activity, workers, catalogos, permisosDef }: Props) {
    const filas = construirFilasAsistencia(activity, workers);

    return (
        <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
                <div className="text-xs text-muted flex items-center gap-1">
                    <FiUsers /> Reporte de asistencia — {filas.asistieron} participante(s)
                    {filas.requeridos > 0 && ` de ${filas.requeridos} convocado(s) (${filas.porcentaje}%)`}
                </div>
                <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => abrirReporteImpresion(activity, filas, catalogos, permisosDef)}
                >
                    <FiDownload size={14} /> Descargar reporte
                </button>
            </div>
            {filas.filas.length === 0 ? (
                <div className="text-sm text-muted">Sin convocados ni asistencias registradas.</div>
            ) : (
                <div className="table-container">
                    <table className="table">
                        <thead><tr><th>Nombre</th><th>Cargo</th><th>Asistió</th><th>Hora firma</th></tr></thead>
                        <tbody>
                            {filas.filas.map((f) => (
                                <tr key={f.personaId}>
                                    <td>{f.nombre}{!f.convocado && <span className="text-xs text-muted"> (no convocado)</span>}</td>
                                    <td>{f.cargo}</td>
                                    <td>
                                        <span className={`badge badge-sm ${f.asistio ? 'badge-success' : 'badge-danger'}`}>
                                            {f.asistio ? 'Sí' : 'No'}
                                        </span>
                                    </td>
                                    <td>{f.hora || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 3: Integrar en el modal de detalle de `Activities.tsx`**

En el Activity Detail Modal (línea ~1016), **reemplazar** la sección "Asistencia registrada" (el bloque que empieza en `<div className="text-xs text-muted mb-2 flex items-center gap-1"><FiUsers /> Asistencia registrada...`) por:

```tsx
                                <ReporteActividad
                                    activity={detailActivity}
                                    workers={workers}
                                    catalogos={catalogos}
                                    permisosDef={permisosDef}
                                />
```

Y debajo, mostrar planificación y permisos en el detalle (después de la sección Descripción):

```tsx
                                {detailActivity.planificacion?.observaciones && (
                                    <div>
                                        <div className="text-xs text-muted">
                                            {detailActivity.tipo === 'REUNION_COMITE' ? 'Participación y consulta' : 'Observaciones'}
                                        </div>
                                        <div style={{ whiteSpace: 'pre-wrap' }}>{detailActivity.planificacion.observaciones}</div>
                                    </div>
                                )}
                                {(detailActivity.permisosTrabajo || []).length > 0 && (
                                    <div>
                                        <div className="text-xs text-muted mb-2">Permisos de trabajo</div>
                                        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                                            {detailActivity.permisosTrabajo!.map((pt) => (
                                                <span key={pt.tipo} className={`badge ${pt.completo ? 'badge-success' : 'badge-warning'}`}>
                                                    {permisosDef[pt.tipo]?.label || pt.tipo} {pt.completo ? '· completo' : '· incompleto'}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
```

- [ ] **Step 4: Modal "Completar registro" (PATCH)**

En `Activities.tsx`:

1. Estado:

```tsx
    const [showEditModal, setShowEditModal] = useState(false);
    const [editActivity, setEditActivity] = useState<Activity | null>(null);
    const [editDraft, setEditDraft] = useState<{ planificacion: PlanificacionActividad; permisosTrabajo: PermisoTrabajo[] }>({ planificacion: {}, permisosTrabajo: [] });
    const [editSaving, setEditSaving] = useState(false);
```

2. Apertura desde el modal de detalle (footer o junto al título; visible con `canManage || detailActivity.relatorId === user?.personaId`):

```tsx
                                <button className="btn btn-secondary btn-sm" onClick={() => {
                                    setEditActivity(detailActivity);
                                    setEditDraft({
                                        planificacion: detailActivity.planificacion || { observaciones: '' },
                                        permisosTrabajo: detailActivity.permisosTrabajo || [],
                                    });
                                    setShowDetailModal(false);
                                    setShowEditModal(true);
                                }}>
                                    Completar registro
                                </button>
```

3. Guardado:

```tsx
    const handleSaveRegistro = async () => {
        if (!editActivity || editSaving) return;
        setEditSaving(true);
        try {
            const res = await activitiesApi.patch(editActivity.activityId, {
                ...editDraft,
                solicitanteId: user?.personaId,
            });
            if (res.success && res.data) {
                setActivities((prev) => prev.map((a) => a.activityId === res.data!.activityId ? res.data! : a));
                setShowEditModal(false);
                toast.success('Registro actualizado');
            } else {
                toast.error(res.error || 'Error al guardar el registro');
            }
        } finally {
            setEditSaving(false);
        }
    };
```

4. Modal (junto a los otros modales), reutilizando los componentes de Task 6:

```tsx
                <Modal
                    isOpen={showEditModal && !!editActivity}
                    onClose={() => !editSaving && setShowEditModal(false)}
                    title="Completar registro"
                    subtitle={editActivity?.titulo}
                    footer={
                        <>
                            <button className="btn btn-secondary" disabled={editSaving} onClick={() => setShowEditModal(false)}>Cancelar</button>
                            <button className="btn btn-primary" disabled={editSaving} onClick={handleSaveRegistro}>
                                {editSaving ? 'Guardando…' : 'Guardar registro'}
                            </button>
                        </>
                    }
                >
                    {editActivity && catalogos && (
                        <>
                            <PlanificacionDiariaForm
                                value={editDraft.planificacion}
                                onChange={(planificacion) => setEditDraft({ ...editDraft, planificacion })}
                                catalogos={catalogos}
                                tipoActividad={editActivity.tipo}
                            />
                            {['CHARLA_5MIN', 'ART'].includes(editActivity.tipo) && (
                                <PermisosTrabajoForm
                                    value={editDraft.permisosTrabajo}
                                    onChange={(permisosTrabajo) => setEditDraft({ ...editDraft, permisosTrabajo })}
                                    permisosDef={permisosDef}
                                    workers={workers}
                                />
                            )}
                        </>
                    )}
                </Modal>
```

- [ ] **Step 5: Verificar y commitear**

Run: `cd Frontend && npx tsc --noEmit -p .`
Expected: sin errores.

```bash
git add Frontend/src/utils/reporteActividad.ts Frontend/src/components/actividades/ReporteActividad.tsx Frontend/src/pages/Activities.tsx
git commit -m "feat: reporte post-charla con descarga y edición acotada del registro (Completar registro)"
```

---

### Task 8: Verificación integral

**Files:** ninguno nuevo (solo verificación y ajustes menores que surjan).

- [ ] **Step 1: Suite completa**

Run:
```bash
cd Backend && npm test && node --check handlers/activities/handler.js && node --check handlers/tenants-module/handler.js
cd ../Frontend && npx tsc --noEmit -p .
```
Expected: todo en verde.

- [ ] **Step 2: Smoke test manual (serverless offline + vite)**

Con `cd Backend && npm run dev` y el frontend corriendo:
1. Entrar a `/catalogos-actividad` (usuario con `CARGOS_GESTIONAR`): agregar un tema, guardar, recargar → persiste.
2. Nueva actividad CHARLA_5MIN: aparece la sección de planificación; elegir tema del catálogo, marcar exterior → aparece protector solar pre-activado con aviso UV (si aplica); marcar Trabajo en altura → se expande el checklist; crear.
3. Crear una actividad `REUNION_COMITE`: solo aparece "Participación y consulta".
4. Registrar asistencia de al menos 1 trabajador; abrir el detalle → sección Reporte con Sí/No; "Descargar reporte" abre la ventana de impresión con el acta completa.
5. "Completar registro" sobre la actividad → editar observaciones → guardar → el detalle refleja el cambio; verificar en la respuesta que `asistentes` no cambió.
6. Crear actividad vía API con un código de tema inexistente → 400 con mensaje "código desconocido".

- [ ] **Step 3: Actualizar el spec con el estado final y commit de cierre**

Marcar en el spec (sección "Estado") que la implementación se completó, y commit:

```bash
git add -A
git commit -m "chore: cierre de implementación planificación diaria de charlas"
```

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec:** §1 catálogos → Tasks 1, 2, 5. §2 planificacion → Tasks 1, 3, 6. §3 permisos → Tasks 1, 3, 6. §4 reporte → Task 7. §5 PATCH → Tasks 3, 7. Fix REUNION_COMITE/SIMULACRO → Task 6. Testing → Tasks 1 y 8.
- **Tipos consistentes:** `validatePlanificacion`/`validatePermisosTrabajo`/`resolveCatalogos` (Task 1) se usan con esas firmas en Tasks 2–3; `PlanificacionActividad`/`PermisoTrabajo`/`CatalogosActividad`/`PermisosTrabajoDef` (Task 4) se consumen en Tasks 5–7; `construirFilasAsistencia`/`abrirReporteImpresion` (Task 7) coinciden entre util y componente.
- **Puntos que el implementador debe verificar contra el código real** (anotados en los pasos): forma exacta de `apiRequest` (imitar métodos vecinos), re-exports de `client.ts`, firma del `Select` de `../ui`, y estructura del `user` de `useAuth` (`tenantId`, `personaId`).
