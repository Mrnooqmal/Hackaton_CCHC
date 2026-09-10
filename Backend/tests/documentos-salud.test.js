// Resguardo de los documentos con información de salud (Arts. 67 y 68).
//
// El DS 44 obliga a mantenerlos, pero eso no los vuelve consultables por
// cualquiera que entre al repositorio: son datos sensibles de una persona
// identificable. Se prueba la REGLA de visibilidad, que es donde un error se
// paga con una filtración y no con un error en pantalla.

const test = require('node:test');
const assert = require('node:assert');

const { PERMISSIONS, personaPuede } = require('../lib/permissions');
const { TIPOS_SALUD, puedeVerSalud, filtrarSalud } = require('../lib/documentos-salud');

const TENANT = { roles: [] };
const examen = (over = {}) => ({
    documentId: 'd1', tipo: 'EXAMEN_OCUPACIONAL', asignaciones: [], ...over,
});

test('el prevencionista ve los documentos de salud', () => {
    const persona = { personaId: 'p-prev', rol: 'prevencionista' };
    assert.equal(puedeVerSalud(examen(), persona, TENANT), true);
});

test('el jefe de obra también: responde por la vigilancia de su faena', () => {
    const persona = { personaId: 'p-jefe', rol: 'jefe_obra' };
    assert.equal(puedeVerSalud(examen(), persona, TENANT), true);
});

test('el supervisor NO los ve, aunque entre al repositorio', () => {
    // Tiene REPOSITORIO_VER pero no el permiso de vigilancia. Era la brecha:
    // el repositorio le mostraba los exámenes de cualquiera.
    const persona = { personaId: 'p-sup', rol: 'supervisor' };
    assert.equal(puedeVerSalud(examen(), persona, TENANT), false);
});

test('una persona sí ve su propio examen', () => {
    // Ocultarle a alguien su propia ficha de salud sería absurdo.
    const persona = { personaId: 'p-juan', rol: 'trabajador' };
    const doc = examen({ asignaciones: [{ personaId: 'p-juan', estado: 'pendiente' }] });
    assert.equal(puedeVerSalud(doc, persona, TENANT), true);
});

test('una persona NO ve el examen de otra', () => {
    const persona = { personaId: 'p-juan', rol: 'trabajador' };
    const doc = examen({ asignaciones: [{ personaId: 'p-ana', estado: 'firmado' }] });
    assert.equal(puedeVerSalud(doc, persona, TENANT), false);
});

test('el documento referido a la persona la deja verlo aunque no tenga asignación', () => {
    const persona = { personaId: 'p-ana', rol: 'trabajador' };
    assert.equal(puedeVerSalud(examen({ personaId: 'p-ana' }), persona, TENANT), true);
});

test('sin solicitante identificado se ocultan', () => {
    // Falla segura: si una pantalla olvida identificarse, el error debe ser que
    // falten documentos, nunca que se filtren datos de salud.
    assert.equal(puedeVerSalud(examen(), null, TENANT), false);
});

test('el admin los ve: tiene bypass en el modelo de permisos', () => {
    const persona = { personaId: 'p-adm', rol: 'admin' };
    assert.equal(puedeVerSalud(examen(), persona, TENANT), true);
});

test('los tipos de salud son los que llevan información de una persona', () => {
    // Los registros agregados del Art. 74 (tasas por sexo) NO entran: son
    // estadística, no la salud de nadie en particular, y el ítem 46 los necesita.
    assert.equal(TIPOS_SALUD.has('REGISTROS_INDICADORES_SST'), false);
    assert.equal(TIPOS_SALUD.has('VIGILANCIA_SALUD'), true);
    assert.equal(TIPOS_SALUD.has('EXAMEN_OCUPACIONAL'), true);
});

test('el supervisor sí conserva el resto del repositorio', () => {
    // El resguardo acota los documentos de salud, no el acceso general.
    const persona = { personaId: 'p-sup', rol: 'supervisor' };
    assert.equal(personaPuede(persona, TENANT, PERMISSIONS.REPOSITORIO_VER), true);
    assert.equal(personaPuede(persona, TENANT, PERMISSIONS.PERSONA_VIGILANCIA_SALUD), false);
});

test('el filtro deja pasar todo lo que no es de salud', () => {
    const persona = { personaId: 'p-sup', rol: 'supervisor' };
    const docs = [
        { documentId: 'a', tipo: 'REGLAMENTO_INTERNO' },
        { documentId: 'b', tipo: 'EXAMEN_OCUPACIONAL', asignaciones: [] },
        { documentId: 'c', tipo: 'MIPER' },
    ];
    const visibles = filtrarSalud(docs, persona, TENANT).map((d) => d.documentId);
    assert.deepEqual(visibles, ['a', 'c']);
});
