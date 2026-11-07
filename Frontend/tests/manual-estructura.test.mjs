// Estructura del manual (Fase 4): navegación, enlaces, direcciones viejas y
// reglas de redacción. Lee el contenido real de src/manual/content.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import GithubSlugger from 'github-slugger';
import { MANUAL_SECTIONS } from '../src/manual/manualNav.ts';
import { ANCLAS_MOVIDAS, PAGINAS_MOVIDAS, destinoDe } from '../src/manual/redirecciones.ts';
import { PANTALLAS } from '../src/ayuda/registro.ts';

const BASE = fileURLToPath(new URL('../src/manual/content', import.meta.url));
const archivos = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(d, e.name)) : [join(d, e.name)]));
const slugDe = (f) => relative(BASE, f).split(sep).join('/').replace(/\.md$/, '').replace(/\/index$/, '').replace(/^index$/, '');
const PAGINAS = Object.fromEntries(archivos(BASE).filter((f) => f.endsWith('.md')).map((f) => [slugDe(f), readFileSync(f, 'utf8')]));

/** Anclas de una página, como las genera rehype-slug (mismo criterio que headings.ts). */
function anclas(md) {
    const s = new GithubSlugger();
    const r = new Set();
    let codigo = false;
    for (const l of md.split('\n')) {
        if (/^```/.test(l.trim())) { codigo = !codigo; continue; }
        if (codigo) continue;
        const m = /^(#{2,3})\s+(.+?)\s*$/.exec(l);
        if (m) r.add(s.slug(m[2].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim()));
    }
    return r;
}

/** Las 33 páginas del manual anterior a la Fase 4 (ordenado por módulo). */
const PAGINAS_VIEJAS = [
    'guia-inicio', 'guia-inicio/instalacion', 'guia-inicio/onboarding', 'guia-inicio/primeros-pasos',
    'ds44', 'ds44/capacitaciones', 'ds44/documentos-obligatorios', 'ds44/epp', 'ds44/fases-obra', 'ds44/firmas-digitales',
    'modulos', 'modulos/actividades', 'modulos/bandeja-entrada', 'modulos/catalogos', 'modulos/configuracion', 'modulos/dashboard',
    'modulos/datos-personales', 'modulos/documentos', 'modulos/encuestas', 'modulos/estructura-preventiva', 'modulos/firmas',
    'modulos/incidentes', 'modulos/obras', 'modulos/onboarding-cargos', 'modulos/personas', 'modulos/prescripciones', 'modulos/tenants',
    'roles', 'roles/admin', 'roles/jefe-obra', 'roles/prevencionista', 'roles/supervisor', 'roles/trabajador',
];

const enlaceANav = (l) => l.replace(/\/+$/, '');

test('cada página del menú existe, y cada página existe en el menú', () => {
    const enMenu = MANUAL_SECTIONS.flatMap((s) => s.items.map((i) => enlaceANav(i.link)));
    assert.deepEqual(enMenu.filter((l) => !(l in PAGINAS)), [], 'en el menú sin página');
    assert.deepEqual(Object.keys(PAGINAS).filter((p) => !enMenu.includes(p)).sort(), [], 'páginas fuera del menú');
    assert.equal(new Set(enMenu).size, enMenu.length, 'páginas repetidas en el menú');
});

test('todo enlace interno del manual lleva a una página y a un ancla que existen', () => {
    const rotos = [];
    for (const [slug, md] of Object.entries(PAGINAS)) {
        for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
            const href = m[1];
            if (/^(https?:|mailto:|tel:|recorrido:)/.test(href) || href.startsWith('/img/')) continue;
            const [ruta, ancla] = href.split('#');
            const destino = ruta === '' ? slug : ruta.replace(/^\/+|\/+$/g, '');
            if (destino !== '' && !(destino in PAGINAS)) { rotos.push(`${slug} → ${href} (página)`); continue; }
            if (ancla && destino !== '' && !anclas(PAGINAS[destino]).has(decodeURIComponent(ancla))) rotos.push(`${slug} → ${href} (ancla)`);
        }
    }
    assert.deepEqual(rotos, []);
});

test('toda página del manual anterior lleva a una página que existe', () => {
    for (const vieja of PAGINAS_VIEJAS) {
        assert.ok(vieja in PAGINAS_MOVIDAS || vieja in PAGINAS, `${vieja}: sin destino`);
        const d = vieja in PAGINAS ? vieja : PAGINAS_MOVIDAS[vieja];
        assert.ok(d === '' || d in PAGINAS, `${vieja} → ${d}: no existe`);
    }
    for (const [vieja, nueva] of Object.entries(PAGINAS_MOVIDAS)) {
        assert.ok(!(vieja in PAGINAS), `${vieja} existe y además redirige: la redirección no se usaría`);
        assert.ok(nueva === '' || nueva in PAGINAS, `${vieja} → ${nueva}`);
    }
});

test('cada sección que cambió de página se encuentra en su página nueva', () => {
    for (const [clave, nueva] of Object.entries(ANCLAS_MOVIDAS)) {
        const ancla = clave.split('#')[1];
        assert.ok(anclas(PAGINAS[nueva] || '').has(ancla), `${clave} → ${nueva}`);
    }
});

test('destinoDe: una dirección vieja, con o sin ancla', () => {
    assert.equal(destinoDe('modulos/firmas', ''), '/manual/terreno/firmar');
    assert.equal(destinoDe('modulos/firmas', 'firma-asistida'), '/manual/obra/pedir-firmas#firma-asistida');
    assert.equal(destinoDe('/guia-inicio/instalacion/', 'preguntas-frecuentes'), '/manual/empezar/ingresar#preguntas-frecuentes');
    assert.equal(destinoDe('modulos', ''), '/manual');
    assert.equal(destinoDe('terreno/firmar', ''), null, 'una página actual no se redirige');
});

test('la ayuda de cada pantalla lleva a una página del manual que existe', () => {
    for (const [clave, p] of Object.entries(PANTALLAS)) {
        if (p.manual !== undefined) assert.ok(p.manual in PAGINAS, `${clave}: ${p.manual}`);
    }
});

test('redacción: el manual no presenta el esquema de fases como del decreto ni promete cumplimiento', () => {
    // Reglas del encargo (sección 6). Frases que ya aparecieron y no deben volver.
    const prohibidas = [
        /se apoya en el ciclo/i,
        /fases de ese ciclo/i,
        /ciclo normativo/i,
        /garantiza(r)? (el )?cumplimiento/i,
        /asegura(r)? (el )?cumplimiento/i,
        /(la plataforma|el sistema|build & serve) (valida|verifica) (el contenido|los documentos)/i,
    ];
    const hallazgos = [];
    for (const [slug, md] of Object.entries(PAGINAS)) {
        for (const linea of md.split('\n')) {
            if (/no garantiza/i.test(linea)) continue;
            for (const re of prohibidas) if (re.test(linea)) hallazgos.push(`${slug}: ${linea.trim()}`);
        }
    }
    assert.deepEqual(hallazgos, []);
});

test('redacción: sin la jerga de la versión anterior en el texto', () => {
    const jerga = /\b(Tenants?|Dashboard)\b/;
    const hallazgos = Object.entries(PAGINAS).flatMap(([slug, md]) => md.split('\n').filter((l) => jerga.test(l.replace(/\]\([^)]*\)/g, ']'))).map((l) => `${slug}: ${l.trim()}`));
    assert.deepEqual(hallazgos, []);
});

test('las capturas pendientes quedan como comentario: no se muestran ni se buscan', () => {
    for (const [slug, md] of Object.entries(PAGINAS)) {
        for (const l of md.split('\n')) {
            if (l.includes('CAPTURA PENDIENTE')) assert.match(l.trim(), /^<!--.*-->$/, `${slug}: ${l}`);
        }
    }
});
