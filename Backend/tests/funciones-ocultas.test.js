const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FRONTEND } = require('./cargar-ts');

const leer = (rel) => fs.readFileSync(path.join(FRONTEND, rel), 'utf8');

test('para la visita, el panorama de la empresa y la lectura en voz están ocultos', () => {
    const config = leer('src/config/funciones.ts');
    assert.match(config, /panoramaEmpresa:\s*false/);
    assert.match(config, /lecturaEnVoz:\s*false/);
});

test('el inicio de la empresa solo se sirve con el panorama encendido, y "Gestionar la empresa" lleva a los ajustes', () => {
    assert.match(leer('src/App.tsx'), /modoEmpresa && FUNCIONES\.panoramaEmpresa \? <InicioEmpresa \/> : <Dashboard \/>/);
    assert.match(leer('src/pages/SeleccionObra.tsx'), /navigate\(FUNCIONES\.panoramaEmpresa \? '\/' : '\/mi-empresa'/);
});

test('ninguna pantalla muestra el reproductor ni el botón Escuchar sin la lectura en voz encendida', () => {
    const usos = [];
    const recorrer = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) recorrer(p);
            else if (/\.tsx$/.test(e.name) && e.name !== 'LecturaEnVoz.tsx' && /<LecturaEnVoz\b/.test(fs.readFileSync(p, 'utf8'))) usos.push(p);
        }
    };
    recorrer(path.join(FRONTEND, 'src'));
    assert.ok(usos.length > 0);
    for (const p of usos) {
        const codigo = fs.readFileSync(p, 'utf8');
        assert.match(codigo, /FUNCIONES\.lecturaEnVoz/, path.relative(FRONTEND, p));
    }
    const modal = leer('src/components/DocumentPreviewModal.tsx');
    assert.match(modal, /const conLectura = FUNCIONES\.lecturaEnVoz && !!fileKey;/);
    assert.match(modal, /\{conLectura && !escuchando && \(/);
});

test('el manual no promete la lectura en voz mientras está oculta', () => {
    const encendida = /lecturaEnVoz:\s*true/.test(leer('src/config/funciones.ts'));
    if (encendida) return;
    const malos = [];
    const recorrer = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) recorrer(p);
            else if (e.name.endsWith('.md') && /Escuchar documento|te lo lea en voz alta/i.test(fs.readFileSync(p, 'utf8'))) malos.push(path.relative(FRONTEND, p));
        }
    };
    recorrer(path.join(FRONTEND, 'src', 'manual'));
    assert.deepEqual(malos, []);
});
