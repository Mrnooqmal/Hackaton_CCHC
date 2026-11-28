// Subir una plantilla de obra asigna el documento a quien ya está en la obra.
process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PersonaService } = require('../lib/services/PersonaService');
const { syncPlantillasObra } = require('../handlers/personas-module/handler');

const original = PersonaService.prototype.listByTenant;
afterEach(() => { PersonaService.prototype.listByTenant = original; });

const contarListados = () => {
    const llamadas = [];
    PersonaService.prototype.listByTenant = async (tenantId, filtros) => { llamadas.push(filtros); return []; };
    return llamadas;
};
const mapa = (fileKey) => ({ JORNAL: { IRL: { fileKey } } });

test('una plantilla nueva o cambiada revisa a las personas de esa obra', async () => {
    for (const anteriores of [{}, mapa('v1')]) {
        const llamadas = contarListados();
        await syncPlantillasObra({ tenantId: 't1', obraId: 'o1', anteriores, nuevas: mapa('v2') });
        assert.deepEqual(llamadas, [{ obraId: 'o1' }]);
    }
});

test('sin cambios de archivo, o al quitar una plantilla, no se recorre a nadie', async () => {
    const llamadas = contarListados();
    await syncPlantillasObra({ tenantId: 't1', obraId: 'o1', anteriores: mapa('v1'), nuevas: mapa('v1') });
    await syncPlantillasObra({ tenantId: 't1', obraId: 'o1', anteriores: mapa('v1'), nuevas: { JORNAL: {} } });
    assert.equal(llamadas.length, 0);
});
