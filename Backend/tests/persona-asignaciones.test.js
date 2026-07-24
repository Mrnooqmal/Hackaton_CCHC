const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Persona } = require('../lib/models/Persona');

// La cadena trabajador→supervisor→prevencionista scopea las charlas, así que el
// modelo debe conservar prevencionistaPersonaId por-obra sin perderlo.
test('_deriveAsignaciones conserva prevencionistaPersonaId por obra', () => {
    const p = new Persona({
        personaId: 's-1', tenantId: 't-1', rol: 'supervisor',
        asignaciones: [{ obraId: 'o-1', cargos: ['x'], supervisorPersonaId: null, prevencionistaPersonaId: 'prev-1' }],
    });
    assert.equal(p.asignaciones[0].prevencionistaPersonaId, 'prev-1');
});

test('asignación sin prevencionista (legacy) queda en null, no undefined', () => {
    const p = new Persona({
        personaId: 't-1', tenantId: 't-1', rol: 'trabajador',
        asignaciones: [{ obraId: 'o-1', cargos: ['x'], supervisorPersonaId: 's-1' }],
    });
    assert.equal(p.asignaciones[0].prevencionistaPersonaId, null);
    assert.equal(p.asignaciones[0].supervisorPersonaId, 's-1');
});
